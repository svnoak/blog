package models

import (
	"database/sql"
	"testing"

	"bloggy/internal/db"
)

func setupTestDB(t *testing.T) (*sql.DB, int64, int64) {
	t.Helper()
	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	res, err := database.Exec(`INSERT INTO tenants (name, domain) VALUES ('Test Blog', 'test.example')`)
	if err != nil {
		t.Fatalf("insert tenant: %v", err)
	}
	tenantID, _ := res.LastInsertId()

	if err := CreateUser(database, tenantID, "author@example.com", "Author", "password123"); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	user, err := AuthenticateUser(database, tenantID, "author@example.com", "password123")
	if err != nil || user == nil {
		t.Fatalf("AuthenticateUser: %v", err)
	}
	return database, tenantID, user.ID
}

func TestUpsertPostFromSource_CreatesThenUpdates(t *testing.T) {
	database, tenantID, authorID := setupTestDB(t)

	post, err := UpsertPostFromSource(database, tenantID, authorID, "vault-doc-1", "First Title", "first body", []string{"fiction", "short"})
	if err != nil {
		t.Fatalf("UpsertPostFromSource (create): %v", err)
	}
	if post.Title != "First Title" || post.Content != "first body" {
		t.Errorf("unexpected post after create: %+v", post)
	}
	if !post.IsPublished() {
		t.Error("expected post to be published after UpsertPostFromSource")
	}
	if len(post.Tags) != 2 {
		t.Errorf("expected 2 tags, got %d (%+v)", len(post.Tags), post.Tags)
	}

	updated, err := UpsertPostFromSource(database, tenantID, authorID, "vault-doc-1", "Updated Title", "updated body", []string{"fiction"})
	if err != nil {
		t.Fatalf("UpsertPostFromSource (update): %v", err)
	}
	if updated.ID != post.ID {
		t.Errorf("expected same post ID on update (idempotent upsert), got %d want %d", updated.ID, post.ID)
	}
	if updated.Title != "Updated Title" || updated.Content != "updated body" {
		t.Errorf("unexpected post after update: %+v", updated)
	}
	if len(updated.Tags) != 1 || updated.Tags[0].Name != "fiction" {
		t.Errorf("expected tags replaced to just [fiction], got %+v", updated.Tags)
	}

	count, err := CountPublishedPosts(database, tenantID)
	if err != nil {
		t.Fatalf("CountPublishedPosts: %v", err)
	}
	if count != 1 {
		t.Errorf("expected exactly 1 published post (no duplicate row), got %d", count)
	}
}

func TestUpsertPostFromSource_DifferentSourceKeysAreDistinctPosts(t *testing.T) {
	database, tenantID, authorID := setupTestDB(t)

	if _, err := UpsertPostFromSource(database, tenantID, authorID, "vault-doc-a", "A", "body a", nil); err != nil {
		t.Fatalf("create a: %v", err)
	}
	if _, err := UpsertPostFromSource(database, tenantID, authorID, "vault-doc-b", "B", "body b", nil); err != nil {
		t.Fatalf("create b: %v", err)
	}

	count, err := CountPublishedPosts(database, tenantID)
	if err != nil {
		t.Fatalf("CountPublishedPosts: %v", err)
	}
	if count != 2 {
		t.Errorf("expected 2 distinct published posts, got %d", count)
	}
}

func TestGetPostIDBySourceKey_NotFound(t *testing.T) {
	database, tenantID, _ := setupTestDB(t)
	_, ok, err := GetPostIDBySourceKey(database, tenantID, "does-not-exist")
	if err != nil {
		t.Fatalf("GetPostIDBySourceKey: %v", err)
	}
	if ok {
		t.Error("expected ok=false for a source key that was never synced")
	}
}

func TestEnsureSystemUser_IdempotentAndCannotAuthenticate(t *testing.T) {
	database, tenantID, _ := setupTestDB(t)

	u1, err := EnsureSystemUser(database, tenantID, "LiveSync Sync")
	if err != nil {
		t.Fatalf("EnsureSystemUser (first): %v", err)
	}
	u2, err := EnsureSystemUser(database, tenantID, "LiveSync Sync")
	if err != nil {
		t.Fatalf("EnsureSystemUser (second): %v", err)
	}
	if u1.ID != u2.ID {
		t.Errorf("expected EnsureSystemUser to be idempotent, got different IDs %d and %d", u1.ID, u2.ID)
	}

	// A system user must never be able to authenticate with a guessable password.
	if authed, err := AuthenticateUser(database, tenantID, u1.Email, ""); err != nil || authed != nil {
		t.Errorf("expected system user to never authenticate, got user=%v err=%v", authed, err)
	}
}
