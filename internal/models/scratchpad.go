package models

import (
	"database/sql"
)

type ScratchpadNote struct {
	UID      string  `json:"id"`
	Color    string  `json:"color"`
	Tilt     float64 `json:"tilt"`
	Text     string  `json:"text"`
	AnchorID string  `json:"anchorId,omitempty"`
}

func ListScratchpadNotes(db *sql.DB, tenantID, postID, userID int64) ([]ScratchpadNote, error) {
	rows, err := db.Query(
		`SELECT uid, color, tilt, text, COALESCE(anchor_id, '')
		 FROM scratchpad_notes
		 WHERE tenant_id = ? AND post_id = ? AND user_id = ?
		 ORDER BY position ASC, id ASC`,
		tenantID, postID, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	notes := []ScratchpadNote{}
	for rows.Next() {
		var n ScratchpadNote
		if err := rows.Scan(&n.UID, &n.Color, &n.Tilt, &n.Text, &n.AnchorID); err != nil {
			return nil, err
		}
		notes = append(notes, n)
	}
	return notes, rows.Err()
}

func ReplaceScratchpadNotes(db *sql.DB, tenantID, postID, userID int64, notes []ScratchpadNote) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(
		`DELETE FROM scratchpad_notes WHERE tenant_id = ? AND post_id = ? AND user_id = ?`,
		tenantID, postID, userID,
	); err != nil {
		return err
	}

	stmt, err := tx.Prepare(
		`INSERT INTO scratchpad_notes
		 (tenant_id, post_id, user_id, uid, position, color, tilt, text, anchor_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for i, n := range notes {
		var anchor any
		if n.AnchorID != "" {
			anchor = n.AnchorID
		}
		if _, err := stmt.Exec(tenantID, postID, userID, n.UID, i, n.Color, n.Tilt, n.Text, anchor); err != nil {
			return err
		}
	}
	return tx.Commit()
}
