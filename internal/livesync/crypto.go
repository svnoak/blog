// Package livesync reads notes directly out of the CouchDB database used by
// the Obsidian "Self-hosted LiveSync" plugin, decrypts them, and feeds
// publish-flagged notes into bloggy's post model.
//
// crypto.go implements LiveSync's two end-to-end-encryption ciphertext
// formats. Both are AES-256-GCM; they differ only in key derivation:
//
//   - HKDF format ("%="): the modern format. A master key is derived once via
//     PBKDF2-HMAC-SHA256(passphrase, globalSalt, 310_000 iter) — globalSalt
//     comes from the CouchDB database's `_local/obsidian_livesync_sync_parameters`
//     document, not a fixed constant. Every ciphertext then carries its own
//     32-byte HKDF salt, cheaply expanded into a per-payload AES key.
//   - V2 legacy format (bare "%", followed by 32 hex chars): an older format
//     using PBKDF2-HMAC-SHA256(SHA256(passphrase), salt, 100_000 iter) with a
//     16-byte salt and 16-byte IV embedded directly in the payload.
//
// Ciphertext not starting with "%" at all is passed through unchanged — that
// is LiveSync's own fallback for notes written before E2EE was enabled.
package livesync

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"regexp"
	"sync"

	"golang.org/x/crypto/hkdf"
	"golang.org/x/crypto/pbkdf2"
)

const (
	hkdfPrefix         = "%="
	inlinePrefix       = "%"
	pbkdf2Iterations   = 310_000
	v2LegacyIterations = 100_000
)

var hexRunRe = regexp.MustCompile(`^[0-9a-fA-F]{32}$`)

// Decryptor holds a LiveSync passphrase and the (expensive to derive) HKDF
// master key for a single vault/database. It is safe for concurrent use.
type Decryptor struct {
	passphrase string

	mu        sync.Mutex
	masterKey []byte // set by SetGlobalSalt
}

func NewDecryptor(passphrase string) *Decryptor {
	return &Decryptor{passphrase: passphrase}
}

// SetGlobalSalt derives and caches the HKDF master key from the database's
// global PBKDF2 salt. Must be called once before DecryptChunk is used on any
// "%="-format payload. Safe to call more than once (e.g. on reconnect); the
// (expensive) derivation only re-runs if the salt actually changed.
func (d *Decryptor) SetGlobalSalt(salt []byte) {
	// Unlike the V2 legacy path, HKDF-format key derivation uses the raw
	// passphrase bytes as PBKDF2's key material, not a pre-hash of it.
	key := pbkdf2.Key([]byte(d.passphrase), salt, pbkdf2Iterations, 32, sha256.New)
	d.mu.Lock()
	d.masterKey = key
	d.mu.Unlock()
}

func (d *Decryptor) masterKeyBytes() ([]byte, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.masterKey == nil {
		return nil, fmt.Errorf("livesync: HKDF master key not initialized — call SetGlobalSalt first")
	}
	return d.masterKey, nil
}

// IsEncrypted reports whether data is in one of LiveSync's encrypted
// formats, as opposed to a pre-E2EE plaintext document.
func IsEncrypted(data string) bool {
	return len(data) > 0 && data[0] == '%'
}

// DecryptChunk decrypts a single chunk/inline-data payload as stored in
// CouchDB. Plaintext (pre-E2EE) input is returned unchanged.
func (d *Decryptor) DecryptChunk(data string) (string, error) {
	if !IsEncrypted(data) {
		return data, nil
	}
	if len(data) >= 2 && data[:2] == hkdfPrefix {
		return d.decryptHKDF(data)
	}
	// Bare "%": disambiguate V2-legacy (32 hex chars follow) from an HKDF
	// payload that just happens not to have picked up the second '='.
	rest := data[len(inlinePrefix):]
	if len(rest) >= 32 && hexRunRe.MatchString(rest[:32]) {
		return d.decryptV2Legacy(data)
	}
	return d.decryptHKDF(hkdfPrefix + rest)
}

func (d *Decryptor) decryptHKDF(data string) (string, error) {
	masterKey, err := d.masterKeyBytes()
	if err != nil {
		return "", err
	}

	b64Part := trimTrailingEquals(data[len(hkdfPrefix):])
	raw, err := base64.RawStdEncoding.DecodeString(b64Part)
	if err != nil {
		return "", fmt.Errorf("livesync: decode HKDF payload: %w", err)
	}
	// iv(12) + hkdfSalt(32) + ciphertext+tag(>=16)
	if len(raw) < 12+32+16 {
		return "", fmt.Errorf("livesync: HKDF payload too short (%d bytes)", len(raw))
	}
	iv := raw[:12]
	salt := raw[12:44]
	ciphertext := raw[44:]

	kdf := hkdf.New(sha256.New, masterKey, salt, nil)
	key := make([]byte, 32)
	if _, err := io.ReadFull(kdf, key); err != nil {
		return "", fmt.Errorf("livesync: HKDF expand: %w", err)
	}

	plain, err := aesGCMOpen(key, iv, ciphertext)
	if err != nil {
		return "", fmt.Errorf("livesync: HKDF decrypt: %w", err)
	}
	return string(plain), nil
}

func (d *Decryptor) decryptV2Legacy(data string) (string, error) {
	rest := data[len(inlinePrefix):]
	if len(rest) < 64 {
		return "", fmt.Errorf("livesync: V2 legacy payload too short")
	}
	ivHex, saltHex, b64Ciphertext := rest[:32], rest[32:64], rest[64:]

	iv, err := hex.DecodeString(ivHex)
	if err != nil {
		return "", fmt.Errorf("livesync: decode V2 iv: %w", err)
	}
	salt, err := hex.DecodeString(saltHex)
	if err != nil {
		return "", fmt.Errorf("livesync: decode V2 salt: %w", err)
	}
	ciphertext, err := decodeBase64Loose(b64Ciphertext)
	if err != nil {
		return "", fmt.Errorf("livesync: decode V2 ciphertext: %w", err)
	}

	passphraseHash := sha256.Sum256([]byte(d.passphrase))
	key := pbkdf2.Key(passphraseHash[:], salt, v2LegacyIterations, 32, sha256.New)

	plain, err := aesGCMOpenWithNonceSize(key, iv, ciphertext, len(iv))
	if err != nil {
		return "", fmt.Errorf("livesync: V2 legacy decrypt: %w", err)
	}
	return string(plain), nil
}

func aesGCMOpen(key, nonce, ciphertext []byte) ([]byte, error) {
	return aesGCMOpenWithNonceSize(key, nonce, ciphertext, 12)
}

func aesGCMOpenWithNonceSize(key, nonce, ciphertext []byte, nonceSize int) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, nonceSize)
	if err != nil {
		return nil, err
	}
	return gcm.Open(nil, nonce, ciphertext, nil)
}

func trimTrailingEquals(s string) string {
	for len(s) > 0 && s[len(s)-1] == '=' {
		s = s[:len(s)-1]
	}
	return s
}

// decodeBase64Loose accepts both padded and unpadded standard base64, since
// the legacy format's on-the-wire padding isn't guaranteed.
func decodeBase64Loose(s string) ([]byte, error) {
	if b, err := base64.StdEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	return base64.RawStdEncoding.DecodeString(trimTrailingEquals(s))
}
