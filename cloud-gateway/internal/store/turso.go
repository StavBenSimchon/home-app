package store

import (
	"database/sql"
	"fmt"

	_ "github.com/tursodatabase/libsql-client-go/libsql"
)

type Store struct {
	db *sql.DB
}

func New(tursoURL, tursoToken string) (*Store, error) {
	dsn := tursoURL
	if tursoToken != "" {
		dsn = fmt.Sprintf("%s?authToken=%s", tursoURL, tursoToken)
	}

	db, err := sql.Open("libsql", dsn)
	if err != nil {
		return nil, fmt.Errorf("open turso: %w", err)
	}

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping turso: %w", err)
	}

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}

	return s, nil
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
	`)
	return err
}

func (s *Store) GetUser(username string) (id, passwordHash string, err error) {
	err = s.db.QueryRow(
		"SELECT id, password_hash FROM users WHERE username = ?", username,
	).Scan(&id, &passwordHash)
	return
}

func (s *Store) CreateUser(id, username, passwordHash string) error {
	_, err := s.db.Exec(
		"INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
		id, username, passwordHash,
	)
	return err
}

func (s *Store) Close() error {
	return s.db.Close()
}
