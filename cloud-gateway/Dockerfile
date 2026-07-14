FROM golang:1.24-alpine AS builder

WORKDIR /app

COPY go.mod ./
COPY . .

RUN go mod tidy
RUN CGO_ENABLED=0 go build -o /gateway ./cmd/gateway

FROM alpine:3.21

RUN apk add --no-cache ca-certificates

COPY --from=builder /gateway /gateway
COPY --from=builder /app/web /web

WORKDIR /

EXPOSE 8080

ENTRYPOINT ["/gateway"]
