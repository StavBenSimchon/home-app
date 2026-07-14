package middleware

import (
	"net/http"
	"strconv"
	"sync"
	"time"
)

type visitor struct {
	count    int
	windowStart time.Time
}

type RateLimiter struct {
	mu        sync.Mutex
	visitors  map[string]*visitor
	maxReq    int
	windowSec int
}

func NewRateLimiter(maxReq, windowSec int) *RateLimiter {
	return &RateLimiter{
		visitors:  make(map[string]*visitor),
		maxReq:    maxReq,
		windowSec: windowSec,
	}
}

func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	go rl.cleanup()

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
			ip = forwarded
		}

		rl.mu.Lock()
		v, exists := rl.visitors[ip]
		now := time.Now()

		if !exists || now.Sub(v.windowStart) > time.Duration(rl.windowSec)*time.Second {
			rl.visitors[ip] = &visitor{count: 1, windowStart: now}
			rl.mu.Unlock()
			next.ServeHTTP(w, r)
			return
		}

		v.count++
		if v.count > rl.maxReq {
			rl.mu.Unlock()
			w.Header().Set("Retry-After", strconv.Itoa(rl.windowSec))
			http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
			return
		}
		rl.mu.Unlock()

		next.ServeHTTP(w, r)
	})
}

func (rl *RateLimiter) cleanup() {
	ticker := time.NewTicker(time.Duration(rl.windowSec) * time.Second)
	for range ticker.C {
		rl.mu.Lock()
		now := time.Now()
		for ip, v := range rl.visitors {
			if now.Sub(v.windowStart) > time.Duration(rl.windowSec)*time.Second {
				delete(rl.visitors, ip)
			}
		}
		rl.mu.Unlock()
	}
}
