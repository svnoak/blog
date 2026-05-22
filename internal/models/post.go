package models

import (
	"database/sql"
	"fmt"
	"regexp"
	"strings"
	"time"
)

type Post struct {
	ID          int64
	TenantID    int64
	AuthorID    int64
	AuthorName  string
	Title       string
	Slug        string
	Content     string
	Status      string
	PublishedAt *time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (p *Post) IsPublished() bool { return p.Status == "published" }

var nonAlnum = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(title string) string {
	s := strings.ToLower(title)
	s = nonAlnum.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = "untitled"
	}
	return s
}

func uniqueSlug(db *sql.DB, tenantID int64, base string, excludeID int64) (string, error) {
	slug := base
	for i := 2; ; i++ {
		var exists int
		err := db.QueryRow(
			`SELECT COUNT(*) FROM posts WHERE tenant_id = ? AND slug = ? AND id != ?`,
			tenantID, slug, excludeID,
		).Scan(&exists)
		if err != nil {
			return "", err
		}
		if exists == 0 {
			return slug, nil
		}
		slug = fmt.Sprintf("%s-%d", base, i)
	}
}

func CreatePost(db *sql.DB, tenantID, authorID int64, title, content string) (*Post, error) {
	base := slugify(title)
	slug, err := uniqueSlug(db, tenantID, base, 0)
	if err != nil {
		return nil, err
	}
	res, err := db.Exec(
		`INSERT INTO posts (tenant_id, author_id, title, slug, content) VALUES (?, ?, ?, ?, ?)`,
		tenantID, authorID, title, slug, content,
	)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return GetPostByID(db, tenantID, id)
}

func UpdatePost(db *sql.DB, tenantID, postID int64, title, content string) error {
	base := slugify(title)
	slug, err := uniqueSlug(db, tenantID, base, postID)
	if err != nil {
		return err
	}
	_, err = db.Exec(
		`UPDATE posts SET title = ?, slug = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
		title, slug, content, postID, tenantID,
	)
	return err
}

func PublishPost(db *sql.DB, tenantID, postID int64) error {
	_, err := db.Exec(
		`UPDATE posts SET status = 'published', published_at = CASE WHEN published_at IS NULL THEN CURRENT_TIMESTAMP ELSE published_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
		postID, tenantID,
	)
	return err
}

func UnpublishPost(db *sql.DB, tenantID, postID int64) error {
	_, err := db.Exec(
		`UPDATE posts SET status = 'draft', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
		postID, tenantID,
	)
	return err
}

func DeletePost(db *sql.DB, tenantID, postID int64) error {
	_, err := db.Exec(`DELETE FROM posts WHERE id = ? AND tenant_id = ?`, postID, tenantID)
	return err
}

func GetPostByID(db *sql.DB, tenantID, postID int64) (*Post, error) {
	return scanPost(db.QueryRow(
		`SELECT p.id, p.tenant_id, p.author_id, u.display_name, p.title, p.slug, p.content, p.status, p.published_at, p.created_at, p.updated_at
		 FROM posts p JOIN users u ON u.id = p.author_id
		 WHERE p.id = ? AND p.tenant_id = ?`,
		postID, tenantID,
	))
}

func GetPostBySlug(db *sql.DB, tenantID int64, slug string) (*Post, error) {
	return scanPost(db.QueryRow(
		`SELECT p.id, p.tenant_id, p.author_id, u.display_name, p.title, p.slug, p.content, p.status, p.published_at, p.created_at, p.updated_at
		 FROM posts p JOIN users u ON u.id = p.author_id
		 WHERE p.slug = ? AND p.tenant_id = ? AND p.status = 'published'`,
		slug, tenantID,
	))
}

func ListPostsForAdmin(db *sql.DB, tenantID int64) ([]*Post, error) {
	rows, err := db.Query(
		`SELECT p.id, p.tenant_id, p.author_id, u.display_name, p.title, p.slug, p.content, p.status, p.published_at, p.created_at, p.updated_at
		 FROM posts p JOIN users u ON u.id = p.author_id
		 WHERE p.tenant_id = ?
		 ORDER BY p.updated_at DESC`,
		tenantID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPosts(rows)
}

func ListPublishedPosts(db *sql.DB, tenantID int64) ([]*Post, error) {
	rows, err := db.Query(
		`SELECT p.id, p.tenant_id, p.author_id, u.display_name, p.title, p.slug, p.content, p.status, p.published_at, p.created_at, p.updated_at
		 FROM posts p JOIN users u ON u.id = p.author_id
		 WHERE p.tenant_id = ? AND p.status = 'published'
		 ORDER BY p.published_at DESC`,
		tenantID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPosts(rows)
}

func CountPublishedPosts(db *sql.DB, tenantID int64) (int, error) {
	var n int
	err := db.QueryRow(
		`SELECT COUNT(*) FROM posts WHERE tenant_id = ? AND status = 'published'`,
		tenantID,
	).Scan(&n)
	return n, err
}

func ListPublishedPostsPaged(db *sql.DB, tenantID int64, offset, limit int) ([]*Post, error) {
	rows, err := db.Query(
		`SELECT p.id, p.tenant_id, p.author_id, u.display_name, p.title, p.slug, p.content, p.status, p.published_at, p.created_at, p.updated_at
		 FROM posts p JOIN users u ON u.id = p.author_id
		 WHERE p.tenant_id = ? AND p.status = 'published'
		 ORDER BY p.published_at DESC
		 LIMIT ? OFFSET ?`,
		tenantID, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPosts(rows)
}

func ListPublishedPostsN(db *sql.DB, tenantID int64, n int) ([]*Post, error) {
	rows, err := db.Query(
		`SELECT p.id, p.tenant_id, p.author_id, u.display_name, p.title, p.slug, p.content, p.status, p.published_at, p.created_at, p.updated_at
		 FROM posts p JOIN users u ON u.id = p.author_id
		 WHERE p.tenant_id = ? AND p.status = 'published'
		 ORDER BY p.published_at DESC
		 LIMIT ?`,
		tenantID, n,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPosts(rows)
}

func scanPost(row *sql.Row) (*Post, error) {
	var p Post
	var publishedAt sql.NullTime
	err := row.Scan(&p.ID, &p.TenantID, &p.AuthorID, &p.AuthorName, &p.Title, &p.Slug,
		&p.Content, &p.Status, &publishedAt, &p.CreatedAt, &p.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if publishedAt.Valid {
		p.PublishedAt = &publishedAt.Time
	}
	return &p, nil
}

func scanPosts(rows *sql.Rows) ([]*Post, error) {
	var posts []*Post
	for rows.Next() {
		var p Post
		var publishedAt sql.NullTime
		if err := rows.Scan(&p.ID, &p.TenantID, &p.AuthorID, &p.AuthorName, &p.Title, &p.Slug,
			&p.Content, &p.Status, &publishedAt, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		if publishedAt.Valid {
			p.PublishedAt = &publishedAt.Time
		}
		posts = append(posts, &p)
	}
	return posts, rows.Err()
}
