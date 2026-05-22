package handlers

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"bloggy/internal/middleware"
	"bloggy/internal/models"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/gorilla/sessions"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/renderer/html"
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
		"Tenant":      tenant,
		"User":        user,
		"Posts":       posts,
		"CustomFonts": h.customFonts(tenant.ID),
	})
}

func (h *AdminHandler) NewPost(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	user, _ := h.currentUser(r)
	h.Tmpls.Render(w, "admin/editor.html", map[string]any{
		"Tenant":      tenant,
		"User":        user,
		"Post":        nil,
		"CustomFonts": h.customFonts(tenant.ID),
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
	models.SetPostTags(h.DB, tenant.ID, post.ID, r.FormValue("tags"))
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
	models.LoadTagsForPosts(h.DB, []*models.Post{post})
	h.Tmpls.Render(w, "admin/editor.html", map[string]any{
		"Tenant":      tenant,
		"User":        user,
		"Post":        post,
		"CustomFonts": h.customFonts(tenant.ID),
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
	models.SetPostTags(h.DB, tenant.ID, id, r.FormValue("tags"))
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

func (h *AdminHandler) PreviewPost(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
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

	md := goldmark.New(
		goldmark.WithExtensions(extension.GFM),
		goldmark.WithRendererOptions(html.WithUnsafe()),
	)
	var buf bytes.Buffer
	if err := md.Convert([]byte(post.Content), &buf); err != nil {
		http.Error(w, "render error", http.StatusInternalServerError)
		return
	}

	h.Tmpls.Render(w, "public/post.html", map[string]any{
		"Tenant":      tenant,
		"Post":        post,
		"Content":     buf.String(),
		"CustomFonts": h.customFonts(tenant.ID),
		"LoggedIn":    true,
		"BaseURL":     "",
		"Excerpt":     "",
		"IsPreview":   true,
	})
}

// ── Image upload ──────────────────────────────────────────────────────────────

var allowedImageTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/gif":  ".gif",
	"image/webp": ".webp",
}

func (h *AdminHandler) ImageUpload(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())

	r.Body = http.MaxBytesReader(w, r.Body, 10<<20) // 10 MB
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, `{"error":"file too large"}`, http.StatusRequestEntityTooLarge)
		return
	}

	file, header, err := r.FormFile("image")
	if err != nil {
		http.Error(w, `{"error":"no file"}`, http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Detect MIME type from the first 512 bytes
	buf := make([]byte, 512)
	n, _ := file.Read(buf)
	mime := http.DetectContentType(buf[:n])
	// Seek back to start
	if seeker, ok := file.(interface{ Seek(int64, int) (int64, error) }); ok {
		seeker.Seek(0, 0)
	}

	ext, ok := allowedImageTypes[mime]
	if !ok {
		// Also try by file extension as a fallback
		ext = strings.ToLower(filepath.Ext(header.Filename))
		if ext != ".jpg" && ext != ".jpeg" && ext != ".png" && ext != ".gif" && ext != ".webp" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnsupportedMediaType)
			w.Write([]byte(`{"error":"unsupported file type"}`))
			return
		}
		if ext == ".jpeg" {
			ext = ".jpg"
		}
	}

	filename := fmt.Sprintf("%d_%s%s", tenant.ID, uuid.New().String(), ext)
	dest := filepath.Join("static", "images", "user", filename)

	out, err := os.Create(dest)
	if err != nil {
		http.Error(w, `{"error":"could not save file"}`, http.StatusInternalServerError)
		return
	}
	defer out.Close()
	if _, err := io.Copy(out, file); err != nil {
		os.Remove(dest)
		http.Error(w, `{"error":"could not save file"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"url": "/static/images/user/" + filename})
}

// ── Settings ──────────────────────────────────────────────────────────────────

func (h *AdminHandler) customFonts(tenantID int64) []middleware.CustomFont {
	fonts, _ := middleware.ListCustomFonts(h.DB, tenantID)
	return fonts
}

var fontErrorMsg = map[string]string{
	"toobig": "File too large (max 3 MB).",
	"type":   "Only .woff2 files are accepted.",
	"exists": "A font with that name already exists.",
	"name":   "Please enter a font name.",
	"file":   "No file received.",
}

func (h *AdminHandler) SettingsGet(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	user, _ := h.currentUser(r)
	h.Tmpls.Render(w, "admin/settings.html", map[string]any{
		"Tenant":      tenant,
		"User":        user,
		"CustomFonts": h.customFonts(tenant.ID),
		"FontError":   fontErrorMsg[r.URL.Query().Get("font_error")],
	})
}

func (h *AdminHandler) SettingsPost(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	middleware.UpdateTenantName(h.DB, tenant.ID, r.FormValue("blog_name"))
	middleware.UpdateTenantThemes(h.DB, tenant.ID, r.FormValue("light_theme"), r.FormValue("dark_theme"))
	middleware.UpdateTenantFonts(h.DB, tenant.ID, r.FormValue("pub_font"), r.FormValue("admin_font"))
	http.Redirect(w, r, "/admin/settings", http.StatusFound)
}

var safeFontName = regexp.MustCompile(`[^a-zA-Z0-9 \-]`)

func (h *AdminHandler) FontUpload(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())

	r.Body = http.MaxBytesReader(w, r.Body, 3<<20) // 3 MB
	if err := r.ParseMultipartForm(3 << 20); err != nil {
		http.Redirect(w, r, "/admin/settings?font_error=toobig", http.StatusFound)
		return
	}

	name := strings.TrimSpace(safeFontName.ReplaceAllString(r.FormValue("font_name"), ""))
	if name == "" {
		http.Redirect(w, r, "/admin/settings?font_error=name", http.StatusFound)
		return
	}

	file, header, err := r.FormFile("font_file")
	if err != nil {
		http.Redirect(w, r, "/admin/settings?font_error=file", http.StatusFound)
		return
	}
	defer file.Close()

	if !strings.HasSuffix(strings.ToLower(header.Filename), ".woff2") {
		http.Redirect(w, r, "/admin/settings?font_error=type", http.StatusFound)
		return
	}

	// Sanitize filename: tenantID_sanitizedName.woff2
	safeName := strings.ReplaceAll(strings.ToLower(name), " ", "-")
	filename := fmt.Sprintf("%d_%s.woff2", tenant.ID, safeName)
	dest := filepath.Join("static", "fonts", "user", filename)

	out, err := os.Create(dest)
	if err != nil {
		http.Error(w, "could not save font", http.StatusInternalServerError)
		return
	}
	defer out.Close()
	if _, err := io.Copy(out, file); err != nil {
		os.Remove(dest)
		http.Error(w, "could not save font", http.StatusInternalServerError)
		return
	}

	if err := middleware.AddCustomFont(h.DB, tenant.ID, name, filename); err != nil {
		os.Remove(dest)
		http.Redirect(w, r, "/admin/settings?font_error=exists", http.StatusFound)
		return
	}

	http.Redirect(w, r, "/admin/settings", http.StatusFound)
}

func (h *AdminHandler) FontDelete(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Redirect(w, r, "/admin/settings", http.StatusFound)
		return
	}
	filename, err := middleware.DeleteCustomFont(h.DB, tenant.ID, id)
	if err == nil && filename != "" {
		os.Remove(filepath.Join("static", "fonts", "user", filename))
	}
	http.Redirect(w, r, "/admin/settings", http.StatusFound)
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

func (h *AdminHandler) AccountGet(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	user, _ := h.currentUser(r)
	h.Tmpls.Render(w, "admin/account.html", map[string]any{
		"Tenant":      tenant,
		"User":        user,
		"CustomFonts": h.customFonts(tenant.ID),
		"Error":       r.URL.Query().Get("error"),
		"Success":     r.URL.Query().Get("success"),
	})
}

func (h *AdminHandler) AccountPost(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	user, err := h.currentUser(r)
	if err != nil || user == nil {
		http.Redirect(w, r, "/admin/login", http.StatusFound)
		return
	}
	current := r.FormValue("current_password")
	newPw := r.FormValue("new_password")
	confirm := r.FormValue("confirm_password")

	if current == "" || newPw == "" {
		http.Redirect(w, r, "/admin/account?error=required", http.StatusFound)
		return
	}
	if newPw != confirm {
		http.Redirect(w, r, "/admin/account?error=mismatch", http.StatusFound)
		return
	}
	if len(newPw) < 8 {
		http.Redirect(w, r, "/admin/account?error=short", http.StatusFound)
		return
	}
	if err := models.ChangePassword(h.DB, tenant.ID, user.ID, current, newPw); err != nil {
		if err.Error() == "wrong password" {
			http.Redirect(w, r, "/admin/account?error=wrong", http.StatusFound)
			return
		}
		http.Error(w, "could not change password", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/admin/account?success=1", http.StatusFound)
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
