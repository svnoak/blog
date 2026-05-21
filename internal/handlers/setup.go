package handlers

import (
	"database/sql"
	"net/http"

	"bloggy/internal/middleware"
	"bloggy/internal/models"

	"github.com/gorilla/sessions"
)

type SetupHandler struct {
	DB    *sql.DB
	Store sessions.Store
	Tmpls *Templates
}

func (h *SetupHandler) SetupGet(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	n, err := models.CountUsers(h.DB, tenant.ID)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	if n > 0 {
		http.Redirect(w, r, "/admin/login", http.StatusFound)
		return
	}
	h.Tmpls.Render(w, "admin/setup.html", map[string]any{
		"Tenant": tenant,
		"Error":  r.URL.Query().Get("error"),
	})
}

func (h *SetupHandler) SetupPost(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())

	n, err := models.CountUsers(h.DB, tenant.ID)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	if n > 0 {
		http.Redirect(w, r, "/admin/login", http.StatusFound)
		return
	}

	name := r.FormValue("name")
	email := r.FormValue("email")
	password := r.FormValue("password")
	confirm := r.FormValue("confirm")

	if name == "" || email == "" || password == "" {
		http.Redirect(w, r, "/admin/setup?error=required", http.StatusFound)
		return
	}
	if password != confirm {
		http.Redirect(w, r, "/admin/setup?error=mismatch", http.StatusFound)
		return
	}

	if err := models.CreateUser(h.DB, tenant.ID, email, name, password); err != nil {
		http.Redirect(w, r, "/admin/setup?error=exists", http.StatusFound)
		return
	}

	http.Redirect(w, r, "/admin/login", http.StatusFound)
}
