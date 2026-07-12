package auth

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"github.com/google/uuid"

	"github.com/stavbensimchon/cloud-gateway/internal/store"
)

var ErrInvalidCredentials = errors.New("invalid credentials")

type Auth struct {
	store     *store.Store
	jwtSecret string
}

func New(s *store.Store, jwtSecret string) *Auth {
	return &Auth{store: s, jwtSecret: jwtSecret}
}

func (a *Auth) Login(username, password string) (string, error) {
	id, hash, err := a.store.GetUser(username)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrInvalidCredentials
		}
		return "", err
	}

	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return "", ErrInvalidCredentials
	}

	claims := jwt.MapClaims{
		"sub": id,
		"usr": username,
		"exp": time.Now().Add(7 * 24 * time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(a.jwtSecret))
	if err != nil {
		return "", fmt.Errorf("sign token: %w", err)
	}

	return signed, nil
}

func (a *Auth) VerifyToken(tokenStr string) (username string, err error) {
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected method: %v", t.Header["alg"])
		}
		return []byte(a.jwtSecret), nil
	})
	if err != nil {
		return "", err
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return "", errors.New("invalid token")
	}

	username, _ = claims["usr"].(string)
	return username, nil
}

func (a *Auth) CreateUser(username, password string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	id := uuid.NewString()
	return a.store.CreateUser(id, username, string(hash))
}
