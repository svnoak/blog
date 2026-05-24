package models

import (
	"database/sql"
	"strings"
)

type Tag struct {
	ID       int64
	TenantID int64
	Slug     string
	Name     string
}

func tagSlugify(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = nonAlnum.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	return s
}

// SetPostTags replaces all tags for a post. tagsCSV is a comma-separated list of tag names.
func SetPostTags(db *sql.DB, tenantID, postID int64, tagsCSV string) error {
	var tags []Tag
	for _, raw := range strings.Split(tagsCSV, ",") {
		name := strings.TrimSpace(raw)
		if name == "" {
			continue
		}
		slug := tagSlugify(name)
		if slug == "" {
			continue
		}
		tags = append(tags, Tag{Slug: slug, Name: name})
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM post_tags WHERE post_id = ?`, postID); err != nil {
		return err
	}

	for _, t := range tags {
		if _, err := tx.Exec(
			`INSERT INTO tags (tenant_id, slug, name) VALUES (?, ?, ?)
			 ON CONFLICT(tenant_id, slug) DO UPDATE SET name = excluded.name`,
			tenantID, t.Slug, t.Name,
		); err != nil {
			return err
		}
		var tagID int64
		if err := tx.QueryRow(
			`SELECT id FROM tags WHERE tenant_id = ? AND slug = ?`, tenantID, t.Slug,
		).Scan(&tagID); err != nil {
			return err
		}
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)`, postID, tagID,
		); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// LoadTagsForPosts populates Tags on each post in a single query.
func LoadTagsForPosts(db *sql.DB, posts []*Post) error {
	if len(posts) == 0 {
		return nil
	}
	ids := make([]any, len(posts))
	index := make(map[int64]*Post, len(posts))
	for i, p := range posts {
		ids[i] = p.ID
		index[p.ID] = p
	}
	placeholders := strings.Repeat("?,", len(ids))
	placeholders = placeholders[:len(placeholders)-1]
	rows, err := db.Query(
		`SELECT pt.post_id, t.id, t.tenant_id, t.slug, t.name
		 FROM tags t JOIN post_tags pt ON pt.tag_id = t.id
		 WHERE pt.post_id IN (`+placeholders+`)
		 ORDER BY t.name`,
		ids...,
	)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var postID int64
		var t Tag
		if err := rows.Scan(&postID, &t.ID, &t.TenantID, &t.Slug, &t.Name); err != nil {
			return err
		}
		index[postID].Tags = append(index[postID].Tags, t)
	}
	return rows.Err()
}

// TagCount is a tag with its associated published-post count.
type TagCount struct {
	Tag
	Count int
}

// ListTagsWithPublishedCount returns every tag for the tenant alongside the
// number of published posts that use it, ordered by count desc then name.
// Tags with zero published posts are omitted.
func ListTagsWithPublishedCount(db *sql.DB, tenantID int64) ([]TagCount, error) {
	rows, err := db.Query(
		`SELECT t.id, t.tenant_id, t.slug, t.name, COUNT(p.id) AS n
		   FROM tags t
		   JOIN post_tags pt ON pt.tag_id = t.id
		   JOIN posts p      ON p.id     = pt.post_id
		  WHERE t.tenant_id = ? AND p.status = 'published'
		  GROUP BY t.id
		 HAVING n > 0
		  ORDER BY n DESC, t.name ASC`,
		tenantID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TagCount
	for rows.Next() {
		var tc TagCount
		if err := rows.Scan(&tc.ID, &tc.TenantID, &tc.Slug, &tc.Name, &tc.Count); err != nil {
			return nil, err
		}
		out = append(out, tc)
	}
	return out, rows.Err()
}

// GetTagBySlug returns a tag by tenant and slug.
func GetTagBySlug(db *sql.DB, tenantID int64, slug string) (*Tag, error) {
	var t Tag
	err := db.QueryRow(
		`SELECT id, tenant_id, slug, name FROM tags WHERE tenant_id = ? AND slug = ?`,
		tenantID, slug,
	).Scan(&t.ID, &t.TenantID, &t.Slug, &t.Name)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &t, err
}

// CountPublishedPostsByTag counts published posts with a given tag slug.
func CountPublishedPostsByTag(db *sql.DB, tenantID int64, tagSlug string) (int, error) {
	var n int
	err := db.QueryRow(
		`SELECT COUNT(*) FROM posts p
		 JOIN post_tags pt ON pt.post_id = p.id
		 JOIN tags t ON t.id = pt.tag_id
		 WHERE p.tenant_id = ? AND p.status = 'published' AND t.slug = ?`,
		tenantID, tagSlug,
	).Scan(&n)
	return n, err
}

// ListPublishedPostsByTagPaged returns a page of published posts for a tag.
func ListPublishedPostsByTagPaged(db *sql.DB, tenantID int64, tagSlug string, offset, limit int) ([]*Post, error) {
	rows, err := db.Query(
		`SELECT p.id, p.tenant_id, p.author_id, u.display_name, p.title, p.slug, p.content, p.status, p.published_at, p.created_at, p.updated_at
		 FROM posts p
		 JOIN users u ON u.id = p.author_id
		 JOIN post_tags pt ON pt.post_id = p.id
		 JOIN tags t ON t.id = pt.tag_id
		 WHERE p.tenant_id = ? AND p.status = 'published' AND t.slug = ?
		 ORDER BY p.published_at DESC
		 LIMIT ? OFFSET ?`,
		tenantID, tagSlug, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPosts(rows)
}
