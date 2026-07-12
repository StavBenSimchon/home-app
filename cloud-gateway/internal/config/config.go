package config

import (
	"os"
)

type Config struct {
	ListenAddr    string
	TursoURL      string
	TursoToken    string
	JWTSecret     string
	AgentToken    string
	LocalAppURL   string
}

func Load() *Config {
	return &Config{
		ListenAddr:  getEnv("LISTEN_ADDR", ":8080"),
		TursoURL:    getEnv("TURSO_URL", ""),
		TursoToken:  getEnv("TURSO_TOKEN", ""),
		JWTSecret:   getEnv("JWT_SECRET", "change-me-in-production"),
		AgentToken:  getEnv("AGENT_TOKEN", ""),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
