package handlers

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"html/template"
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
)

type AdminHandler struct {
	DB    *sql.DB
	Store sessions.Store
	Tmpls *Templates
}

func (h *AdminHandler) currentUser(r *http.Request) (*models.User, error) {
	tenant := middleware.TenantFromCtx(r.Context())
	userID, ok := middleware.UserIDFromCtx(r.Context())
	if !ok {
		return nil, nil
	}
	return models.GetUserByID(h.DB, tenant.ID, userID)
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
	)
	var buf bytes.Buffer
	if err := md.Convert([]byte(post.Content), &buf); err != nil {
		http.Error(w, "render error", http.StatusInternalServerError)
		return
	}

	h.Tmpls.Render(w, "public/post.html", map[string]any{
		"Tenant":      tenant,
		"Post":        post,
		"Content":     template.HTML(buf.String()),
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

	file, _, err := r.FormFile("image")
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
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnsupportedMediaType)
		w.Write([]byte(`{"error":"unsupported file type"}`))
		return
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

// ── Scratchpad ────────────────────────────────────────────────────────────────

var scratchpadColors = map[string]bool{
	"amber": true, "mint": true, "peach": true,
	"sky": true, "lilac": true, "ivory": true,
}

var scratchpadUID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
var scratchpadAnchorID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

const (
	scratchpadMaxNotes    = 200
	scratchpadMaxTextLen  = 20000
	scratchpadDefaultColor = "amber"
)

func (h *AdminHandler) ScratchpadList(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	user, err := h.currentUser(r)
	if err != nil || user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}
	post, err := models.GetPostByID(h.DB, tenant.ID, id)
	if err != nil || post == nil {
		http.NotFound(w, r)
		return
	}
	notes, err := models.ListScratchpadNotes(h.DB, tenant.ID, post.ID, user.ID)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(notes)
}

func (h *AdminHandler) ScratchpadReplace(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	user, err := h.currentUser(r)
	if err != nil || user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}
	post, err := models.GetPostByID(h.DB, tenant.ID, id)
	if err != nil || post == nil {
		http.NotFound(w, r)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 4<<20) // 4 MB ceiling for the whole list
	var incoming []models.ScratchpadNote
	if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if len(incoming) > scratchpadMaxNotes {
		http.Error(w, "too many notes", http.StatusRequestEntityTooLarge)
		return
	}

	seen := make(map[string]bool, len(incoming))
	for i := range incoming {
		n := &incoming[i]
		if !scratchpadUID.MatchString(n.UID) {
			http.Error(w, "bad note id", http.StatusBadRequest)
			return
		}
		if seen[n.UID] {
			http.Error(w, "duplicate note id", http.StatusBadRequest)
			return
		}
		seen[n.UID] = true
		if !scratchpadColors[n.Color] {
			n.Color = scratchpadDefaultColor
		}
		if n.Tilt < -10 {
			n.Tilt = -10
		} else if n.Tilt > 10 {
			n.Tilt = 10
		}
		if len(n.Text) > scratchpadMaxTextLen {
			n.Text = n.Text[:scratchpadMaxTextLen]
		}
		if n.AnchorID != "" && !scratchpadAnchorID.MatchString(n.AnchorID) {
			n.AnchorID = ""
		}
	}

	if err := models.ReplaceScratchpadNotes(h.DB, tenant.ID, post.ID, user.ID, incoming); err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
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

	// Validate WOFF2 magic bytes (wOF2) before trusting the filename.
	magic := make([]byte, 4)
	if n, _ := file.Read(magic); n < 4 || string(magic) != "wOF2" {
		http.Redirect(w, r, "/admin/settings?font_error=type", http.StatusFound)
		return
	}
	if seeker, ok := file.(interface{ Seek(int64, int) (int64, error) }); ok {
		seeker.Seek(0, 0)
	}

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
	// Invalidate the current session so the old password can no longer be used.
	sess, _ := h.Store.Get(r, middleware.SessionName)
	delete(sess.Values, middleware.SessionUserID)
	sess.Options.MaxAge = -1
	sess.Save(r, w)
	http.Redirect(w, r, "/admin/login", http.StatusFound)
}

// ── About page editor ─────────────────────────────────────────────────────────

func (h *AdminHandler) AboutGet(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	user, _ := h.currentUser(r)
	h.Tmpls.Render(w, "admin/about.html", map[string]any{
		"Tenant":      tenant,
		"User":        user,
		"CustomFonts": h.customFonts(tenant.ID),
		"PortraitErr": r.URL.Query().Get("portrait_error"),
		"Saved":       r.URL.Query().Get("saved") == "1",
	})
}

func (h *AdminHandler) AboutPost(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	name := strings.TrimSpace(r.FormValue("about_name"))
	handle := strings.TrimSpace(r.FormValue("about_handle"))
	email := strings.TrimSpace(r.FormValue("about_email"))
	since := strings.TrimSpace(r.FormValue("about_since"))
	md := r.FormValue("about_md")
	tagline := strings.TrimSpace(r.FormValue("about_tagline"))

	// Light caps — keep the column reasonable in size.
	if len(md) > 50000 {
		md = md[:50000]
	}
	if len(name) > 100 {
		name = name[:100]
	}
	if len(handle) > 60 {
		handle = handle[:60]
	}
	if len(email) > 120 {
		email = email[:120]
	}
	if len(since) > 80 {
		since = since[:80]
	}
	if len(tagline) > 120 {
		tagline = tagline[:120]
	}

	if err := middleware.UpdateTenantAbout(h.DB, tenant.ID, name, handle, email, since, md, tagline); err != nil {
		http.Error(w, "could not save", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/admin/about?saved=1", http.StatusFound)
}

var portraitErrorMsg = map[string]string{
	"toobig": "Portrait too large (max 4 MB).",
	"type":   "Only JPEG, PNG, or WebP images are accepted.",
	"file":   "No file received.",
	"save":   "Could not save portrait.",
}

func (h *AdminHandler) PortraitUpload(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())

	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	if err := r.ParseMultipartForm(4 << 20); err != nil {
		http.Redirect(w, r, "/admin/about?portrait_error=toobig", http.StatusFound)
		return
	}

	file, header, err := r.FormFile("portrait")
	if err != nil {
		http.Redirect(w, r, "/admin/about?portrait_error=file", http.StatusFound)
		return
	}
	defer file.Close()

	buf := make([]byte, 512)
	n, _ := file.Read(buf)
	mime := http.DetectContentType(buf[:n])
	if seeker, ok := file.(interface{ Seek(int64, int) (int64, error) }); ok {
		seeker.Seek(0, 0)
	}

	ext := allowedImageTypes[mime]
	if ext == "" || ext == ".gif" {
		ext = strings.ToLower(filepath.Ext(header.Filename))
		if ext == ".jpeg" {
			ext = ".jpg"
		}
	}
	if ext != ".jpg" && ext != ".png" && ext != ".webp" {
		http.Redirect(w, r, "/admin/about?portrait_error=type", http.StatusFound)
		return
	}

	filename := fmt.Sprintf("%d_%s%s", tenant.ID, uuid.New().String(), ext)
	dest := filepath.Join("static", "images", "portraits", filename)

	out, err := os.Create(dest)
	if err != nil {
		http.Redirect(w, r, "/admin/about?portrait_error=save", http.StatusFound)
		return
	}
	defer out.Close()
	if _, err := io.Copy(out, file); err != nil {
		os.Remove(dest)
		http.Redirect(w, r, "/admin/about?portrait_error=save", http.StatusFound)
		return
	}

	// Replace any previous portrait so we don't leak files.
	if tenant.PortraitFilename != "" {
		os.Remove(filepath.Join("static", "images", "portraits", tenant.PortraitFilename))
	}
	middleware.UpdateTenantPortrait(h.DB, tenant.ID, filename)
	http.Redirect(w, r, "/admin/about?saved=1", http.StatusFound)
}

func (h *AdminHandler) PortraitDelete(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	if tenant.PortraitFilename != "" {
		os.Remove(filepath.Join("static", "images", "portraits", tenant.PortraitFilename))
	}
	middleware.UpdateTenantPortrait(h.DB, tenant.ID, "")
	http.Redirect(w, r, "/admin/about", http.StatusFound)
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
