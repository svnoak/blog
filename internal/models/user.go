package models

import (
	"database/sql"
	"fmt"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID          int64
	TenantID    int64
	Email       string
	DisplayName string
	CreatedAt   time.Time
}

func CreateUser(db *sql.DB, tenantID int64, email, displayName, password string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	_, err = db.Exec(
		`INSERT INTO users (tenant_id, email, display_name, password_hash) VALUES (?, ?, ?, ?)`,
		tenantID, email, displayName, string(hash),
	)
	return err
}

func AuthenticateUser(db *sql.DB, tenantID int64, email, password string) (*User, error) {
	var u User
	var hash string
	err := db.QueryRow(
		`SELECT id, tenant_id, email, display_name, password_hash, created_at FROM users WHERE tenant_id = ? AND email = ?`,
		tenantID, email,
	).Scan(&u.ID, &u.TenantID, &u.Email, &u.DisplayName, &hash, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return nil, nil
	}
	return &u, nil
}

func GetUserByID(db *sql.DB, id int64) (*User, error) {
	var u User
	err := db.QueryRow(
		`SELECT id, tenant_id, email, display_name, created_at FROM users WHERE id = ?`, id,
	).Scan(&u.ID, &u.TenantID, &u.Email, &u.DisplayName, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &u, err
}

func CountUsers(db *sql.DB, tenantID int64) (int, error) {
	var n int
	err := db.QueryRow(`SELECT COUNT(*) FROM users WHERE tenant_id = ?`, tenantID).Scan(&n)
	return n, err
}

func ListUsers(db *sql.DB, tenantID int64) ([]*User, error) {
	rows, err := db.Query(
		`SELECT id, tenant_id, email, display_name, created_at FROM users WHERE tenant_id = ? ORDER BY created_at ASC`,
		tenantID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []*User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.TenantID, &u.Email, &u.DisplayName, &u.CreatedAt); err != nil {
			return nil, err
		}
		users = append(users, &u)
	}
	return users, rows.Err()
}

func DeleteUser(db *sql.DB, tenantID, userID int64) error {
	_, err := db.Exec(`DELETE FROM users WHERE id = ? AND tenant_id = ?`, userID, tenantID)
	return err
}
