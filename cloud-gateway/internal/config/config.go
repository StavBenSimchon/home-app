package config

import (
	"os"
	"strings"
)

type Route struct {
	Prefix      string
	Service     string
	StripPrefix bool
}

type Config struct {
	ListenAddr    string
	TLSCert       string
	TLSKey        string
	JWTSecret     string
	AgentCACert   string
	Routes        []Route
	MaxBodyBytes  int64
	LoginRateMax  int
	ProxyRateMax  int
	RateWindowSec int
	MaxAgents     int
	AllowedOrigin string
}

func Load() *Config {
	cfg := &Config{
		ListenAddr:    getEnv("LISTEN_ADDR", ":8080"),
		TLSCert:       getEnv("TLS_CERT", ""),
		TLSKey:        getEnv("TLS_KEY", ""),
		JWTSecret:     getEnv("JWT_SECRET", "change-me-in-production"),
		AgentCACert:   getEnv("AGENT_CA_CERT", ""),
		MaxBodyBytes:  10 * 1024 * 1024, // 10MB
		LoginRateMax:  5,
		ProxyRateMax:  1000,
		RateWindowSec: 60,
		MaxAgents:     2,
		AllowedOrigin: getEnv("ALLOWED_ORIGIN", "*"),
	}

	routeStr := getEnv("ROUTES", "/auth=auth-service,/home-app=home-app")
	for _, r := range strings.Split(routeStr, ",") {
		parts := strings.SplitN(strings.TrimSpace(r), "=", 2)
		if len(parts) == 2 {
			cfg.Routes = append(cfg.Routes, Route{
				Prefix:      strings.TrimSuffix(parts[0], "/"),
				Service:     parts[1],
				StripPrefix: true,
			})
		}
	}

	return cfg
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
