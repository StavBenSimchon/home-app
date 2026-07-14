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
	"github.com/stavbensimchon/cloud-gateway/internal/middleware"
	"github.com/stavbensimchon/cloud-gateway/internal/tunnel"
)

type Handler struct {
	auth          *auth.Auth
	tm            *tunnel.Manager
	routes        []config.Route
	maxBodyBytes  int64
	allowedOrigin string
	loginLimiter  *middleware.RateLimiter
	proxyLimiter  *middleware.RateLimiter
}

func New(a *auth.Auth, tm *tunnel.Manager, routes []config.Route, maxBody int64, origin, loginRate, proxyRate, rateWindow int) *Handler {
	return &Handler{
		auth:          a,
		tm:            tm,
		routes:        routes,
		maxBodyBytes:  maxBody,
		allowedOrigin: origin,
		loginLimiter:  middleware.NewRateLimiter(loginRate, rateWindow),
		proxyLimiter:  middleware.NewRateLimiter(proxyRate, rateWindow),
	}
}

func (h *Handler) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/login", h.loginLimiter.Middleware(http.HandlerFunc(h.HandleLogin)))
	mux.HandleFunc("/ws", h.tm.HandleWebSocket)
	mux.HandleFunc("/health", h.HandleHealth)
	mux.HandleFunc("/", h.proxyLimiter.Middleware(http.HandlerFunc(h.AuthMiddleware(h.HandleProxy))))
	return h.withSecurityHeaders(mux)
}

func (h *Handler) withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-XSS-Protection", "1; mode=block")
		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Access-Control-Allow-Origin", h.allowedOrigin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (h *Handler) HandleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		http.ServeFile(w, r, "web/login.html")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 4096)

	var creds struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	resp, err := h.tm.ForwardRequest(&tunnel.Request{
		ID:      fmt.Sprintf("login-%d", time.Now().UnixNano()),
		Service: "auth-service",
		Method:  "POST",
		Path:    "/auth/login",
		Headers: map[string]string{"Content-Type": "application/json"},
		Body:    []byte(fmt.Sprintf(`{"username":%q,"password":%q}`, creds.Username, creds.Password)),
	}, 10*time.Second)

	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadGateway)
		return
	}

	if resp.Status != http.StatusOK {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.Status)
		w.Write(resp.Body)
		return
	}

	var authResp struct {
		UserID   string `json:"user_id"`
		Username string `json:"username"`
		Role     string `json:"role"`
	}
	if err := json.Unmarshal(resp.Body, &authResp); err != nil {
		http.Error(w, `{"error":"auth service returned invalid response"}`, http.StatusBadGateway)
		return
	}

	token, err := h.auth.SignToken(authResp.UserID, authResp.Username, authResp.Role)
	if err != nil {
		http.Error(w, `{"error":"failed to sign token"}`, http.StatusInternalServerError)
		return
	}

	log.Printf("login success: %s", authResp.Username)
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

		tokenStr := h.auth.ExtractToken(authHeader)
		claims, err := h.auth.VerifyToken(tokenStr)
		if err != nil {
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return
		}

		r.Header.Set("X-User", claims.Usr)
		r.Header.Set("X-User-ID", claims.Sub)
		r.Header.Set("X-User-Role", claims.Role)
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

	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, h.maxBodyBytes))
	if err != nil {
		http.Error(w, `{"error":"body too large or read error"}`, http.StatusRequestEntityTooLarge)
		return
	}

	headers := make(map[string]string)
	for k := range r.Header {
		if k == "Authorization" || k == "Cookie" {
			continue
		}
		headers[k] = r.Header.Get(k)
	}
	headers["X-User"] = r.Header.Get("X-User")
	headers["X-User-ID"] = r.Header.Get("X-User-ID")
	headers["X-User-Role"] = r.Header.Get("X-User-Role")

	reqID := fmt.Sprintf("%d", time.Now().UnixNano())
	req := &tunnel.Request{
		ID:      reqID,
		Service: route.Service,
		Method:  r.Method,
		Path:    strippedPath,
		Headers: headers,
		Body:    body,
	}

	log.Printf("proxying %s %s → service:%s path:%s user:%s",
		r.Method, r.URL.Path, route.Service, strippedPath, r.Header.Get("X-User"))

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
