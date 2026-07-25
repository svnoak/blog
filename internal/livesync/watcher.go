package livesync

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	mw "bloggy/internal/middleware"
	"bloggy/internal/models"
)

const maxBackoff = 5 * time.Minute

// Watcher follows a LiveSync CouchDB database's _changes feed and turns
// publish-flagged notes into bloggy posts.
type Watcher struct {
	Client    *Client
	Decryptor *Decryptor
	DB        *sql.DB
	// AuthorByTenant maps tenant ID to the system user (see
	// models.EnsureSystemUser) that synced posts are attributed to.
	AuthorByTenant map[int64]int64
}

func NewWatcher(client *Client, dec *Decryptor, db *sql.DB, authorByTenant map[int64]int64) *Watcher {
	return &Watcher{Client: client, Decryptor: dec, DB: db, AuthorByTenant: authorByTenant}
}

// Run blocks until ctx is canceled, reconnecting the changes feed with
// exponential backoff whenever it drops.
func (w *Watcher) Run(ctx context.Context) {
	backoff := time.Second
	for ctx.Err() == nil {
		if err := w.ensureGlobalSalt(ctx); err == nil {
			break
		} else {
			log.Printf("livesync: fetching global salt: %v — retrying in %s", err, backoff)
			if !sleepOrDone(ctx, backoff) {
				return
			}
			backoff = nextBackoff(backoff)
		}
	}
	if ctx.Err() != nil {
		return
	}
	backoff = time.Second

	since, err := loadLastSeq(w.DB)
	if err != nil {
		log.Printf("livesync: loading sync checkpoint: %v — starting from the beginning", err)
		since = ""
	}

	for ctx.Err() == nil {
		streamErr := w.Client.Changes(ctx, since, func(ev ChangeEvent) error {
			if err := w.handleEvent(ctx, ev); err != nil {
				return err
			}
			since = ev.SeqString()
			if err := saveLastSeq(w.DB, since); err != nil {
				log.Printf("livesync: saving sync checkpoint: %v", err)
			}
			backoff = time.Second
			return nil
		})
		if ctx.Err() != nil {
			return
		}
		log.Printf("livesync: changes feed disconnected, reconnecting in %s: %v", backoff, streamErr)
		if !sleepOrDone(ctx, backoff) {
			return
		}
		backoff = nextBackoff(backoff)
	}
}

// handleEvent processes one _changes entry. Errors it returns end the feed
// connection and trigger a reconnect+backoff (reserved for things worth
// retrying, like a transient DB error); a single note that fails to
// decrypt or parse is logged and skipped instead, since retrying it won't
// help.
func (w *Watcher) handleEvent(ctx context.Context, ev ChangeEvent) error {
	if IsChunkOrDesignDoc(ev.ID) {
		return nil
	}
	if ev.Deleted {
		return models.UnpublishBySourceKey(w.DB, ev.ID, 0)
	}
	if len(ev.Doc) == 0 {
		return nil
	}

	var doc FileEntry
	if err := json.Unmarshal(ev.Doc, &doc); err != nil {
		log.Printf("livesync: skipping %s: decode file doc: %v", ev.ID, err)
		return nil
	}
	if doc.Deleted {
		return models.UnpublishBySourceKey(w.DB, ev.ID, 0)
	}
	if len(doc.Children) == 0 && doc.Data == "" {
		return nil // not reassemblable content (e.g. an empty stub doc)
	}

	content, err := ReassembleFile(ctx, w.Client, w.Decryptor, &doc)
	if err != nil {
		log.Printf("livesync: skipping %s: %v", ev.ID, err)
		return nil
	}

	fm, body := ParseFrontmatter(content)
	if fm.Publish == "" {
		return models.UnpublishBySourceKey(w.DB, ev.ID, 0)
	}

	tenant, err := mw.GetTenantByKey(w.DB, fm.Publish)
	if err != nil {
		return fmt.Errorf("look up tenant for key %q: %w", fm.Publish, err)
	}
	if tenant == nil {
		log.Printf("livesync: %s has publish: %q but no tenant has that key — skipping", ev.ID, fm.Publish)
		return nil
	}
	if err := models.UnpublishBySourceKey(w.DB, ev.ID, tenant.ID); err != nil {
		return fmt.Errorf("unpublish %s from other tenants: %w", ev.ID, err)
	}

	authorID, ok := w.AuthorByTenant[tenant.ID]
	if !ok {
		return fmt.Errorf("no system user configured for tenant %d (%s)", tenant.ID, tenant.Domain)
	}

	title := fm.Title
	if title == "" {
		title = firstHeadingOrFallback(body, ev.ID)
	}
	if _, err := models.UpsertPostFromSource(w.DB, tenant.ID, authorID, ev.ID, title, body, fm.Tags); err != nil {
		return fmt.Errorf("upsert post for %s: %w", ev.ID, err)
	}
	return nil
}

func firstHeadingOrFallback(body, fallback string) string {
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "# ") {
			if title := strings.TrimSpace(line[2:]); title != "" {
				return title
			}
		}
	}
	return fallback
}

type syncParameters struct {
	PBKDF2Salt string `json:"pbkdf2salt"`
}

func (w *Watcher) ensureGlobalSalt(ctx context.Context) error {
	raw, err := w.Client.GetLocal(ctx, "obsidian_livesync_sync_parameters")
	if err != nil {
		return err
	}
	if raw == nil {
		return fmt.Errorf("_local/obsidian_livesync_sync_parameters not found — has LiveSync synced at least once?")
	}
	var params syncParameters
	if err := json.Unmarshal(raw, &params); err != nil {
		return fmt.Errorf("decode sync parameters: %w", err)
	}
	if params.PBKDF2Salt == "" {
		return fmt.Errorf("sync parameters have no pbkdf2salt — is E2EE enabled on this database?")
	}
	salt, err := base64.StdEncoding.DecodeString(params.PBKDF2Salt)
	if err != nil {
		return fmt.Errorf("decode pbkdf2salt: %w", err)
	}
	w.Decryptor.SetGlobalSalt(salt)
	return nil
}

func loadLastSeq(db *sql.DB) (string, error) {
	var seq string
	err := db.QueryRow(`SELECT last_seq FROM sync_state WHERE id = 1`).Scan(&seq)
	if err == sql.ErrNoRows {
		_, err := db.Exec(`INSERT INTO sync_state (id, last_seq) VALUES (1, '')`)
		return "", err
	}
	return seq, err
}

func saveLastSeq(db *sql.DB, seq string) error {
	_, err := db.Exec(
		`INSERT INTO sync_state (id, last_seq) VALUES (1, ?)
		 ON CONFLICT(id) DO UPDATE SET last_seq = excluded.last_seq`,
		seq,
	)
	return err
}

func sleepOrDone(ctx context.Context, d time.Duration) bool {
	select {
	case <-time.After(d):
		return true
	case <-ctx.Done():
		return false
	}
}

func nextBackoff(cur time.Duration) time.Duration {
	next := cur * 2
	if next > maxBackoff {
		return maxBackoff
	}
	return next
}
