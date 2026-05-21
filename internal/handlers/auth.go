package handlers

import (
	"database/sql"
	"net/http"

	"bloggy/internal/middleware"
	"bloggy/internal/models"

	"github.com/gorilla/sessions"
)

type AuthHandler struct {
	DB    *sql.DB
	Store sessions.Store
	Tmpls *Templates
}

func (h *AuthHandler) LoginGet(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	n, err := models.CountUsers(h.DB, tenant.ID)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	if n == 0 {
		http.Redirect(w, r, "/admin/setup", http.StatusFound)
		return
	}
	h.Tmpls.Render(w, "admin/login.html", map[string]any{
		"Tenant": tenant,
		"Error":  r.URL.Query().Get("error"),
	})
}

func (h *AuthHandler) LoginPost(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	email := r.FormValue("email")
	password := r.FormValue("password")

	user, err := models.AuthenticateUser(h.DB, tenant.ID, email, password)
	if err != nil || user == nil {
		http.Redirect(w, r, "/admin/login?error=invalid", http.StatusFound)
		return
	}

	sess, _ := h.Store.Get(r, middleware.SessionName)
	sess.Values[middleware.SessionUserID] = user.ID
	sess.Save(r, w)
	http.Redirect(w, r, "/admin/posts", http.StatusFound)
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	sess, _ := h.Store.Get(r, middleware.SessionName)
	delete(sess.Values, middleware.SessionUserID)
	sess.Options.MaxAge = -1
	sess.Save(r, w)
	http.Redirect(w, r, "/", http.StatusFound)
}
