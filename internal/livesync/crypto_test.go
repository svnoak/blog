package livesync

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"io"
	"testing"

	"golang.org/x/crypto/hkdf"
	"golang.org/x/crypto/pbkdf2"
)

// encryptHKDFForTest builds a "%="-format payload the same way the plugin
// does, so the round trip through DecryptChunk exercises the real parsing
// and key-derivation path, not just a mirror of it.
func encryptHKDFForTest(t *testing.T, masterKey []byte, plaintext string) string {
	t.Helper()
	salt := randomBytes(t, 32)
	iv := randomBytes(t, 12)

	kdf := hkdf.New(sha256.New, masterKey, salt, nil)
	key := make([]byte, 32)
	if _, err := io.ReadFull(kdf, key); err != nil {
		t.Fatalf("hkdf expand: %v", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatalf("aes.NewCipher: %v", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatalf("cipher.NewGCM: %v", err)
	}
	ciphertext := gcm.Seal(nil, iv, []byte(plaintext), nil)

	payload := append(append(append([]byte{}, iv...), salt...), ciphertext...)
	return hkdfPrefix + base64.RawStdEncoding.EncodeToString(payload)
}

func encryptV2LegacyForTest(t *testing.T, passphrase, plaintext string) string {
	t.Helper()
	salt := randomBytes(t, 16)
	iv := randomBytes(t, 16)

	passphraseHash := sha256.Sum256([]byte(passphrase))
	key := pbkdf2.Key(passphraseHash[:], salt, v2LegacyIterations, 32, sha256.New)

	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatalf("aes.NewCipher: %v", err)
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, 16)
	if err != nil {
		t.Fatalf("cipher.NewGCMWithNonceSize: %v", err)
	}
	ciphertext := gcm.Seal(nil, iv, []byte(plaintext), nil)

	return inlinePrefix + hex.EncodeToString(iv) + hex.EncodeToString(salt) + base64.StdEncoding.EncodeToString(ciphertext)
}

func randomBytes(t *testing.T, n int) []byte {
	t.Helper()
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		t.Fatalf("rand.Read: %v", err)
	}
	return b
}

func TestDecryptChunk_PlaintextPassthrough(t *testing.T) {
	d := NewDecryptor("correct horse battery staple")
	got, err := d.DecryptChunk("# just a heading\n\nno encryption here")
	if err != nil {
		t.Fatalf("DecryptChunk: %v", err)
	}
	if got != "# just a heading\n\nno encryption here" {
		t.Errorf("got %q", got)
	}
}

func TestDecryptChunk_HKDFRoundTrip(t *testing.T) {
	d := NewDecryptor("correct horse battery staple")
	globalSalt := randomBytes(t, 32)
	d.SetGlobalSalt(globalSalt)

	masterKey := pbkdf2.Key([]byte(d.passphrase), globalSalt, pbkdf2Iterations, 32, sha256.New)
	want := "---\npublish: stories\n---\n\nOnce upon a time, a blog engine learned to read CouchDB."
	payload := encryptHKDFForTest(t, masterKey, want)

	got, err := d.DecryptChunk(payload)
	if err != nil {
		t.Fatalf("DecryptChunk: %v", err)
	}
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestDecryptChunk_HKDFWrongPassphraseFails(t *testing.T) {
	d := NewDecryptor("correct horse battery staple")
	globalSalt := randomBytes(t, 32)
	d.SetGlobalSalt(globalSalt)
	masterKey := pbkdf2.Key([]byte(d.passphrase), globalSalt, pbkdf2Iterations, 32, sha256.New)
	payload := encryptHKDFForTest(t, masterKey, "secret content")

	wrong := NewDecryptor("wrong passphrase entirely")
	wrong.SetGlobalSalt(globalSalt)
	if _, err := wrong.DecryptChunk(payload); err == nil {
		t.Error("expected decryption to fail with wrong passphrase, got nil error")
	}
}

func TestDecryptChunk_V2LegacyRoundTrip(t *testing.T) {
	d := NewDecryptor("correct horse battery staple")
	want := "an older note, from before E2EE was HKDF-based"
	payload := encryptV2LegacyForTest(t, d.passphrase, want)

	got, err := d.DecryptChunk(payload)
	if err != nil {
		t.Fatalf("DecryptChunk: %v", err)
	}
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestIsEncrypted(t *testing.T) {
	cases := map[string]bool{
		"":                    false,
		"plain markdown body": false,
		"%=abcdef":            true,
		"%0011deadbeef":       true,
	}
	for input, want := range cases {
		if got := IsEncrypted(input); got != want {
			t.Errorf("IsEncrypted(%q) = %v, want %v", input, got, want)
		}
	}
}
