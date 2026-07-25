package livesync

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// FileEntry is a LiveSync "file" document — one per vault file, keyed by
// CouchDB _id. When Path Obfuscation is enabled, ID/Path are opaque, but
// still a stable per-file identifier; nothing here depends on them being
// human-readable.
type FileEntry struct {
	ID       string               `json:"_id"`
	Path     string               `json:"path"`
	Children []string             `json:"children"`
	Eden     map[string]edenEntry `json:"eden"`
	Deleted  bool                 `json:"deleted"`
	Data     string               `json:"data"` // inline ciphertext, used when there are no chunked Children
}

type edenEntry struct {
	Data string `json:"data"`
}

// LeafChunk is a content-addressed chunk document (_id "h:<hash>").
type LeafChunk struct {
	Data string `json:"data"`
}

// IsChunkOrDesignDoc reports whether a CouchDB doc ID belongs to a leaf
// chunk or a design document, as opposed to a vault file.
func IsChunkOrDesignDoc(id string) bool {
	return strings.HasPrefix(id, "h:") || strings.HasPrefix(id, "_design/")
}

// ReassembleFile decrypts and concatenates a file doc's content, resolving
// chunk references against inline "eden" data first and falling back to a
// bulk fetch of leaf chunk documents. Chunks are joined in Children order
// with no separator, matching how LiveSync splits the original file.
func ReassembleFile(ctx context.Context, client *Client, dec *Decryptor, doc *FileEntry) (string, error) {
	if len(doc.Children) == 0 {
		if doc.Data == "" {
			return "", nil
		}
		return dec.DecryptChunk(doc.Data)
	}

	var toFetch []string
	for _, id := range doc.Children {
		if _, inEden := doc.Eden[id]; !inEden {
			toFetch = append(toFetch, id)
		}
	}
	fetched, err := client.BulkGet(ctx, toFetch)
	if err != nil {
		return "", fmt.Errorf("livesync: fetch chunks for %s: %w", doc.Path, err)
	}

	var body strings.Builder
	for _, id := range doc.Children {
		encData, err := resolveChunkData(id, doc, fetched)
		if err != nil {
			return "", err
		}
		plain, err := dec.DecryptChunk(encData)
		if err != nil {
			return "", fmt.Errorf("livesync: decrypt chunk %s for %s: %w", id, doc.Path, err)
		}
		body.WriteString(plain)
	}
	return body.String(), nil
}

func resolveChunkData(id string, doc *FileEntry, fetched map[string]json.RawMessage) (string, error) {
	if e, inEden := doc.Eden[id]; inEden {
		return e.Data, nil
	}
	raw, ok := fetched[id]
	if !ok {
		return "", fmt.Errorf("livesync: missing chunk %s for %s", id, doc.Path)
	}
	var leaf LeafChunk
	if err := json.Unmarshal(raw, &leaf); err != nil {
		return "", fmt.Errorf("livesync: decode chunk %s: %w", id, err)
	}
	return leaf.Data, nil
}
