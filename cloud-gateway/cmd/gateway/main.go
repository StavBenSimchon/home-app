package main

import (
	"log"
	"net/http"

	"github.com/stavbensimchon/cloud-gateway/internal/auth"
	"github.com/stavbensimchon/cloud-gateway/internal/config"
	"github.com/stavbensimchon/cloud-gateway/internal/handler"
	"github.com/stavbensimchon/cloud-gateway/internal/tunnel"
)

func main() {
	cfg := config.Load()

	a := auth.New(cfg.JWTSecret)

	tm, err := tunnel.NewManager(cfg.AgentCACert, cfg.MaxAgents)
	if err != nil {
		log.Fatalf("tunnel manager: %v", err)
	}

	h := handler.New(a, tm, cfg.Routes, cfg.MaxBodyBytes, cfg.AllowedOrigin,
		cfg.LoginRateMax, cfg.ProxyRateMax, cfg.RateWindowSec)

	log.Printf("cloud gateway listening on %s", cfg.ListenAddr)
	if cfg.TLSCert != "" && cfg.TLSKey != "" {
		log.Printf("TLS enabled: cert=%s", cfg.TLSCert)
		log.Fatal(http.ListenAndServeTLS(cfg.ListenAddr, cfg.TLSCert, cfg.TLSKey, h.Routes()))
	} else {
		log.Println("WARNING: TLS disabled (plain HTTP)")
		log.Fatal(http.ListenAndServe(cfg.ListenAddr, h.Routes()))
	}
}
