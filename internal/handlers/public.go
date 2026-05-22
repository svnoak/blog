package handlers

import (
	"bytes"
	"database/sql"
	"net/http"

	"bloggy/internal/middleware"
	"bloggy/internal/models"

	"github.com/go-chi/chi/v5"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/renderer/html"
)

type PublicHandler struct {
	DB    *sql.DB
	Tmpls *Templates
	md    goldmark.Markdown
}

func NewPublicHandler(db *sql.DB, tmpls *Templates) *PublicHandler {
	md := goldmark.New(
		goldmark.WithExtensions(extension.GFM),
		goldmark.WithRendererOptions(html.WithUnsafe()),
	)
	return &PublicHandler{DB: db, Tmpls: tmpls, md: md}
}

func (h *PublicHandler) customFonts(tenantID int64) []middleware.CustomFont {
	fonts, _ := middleware.ListCustomFonts(h.DB, tenantID)
	return fonts
}

func (h *PublicHandler) Index(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	posts, err := models.ListPublishedPosts(h.DB, tenant.ID)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	h.Tmpls.Render(w, "public/index.html", map[string]any{
		"Tenant":      tenant,
		"Posts":       posts,
		"CustomFonts": h.customFonts(tenant.ID),
	})
}

func (h *PublicHandler) ShowPost(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	slug := chi.URLParam(r, "slug")

	post, err := models.GetPostBySlug(h.DB, tenant.ID, slug)
	if err != nil || post == nil {
		http.NotFound(w, r)
		return
	}

	var buf bytes.Buffer
	if err := h.md.Convert([]byte(post.Content), &buf); err != nil {
		http.Error(w, "render error", http.StatusInternalServerError)
		return
	}

	h.Tmpls.Render(w, "public/post.html", map[string]any{
		"Tenant":      tenant,
		"Post":        post,
		"Content":     buf.String(),
		"CustomFonts": h.customFonts(tenant.ID),
	})
}
