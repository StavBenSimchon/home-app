package main

import (
	"log"
	"net/http"

	"github.com/stavbensimchon/cloud-gateway/internal/auth"
	"github.com/stavbensimchon/cloud-gateway/internal/config"
	"github.com/stavbensimchon/cloud-gateway/internal/handler"
	"github.com/stavbensimchon/cloud-gateway/internal/store"
	"github.com/stavbensimchon/cloud-gateway/internal/tunnel"
)

func main() {
	cfg := config.Load()

	db, err := store.New(cfg.TursoURL, cfg.TursoToken)
	if err != nil {
		log.Fatalf("failed to connect to turso: %v", err)
	}
	defer db.Close()

	a := auth.New(db, cfg.JWTSecret)
	tm := tunnel.NewManager()
	h := handler.New(a, tm)

	mux := http.NewServeMux()
	mux.HandleFunc("/login", h.HandleLogin)
	mux.HandleFunc("/ws", tm.HandleWebSocket)
	mux.HandleFunc("/health", h.HandleHealth)
	mux.HandleFunc("/", h.AuthMiddleware(h.HandleProxy))

	log.Printf("cloud gateway listening on %s", cfg.ListenAddr)
	log.Fatal(http.ListenAndServe(cfg.ListenAddr, mux))
}
