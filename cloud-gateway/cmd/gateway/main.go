package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"

	"github.com/stavbensimchon/cloud-gateway/internal/auth"
	"github.com/stavbensimchon/cloud-gateway/internal/config"
	"github.com/stavbensimchon/cloud-gateway/internal/handler"
	"github.com/stavbensimchon/cloud-gateway/internal/store"
	"github.com/stavbensimchon/cloud-gateway/internal/tunnel"
)

func main() {
	createUser := flag.String("create-user", "", "create a user (format: username:password)")
	flag.Parse()

	cfg := config.Load()

	db, err := store.New(cfg.TursoURL, cfg.TursoToken)
	if err != nil {
		log.Fatalf("failed to connect to turso: %v", err)
	}
	defer db.Close()

	a := auth.New(db, cfg.JWTSecret)

	if *createUser != "" {
		var username, password string
		if n, err := fmt.Sscanf(*createUser, "%[^:]:%s", &username, &password); n != 2 || err != nil {
			log.Fatalf("format: -create-user username:password")
		}
		if err := a.CreateUser(username, password); err != nil {
			log.Fatalf("create user: %v", err)
		}
		log.Printf("user %q created", username)
		return
	}

	tm, err := tunnel.NewManager(cfg.AgentCACert)
	if err != nil {
		log.Fatalf("tunnel manager: %v", err)
	}

	h := handler.New(a, tm, cfg.Routes)

	mux := http.NewServeMux()
	mux.HandleFunc("/login", h.HandleLogin)
	mux.HandleFunc("/ws", tm.HandleWebSocket)
	mux.HandleFunc("/health", h.HandleHealth)
	mux.HandleFunc("/", h.AuthMiddleware(h.HandleProxy))

	log.Printf("cloud gateway listening on %s", cfg.ListenAddr)
	if cfg.TLSCert != "" && cfg.TLSKey != "" {
		log.Printf("TLS enabled: cert=%s", cfg.TLSCert)
		log.Fatal(http.ListenAndServeTLS(cfg.ListenAddr, cfg.TLSCert, cfg.TLSKey, mux))
	} else {
		log.Println("WARNING: TLS disabled (plain HTTP)")
		log.Fatal(http.ListenAndServe(cfg.ListenAddr, mux))
	}
}
