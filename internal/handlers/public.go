package handlers

import (
	"bytes"
	"database/sql"
	"encoding/xml"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"bloggy/internal/middleware"
	"bloggy/internal/models"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/sessions"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/renderer/html"
)

type atomFeed struct {
	XMLName xml.Name    `xml:"feed"`
	XMLNS   string      `xml:"xmlns,attr"`
	Title   string      `xml:"title"`
	Links   []atomLink  `xml:"link"`
	ID      string      `xml:"id"`
	Updated string      `xml:"updated"`
	Entries []atomEntry `xml:"entry"`
}

type atomLink struct {
	Href string `xml:"href,attr"`
	Rel  string `xml:"rel,attr,omitempty"`
}

type atomEntry struct {
	Title     string      `xml:"title"`
	Links     []atomLink  `xml:"link"`
	ID        string      `xml:"id"`
	Published string      `xml:"published"`
	Updated   string      `xml:"updated"`
	Author    atomPerson  `xml:"author"`
	Content   atomContent `xml:"content"`
}

type atomPerson struct {
	Name string `xml:"name"`
}

type atomContent struct {
	Type    string `xml:"type,attr"`
	Content string `xml:",chardata"`
}

type PublicHandler struct {
	DB    *sql.DB
	Tmpls *Templates
	Store sessions.Store
	md    goldmark.Markdown
}

func NewPublicHandler(db *sql.DB, tmpls *Templates, store sessions.Store) *PublicHandler {
	md := goldmark.New(
		goldmark.WithExtensions(extension.GFM),
		goldmark.WithRendererOptions(html.WithUnsafe()),
	)
	return &PublicHandler{DB: db, Tmpls: tmpls, Store: store, md: md}
}

func (h *PublicHandler) customFonts(tenantID int64) []middleware.CustomFont {
	fonts, _ := middleware.ListCustomFonts(h.DB, tenantID)
	return fonts
}

func siteBaseURL(r *http.Request) string {
	scheme := "https"
	if r.TLS == nil && r.Header.Get("X-Forwarded-Proto") != "https" {
		scheme = "http"
	}
	return fmt.Sprintf("%s://%s", scheme, r.Host)
}

var stripTags = regexp.MustCompile(`<[^>]+>`)

func plainExcerpt(htmlContent string, maxLen int) string {
	plain := stripTags.ReplaceAllString(htmlContent, " ")
	plain = strings.Join(strings.Fields(plain), " ")
	if len(plain) > maxLen {
		plain = plain[:maxLen] + "…"
	}
	return plain
}

const postsPerPage = 10

func (h *PublicHandler) Index(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())

	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}

	total, err := models.CountPublishedPosts(h.DB, tenant.ID)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}

	totalPages := (total + postsPerPage - 1) / postsPerPage
	if totalPages < 1 {
		totalPages = 1
	}
	if page > totalPages {
		page = totalPages
	}

	posts, err := models.ListPublishedPostsPaged(h.DB, tenant.ID, (page-1)*postsPerPage, postsPerPage)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	models.LoadTagsForPosts(h.DB, posts)

	h.Tmpls.Render(w, "public/index.html", map[string]any{
		"Tenant":      tenant,
		"Posts":       posts,
		"CustomFonts": h.customFonts(tenant.ID),
		"BaseURL":     siteBaseURL(r),
		"Page":        page,
		"TotalPages":  totalPages,
		"HasPrev":     page > 1,
		"HasNext":     page < totalPages,
		"PrevPage":    page - 1,
		"NextPage":    page + 1,
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

	loggedIn := false
	if h.Store != nil {
		if sess, err := h.Store.Get(r, middleware.SessionName); err == nil {
			_, loggedIn = sess.Values[middleware.SessionUserID].(int64)
		}
	}

	models.LoadTagsForPosts(h.DB, []*models.Post{post})
	base := siteBaseURL(r)
	h.Tmpls.Render(w, "public/post.html", map[string]any{
		"Tenant":      tenant,
		"Post":        post,
		"Content":     buf.String(),
		"CustomFonts": h.customFonts(tenant.ID),
		"LoggedIn":    loggedIn,
		"BaseURL":     base,
		"Excerpt":     plainExcerpt(buf.String(), 200),
	})
}

func (h *PublicHandler) Sitemap(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	posts, err := models.ListPublishedPosts(h.DB, tenant.ID)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}

	base := siteBaseURL(r)

	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>` + "\n"))
	w.Write([]byte(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` + "\n"))
	fmt.Fprintf(w, "  <url><loc>%s/</loc></url>\n", base)
	for _, p := range posts {
		lastmod := p.UpdatedAt.UTC().Format("2006-01-02")
		fmt.Fprintf(w, "  <url><loc>%s/posts/%s</loc><lastmod>%s</lastmod></url>\n", base, p.Slug, lastmod)
	}
	w.Write([]byte(`</urlset>` + "\n"))
}

func (h *PublicHandler) Feed(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	posts, err := models.ListPublishedPostsN(h.DB, tenant.ID, 20)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}

	base := siteBaseURL(r)

	updated := time.Now().UTC().Format(time.RFC3339)
	if len(posts) > 0 && posts[0].PublishedAt != nil {
		updated = posts[0].PublishedAt.UTC().Format(time.RFC3339)
	}

	feed := atomFeed{
		XMLNS:   "http://www.w3.org/2005/Atom",
		Title:   tenant.Name,
		Links:   []atomLink{{Href: base, Rel: "alternate"}, {Href: base + "/feed.xml", Rel: "self"}},
		ID:      base + "/",
		Updated: updated,
	}

	for _, p := range posts {
		var buf bytes.Buffer
		h.md.Convert([]byte(p.Content), &buf)

		pubTime := p.CreatedAt.UTC().Format(time.RFC3339)
		if p.PublishedAt != nil {
			pubTime = p.PublishedAt.UTC().Format(time.RFC3339)
		}

		feed.Entries = append(feed.Entries, atomEntry{
			Title:     p.Title,
			Links:     []atomLink{{Href: base + "/posts/" + p.Slug}},
			ID:        base + "/posts/" + p.Slug,
			Published: pubTime,
			Updated:   p.UpdatedAt.UTC().Format(time.RFC3339),
			Author:    atomPerson{Name: p.AuthorName},
			Content:   atomContent{Type: "html", Content: buf.String()},
		})
	}

	w.Header().Set("Content-Type", "application/atom+xml; charset=utf-8")
	w.Write([]byte(xml.Header))
	enc := xml.NewEncoder(w)
	enc.Indent("", "  ")
	enc.Encode(feed)
}

func (h *PublicHandler) TagIndex(w http.ResponseWriter, r *http.Request) {
	tenant := middleware.TenantFromCtx(r.Context())
	tagSlug := chi.URLParam(r, "slug")

	tag, err := models.GetTagBySlug(h.DB, tenant.ID, tagSlug)
	if err != nil || tag == nil {
		http.NotFound(w, r)
		return
	}

	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}

	total, err := models.CountPublishedPostsByTag(h.DB, tenant.ID, tagSlug)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}

	totalPages := (total + postsPerPage - 1) / postsPerPage
	if totalPages < 1 {
		totalPages = 1
	}
	if page > totalPages {
		page = totalPages
	}

	posts, err := models.ListPublishedPostsByTagPaged(h.DB, tenant.ID, tagSlug, (page-1)*postsPerPage, postsPerPage)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	models.LoadTagsForPosts(h.DB, posts)

	h.Tmpls.Render(w, "public/tag.html", map[string]any{
		"Tenant":      tenant,
		"Tag":         tag,
		"Posts":       posts,
		"CustomFonts": h.customFonts(tenant.ID),
		"BaseURL":     siteBaseURL(r),
		"Page":        page,
		"TotalPages":  totalPages,
		"HasPrev":     page > 1,
		"HasNext":     page < totalPages,
		"PrevPage":    page - 1,
		"NextPage":    page + 1,
	})
}
