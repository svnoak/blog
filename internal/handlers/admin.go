package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"

	"bloggy/internal/middleware"
	"bloggy/internal/models"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/sessions"
)

type AdminHandler struct {
	DB    *sql.DB
	Store sessions.Store
	Tmpls *Templates
}

func (h *AdminHandler) currentUser(r *http.Request) (*models.User, error) {
	userID, ok := middleware.UserIDFromCtx(r.Context())
	if !ok {
		return nil, nil
	}
	return models.GetUserByID(h.DB, userID)
}

func (h *AdminHandler) PostList(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	user, err := h.currentUser(r)
	if err != nil || user == nil {
		http.Redirect(w, r, "/admin/login", http.StatusFound)
		return
	}
	posts, err := models.ListPostsForAdmin(h.DB, tenant.ID)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	h.Tmpls.Render(w, "admin/posts.html", map[string]any{
		"Tenant": tenant,
		"User":   user,
		"Posts":  posts,
	})
}

func (h *AdminHandler) NewPost(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	user, _ := h.currentUser(r)
	h.Tmpls.Render(w, "admin/editor.html", map[string]any{
		"Tenant": tenant,
		"User":   user,
		"Post":   nil,
	})
}

func (h *AdminHandler) CreatePost(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	user, err := h.currentUser(r)
	if err != nil || user == nil {
		http.Redirect(w, r, "/admin/login", http.StatusFound)
		return
	}
	title := r.FormValue("title")
	content := r.FormValue("content")
	post, err := models.CreatePost(h.DB, tenant.ID, user.ID, title, content)
	if err != nil || post == nil {
		http.Error(w, "could not create post", http.StatusInternalServerError)
		return
	}
	if r.FormValue("action") == "publish" {
		models.PublishPost(h.DB, tenant.ID, post.ID)
		http.Redirect(w, r, "/admin/posts", http.StatusFound)
		return
	}
	// After a draft save, land on the edit page so autosave has a valid ID.
	http.Redirect(w, r, fmt.Sprintf("/admin/posts/%d/edit", post.ID), http.StatusFound)
}

func (h *AdminHandler) EditPost(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	user, _ := h.currentUser(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	post, err := models.GetPostByID(h.DB, tenant.ID, id)
	if err != nil || post == nil {
		http.NotFound(w, r)
		return
	}
	h.Tmpls.Render(w, "admin/editor.html", map[string]any{
		"Tenant": tenant,
		"User":   user,
		"Post":   post,
	})
}

func (h *AdminHandler) UpdatePost(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	title := r.FormValue("title")
	content := r.FormValue("content")
	if err := models.UpdatePost(h.DB, tenant.ID, id, title, content); err != nil {
		http.Error(w, "could not update post", http.StatusInternalServerError)
		return
	}
	if r.FormValue("action") == "publish" {
		models.PublishPost(h.DB, tenant.ID, id)
	} else if r.FormValue("action") == "unpublish" {
		models.UnpublishPost(h.DB, tenant.ID, id)
	}
	http.Redirect(w, r, "/admin/posts", http.StatusFound)
}

func (h *AdminHandler) PublishPost(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	models.PublishPost(h.DB, tenant.ID, id)
	http.Redirect(w, r, "/admin/posts", http.StatusFound)
}

func (h *AdminHandler) UnpublishPost(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	models.UnpublishPost(h.DB, tenant.ID, id)
	http.Redirect(w, r, "/admin/posts", http.StatusFound)
}

func (h *AdminHandler) DeletePost(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	models.DeletePost(h.DB, tenant.ID, id)
	http.Redirect(w, r, "/admin/posts", http.StatusFound)
}

// ── User management ───────────────────────────────────────────────────────────

func (h *AdminHandler) UserList(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	user, _ := h.currentUser(r)
	users, err := models.ListUsers(h.DB, tenant.ID)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	h.Tmpls.Render(w, "admin/users.html", map[string]any{
		"Tenant":      tenant,
		"User":        user,
		"Users":       users,
		"Error":       r.URL.Query().Get("error"),
	})
}

func (h *AdminHandler) UserNew(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	user, _ := h.currentUser(r)
	h.Tmpls.Render(w, "admin/user_new.html", map[string]any{
		"Tenant": tenant,
		"User":   user,
		"Error":  r.URL.Query().Get("error"),
	})
}

func (h *AdminHandler) UserCreate(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	name := r.FormValue("name")
	email := r.FormValue("email")
	password := r.FormValue("password")
	confirm := r.FormValue("confirm")

	if name == "" || email == "" || password == "" {
		http.Redirect(w, r, "/admin/users/new?error=required", http.StatusFound)
		return
	}
	if password != confirm {
		http.Redirect(w, r, "/admin/users/new?error=mismatch", http.StatusFound)
		return
	}
	if err := models.CreateUser(h.DB, tenant.ID, email, name, password); err != nil {
		http.Redirect(w, r, "/admin/users/new?error=exists", http.StatusFound)
		return
	}
	http.Redirect(w, r, "/admin/users", http.StatusFound)
}

func (h *AdminHandler) UserDelete(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	self, _ := h.currentUser(r)
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Redirect(w, r, "/admin/users", http.StatusFound)
		return
	}
	if self != nil && self.ID == id {
		http.Redirect(w, r, "/admin/users?error=self", http.StatusFound)
		return
	}
	models.DeleteUser(h.DB, tenant.ID, id)
	http.Redirect(w, r, "/admin/users", http.StatusFound)
}
