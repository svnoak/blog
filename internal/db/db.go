package db

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

func Open(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1) // SQLite is single-writer
	if err := migrate(db); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return db, nil
}

func addColumnIfMissing(db *sql.DB, table, column, definition string) {
	db.Exec(fmt.Sprintf(`ALTER TABLE %s ADD COLUMN %s %s`, table, column, definition))
}

func migrate(db *sql.DB) error {
	_, err := db.Exec(`
		PRAGMA journal_mode=WAL;
		PRAGMA foreign_keys=ON;

		CREATE TABLE IF NOT EXISTS tenants (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			name       TEXT NOT NULL,
			domain     TEXT UNIQUE NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS users (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			tenant_id     INTEGER NOT NULL REFERENCES tenants(id),
			email         TEXT NOT NULL,
			display_name  TEXT NOT NULL,
			password_hash TEXT NOT NULL,
			created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(tenant_id, email)
		);

		CREATE TABLE IF NOT EXISTS posts (
			id           INTEGER PRIMARY KEY AUTOINCREMENT,
			tenant_id    INTEGER NOT NULL REFERENCES tenants(id),
			author_id    INTEGER NOT NULL REFERENCES users(id),
			title        TEXT NOT NULL DEFAULT '',
			slug         TEXT NOT NULL DEFAULT '',
			content      TEXT NOT NULL DEFAULT '',
			status       TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
			published_at DATETIME,
			created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(tenant_id, slug)
		);
	`)
	if err != nil {
		return err
	}
	addColumnIfMissing(db, "tenants", "theme", `TEXT NOT NULL DEFAULT 'paper'`)
	addColumnIfMissing(db, "tenants", "pub_font", `TEXT NOT NULL DEFAULT 'literary'`)
	addColumnIfMissing(db, "tenants", "admin_font", `TEXT NOT NULL DEFAULT 'literary'`)
	addColumnIfMissing(db, "tenants", "light_theme", `TEXT NOT NULL DEFAULT 'paper'`)
	addColumnIfMissing(db, "tenants", "dark_theme", `TEXT NOT NULL DEFAULT 'ember'`)

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS custom_fonts (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			tenant_id  INTEGER NOT NULL REFERENCES tenants(id),
			name       TEXT NOT NULL,
			filename   TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(tenant_id, name)
		);

		CREATE TABLE IF NOT EXISTS tags (
			id        INTEGER PRIMARY KEY AUTOINCREMENT,
			tenant_id INTEGER NOT NULL REFERENCES tenants(id),
			slug      TEXT NOT NULL,
			name      TEXT NOT NULL,
			UNIQUE(tenant_id, slug)
		);

		CREATE TABLE IF NOT EXISTS post_tags (
			post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
			tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
			PRIMARY KEY (post_id, tag_id)
		);
	`)
	return err
}
