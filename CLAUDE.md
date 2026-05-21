# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run the dev server
go run ./cmd/bloggy serve

# Build the binary
go build ./cmd/bloggy

# Run tests
go test ./...

# Add a user via CLI (prompts for password)
./bloggy useradd --domain localhost --email you@example.com --name "Your Name"

# Docker
docker compose up --build
```

There is no linter configured; use standard `go vet ./...`.

## Architecture

Bloggy is a multi-tenant blog platform. A single binary (`cmd/bloggy`) serves all tenants; the tenant is resolved from the `Host` request header on every request via `TenantMiddleware` and stored in context. All DB queries include `tenant_id` as a scope.

**Request flow:**
1. `TenantMiddleware` looks up `Host` in `tenants` table → injects `*Tenant` into context (404 if unknown)
2. `RequireAuth` (admin routes only) reads the gorilla session and injects `userID` into context
3. Handlers (`AuthHandler`, `AdminHandler`, `PublicHandler`, `SetupHandler`) read tenant/user from context and call model functions
4. `Templates.Render` executes a named Go template from the shared `*template.Template` loaded at startup

**Database:** SQLite via `modernc.org/sqlite` (pure Go, no CGO). Schema migration runs inline in `db.Open` via `CREATE TABLE IF NOT EXISTS`. `MaxOpenConns=1` because SQLite is single-writer. The DB path can be overridden with `BLOGGY_DB_PATH` env var (used in Docker).

**Tenants** are declared in `config.toml` under `[[tenants]]` and upserted into the DB on `serve` startup. Adding a new tenant requires adding it to `config.toml` and restarting.

**Content** is stored as Markdown in the `posts.content` column. The public view renders it to HTML server-side via goldmark. The editor stores and autosaves Markdown regardless of which editor mode the user is in.

## Editor JS (`static/js/editor/`)

Four vanilla JS files, no bundler, loaded in order by `templates/admin/editor.html`:

| File | Responsibility |
|------|---------------|
| `md-utils.js` | `mdToHtml`, `htmlToMd`, `getStats` — pure conversion/stats functions |
| `bubble.js` | `initBubble(editorEl)` — selection bubble for inline formatting |
| `toolbar.js` | `initToolbar(rowEl, opts)` — persistent formatting toolbar |
| `app.js` | Orchestrator: mode switching, autosave, focus/zen mode, themes, keyboard shortcuts |

`app.js` exposes `window._editorGetMode` and `window._editorOnChange` for `toolbar.js` to call back into. Template globals (`EDITOR_POST_ID`, `EDITOR_IS_PUBLISHED`, `EDITOR_FORM_ACTION`) are injected by the Go template via `<script>` before the JS files load.

Autosave triggers 2 s after any change, but only when `POST_ID > 0` (i.e., not on the "new post" form — the first save redirects to the edit URL).

## Templates

Loaded from disk at startup with `filepath.WalkDir("templates")`. All `.html` files are registered under their relative path (e.g., `admin/editor.html`). Template names match that path exactly. Custom funcs: `formatDate`, `formatDateVal`, `safeHTML`, `jsonString`.
