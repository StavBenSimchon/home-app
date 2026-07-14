package auth

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type Auth struct {
	jwtSecret string
}

func New(jwtSecret string) *Auth {
	return &Auth{jwtSecret: jwtSecret}
}

type Claims struct {
	Sub  string `json:"sub"`
	Usr  string `json:"usr"`
	Role string `json:"role"`
	jwt.RegisteredClaims
}

func (a *Auth) SignToken(userID, username, role string) (string, error) {
	claims := Claims{
		Sub:  userID,
		Usr:  username,
		Role: role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(7 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(a.jwtSecret))
}

func (a *Auth) VerifyToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected method: %v", t.Header["alg"])
		}
		return []byte(a.jwtSecret), nil
	})
	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}

	return claims, nil
}

func (a *Auth) ExtractToken(header string) string {
	return strings.TrimPrefix(header, "Bearer ")
}
