# ── Build stage ──────────────────────────────────────────────────────────────
FROM golang:1.26-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o bloggy ./cmd/bloggy

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM alpine:3.21

WORKDIR /app

# ca-certificates for any future HTTPS outbound calls
RUN apk add --no-cache ca-certificates && mkdir /data

COPY --from=builder /app/bloggy      ./bloggy
COPY --from=builder /app/templates   ./templates
COPY --from=builder /app/static      ./static
COPY --from=builder /app/config.toml ./config.toml

# /data holds the SQLite database; mount a volume here for persistence
VOLUME ["/data"]

ENV BLOGGY_DB_PATH=/data/bloggy.db

EXPOSE 8080

ENTRYPOINT ["./bloggy"]
CMD ["serve"]
