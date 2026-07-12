FROM golang:1.24-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 go build -o /gateway ./cmd/gateway

FROM alpine:3.21

RUN apk add --no-cache ca-certificates

COPY --from=builder /gateway /gateway
COPY --from=builder /app/web /web

WORKDIR /

EXPOSE 8080

ENTRYPOINT ["/gateway"]
