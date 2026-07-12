package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/stavbensimchon/cloud-gateway/internal/auth"
	"github.com/stavbensimchon/cloud-gateway/internal/config"
	"github.com/stavbensimchon/cloud-gateway/internal/tunnel"
)

type Handler struct {
	auth   *auth.Auth
	tm     *tunnel.Manager
	routes []config.Route
}

func New(a *auth.Auth, tm *tunnel.Manager, routes []config.Route) *Handler {
	return &Handler{auth: a, tm: tm, routes: routes}
}

func (h *Handler) HandleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		http.ServeFile(w, r, "web/login.html")
		return
	}

	var creds struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	token, err := h.auth.Login(creds.Username, creds.Password)
	if err != nil {
		http.Error(w, `{"error":"invalid credentials"}`, http.StatusUnauthorized)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{"token": token})
}

func (h *Handler) AuthMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			if token := r.URL.Query().Get("token"); token != "" {
				authHeader = "Bearer " + token
			} else {
				http.Redirect(w, r, "/login", http.StatusSeeOther)
				return
			}
		}

		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
		username, err := h.auth.VerifyToken(tokenStr)
		if err != nil {
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return
		}

		r.Header.Set("X-User", username)
		next(w, r)
	}
}

func (h *Handler) matchRoute(path string) (*config.Route, string) {
	for i := range h.routes {
		route := &h.routes[i]
		if strings.HasPrefix(path, route.Prefix+"/") || path == route.Prefix {
			stripped := strings.TrimPrefix(path, route.Prefix)
			if stripped == "" {
				stripped = "/"
			}
			return route, stripped
		}
	}
	return nil, path
}

func (h *Handler) HandleProxy(w http.ResponseWriter, r *http.Request) {
	if h.tm.AgentCount() == 0 {
		http.Error(w, `{"error":"no agents connected"}`, http.StatusServiceUnavailable)
		return
	}

	route, strippedPath := h.matchRoute(r.URL.Path)
	if route == nil {
		http.Error(w, `{"error":"no route matched"}`, http.StatusNotFound)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}

	headers := make(map[string]string)
	for k := range r.Header {
		if k == "Authorization" || k == "Cookie" {
			continue
		}
		headers[k] = r.Header.Get(k)
	}

	reqID := fmt.Sprintf("%d", time.Now().UnixNano())
	req := &tunnel.Request{
		ID:      reqID,
		Service: route.Service,
		Method:  r.Method,
		Path:    strippedPath,
		Headers: headers,
		Body:    body,
	}

	log.Printf("proxying %s %s → service:%s path:%s", r.Method, r.URL.Path, route.Service, strippedPath)

	resp, err := h.tm.ForwardRequest(req, 60*time.Second)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadGateway)
		return
	}

	for k, v := range resp.Headers {
		w.Header().Set(k, v)
	}
	w.WriteHeader(resp.Status)
	w.Write(resp.Body)
}

func (h *Handler) HandleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]any{
		"agents": h.tm.AgentCount(),
		"status": "ok",
	})
}
