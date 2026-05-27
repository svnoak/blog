# Bloggy

A self-hosted, multi-tenant blog platform. One binary serves multiple blogs, each on its own domain.

## Features

- Multi-tenant: add as many blogs as you like via config, each isolated by domain
- Markdown editor with live preview, autosave, and zen mode
- SQLite database — no external dependencies
- Docker-first deployment
- Image uploads, tags, scratchpad, and per-tenant settings

## Quick start

**1. Configure**

```bash
cp config.example.toml config.toml
```

Edit `config.toml` to set a secret key and define your tenants:

```toml
[server]
port       = 8080
secret_key = ""   # openssl rand -base64 32

[[tenants]]
name   = "My Blog"
domain = "localhost"
```

**2. Run**

```bash
go run ./cmd/bloggy serve
```

Then open `http://localhost:8080/setup` to create the first admin user.

## Docker

```bash
docker compose up --build
```

The database is persisted in a named volume (`bloggy-data`). Mount your own `config.toml` to configure tenants without rebuilding the image.

## Adding users

```bash
./bloggy useradd --domain example.com --email you@example.com --name "Your Name"
```

## Adding a tenant

Add a new `[[tenants]]` block to `config.toml` and restart. The tenant is upserted into the database on startup.

## Development

```bash
go run ./cmd/bloggy serve   # dev server
go test ./...               # tests
go vet ./...                # vet
```

## Deployment

CI runs `go vet` and `go test` on every push, then builds a Docker image. On a successful run against `main`, the image is pushed to GitHub Container Registry as `ghcr.io/svnoak/bloggy:latest`.

## Tech stack

- **Go** — chi router, gorilla/sessions, goldmark (Markdown)
- **SQLite** — `modernc.org/sqlite` (pure Go, no CGO)
- **Vanilla JS** — no bundler; editor split across `static/js/editor/`
- **Docker** — single-stage build, config mounted at runtime
