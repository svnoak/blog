package middleware

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"time"
)

type Tenant struct {
	ID        int64
	Name      string
	Domain    string
	Theme     string
	PubFont   string
	AdminFont string
	CreatedAt time.Time
}

type CustomFont struct {
	ID       int64
	Name     string
	Filename string
}

type contextKey int

const (
	tenantKey contextKey = iota
	userIDKey
)

func UpsertTenant(db *sql.DB, name, domain string) (*Tenant, error) {
	_, err := db.Exec(
		`INSERT INTO tenants (name, domain) VALUES (?, ?)
		 ON CONFLICT(domain) DO UPDATE SET name = excluded.name`,
		name, domain,
	)
	if err != nil {
		return nil, err
	}
	return getTenantByDomain(db, domain)
}

func getTenantByDomain(db *sql.DB, domain string) (*Tenant, error) {
	var t Tenant
	err := db.QueryRow(
		`SELECT id, name, domain, theme, pub_font, admin_font, created_at FROM tenants WHERE domain = ?`, domain,
	).Scan(&t.ID, &t.Name, &t.Domain, &t.Theme, &t.PubFont, &t.AdminFont, &t.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &t, err
}

func UpdateTenantName(db *sql.DB, tenantID int64, name string) error {
	if name == "" {
		return nil
	}
	_, err := db.Exec(`UPDATE tenants SET name = ? WHERE id = ?`, name, tenantID)
	return err
}

func UpdateTenantFonts(db *sql.DB, tenantID int64, pubFont, adminFont string) error {
	if pubFont == "" {
		pubFont = "literary"
	}
	if adminFont == "" {
		adminFont = "literary"
	}
	_, err := db.Exec(`UPDATE tenants SET pub_font = ?, admin_font = ? WHERE id = ?`, pubFont, adminFont, tenantID)
	return err
}

func ListCustomFonts(db *sql.DB, tenantID int64) ([]CustomFont, error) {
	rows, err := db.Query(`SELECT id, name, filename FROM custom_fonts WHERE tenant_id = ? ORDER BY name`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var fonts []CustomFont
	for rows.Next() {
		var f CustomFont
		if err := rows.Scan(&f.ID, &f.Name, &f.Filename); err != nil {
			return nil, err
		}
		fonts = append(fonts, f)
	}
	return fonts, rows.Err()
}

func AddCustomFont(db *sql.DB, tenantID int64, name, filename string) error {
	_, err := db.Exec(`INSERT INTO custom_fonts (tenant_id, name, filename) VALUES (?, ?, ?)`, tenantID, name, filename)
	return err
}

func DeleteCustomFont(db *sql.DB, tenantID, fontID int64) (string, error) {
	var filename string
	err := db.QueryRow(`SELECT filename FROM custom_fonts WHERE id = ? AND tenant_id = ?`, fontID, tenantID).Scan(&filename)
	if err != nil {
		return "", err
	}
	_, err = db.Exec(`DELETE FROM custom_fonts WHERE id = ? AND tenant_id = ?`, fontID, tenantID)
	return filename, err
}

func UpdateTenantTheme(db *sql.DB, tenantID int64, theme string) error {
	valid := map[string]bool{"paper": true, "sepia": true, "mist": true, "midnight": true}
	if !valid[theme] {
		theme = "paper"
	}
	_, err := db.Exec(`UPDATE tenants SET theme = ? WHERE id = ?`, theme, tenantID)
	return err
}

func TenantMiddleware(db *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			host := r.Host
			// strip port if present
			if idx := strings.LastIndex(host, ":"); idx != -1 {
				host = host[:idx]
			}
			tenant, err := getTenantByDomain(db, host)
			if err != nil || tenant == nil {
				http.Error(w, "unknown domain", http.StatusNotFound)
				return
			}
			ctx := context.WithValue(r.Context(), tenantKey, tenant)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func TenantFromCtx(ctx context.Context) *Tenant {
	t, _ := ctx.Value(tenantKey).(*Tenant)
	return t
}

func SetUserID(ctx context.Context, userID int64) context.Context {
	return context.WithValue(ctx, userIDKey, userID)
}

func UserIDFromCtx(ctx context.Context) (int64, bool) {
	id, ok := ctx.Value(userIDKey).(int64)
	return id, ok
}
