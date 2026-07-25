package livesync

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// Client is a minimal CouchDB HTTP client covering only what the watcher
// needs: fetching a single doc (including `_local/*`), bulk-fetching docs by
// ID, and following the `_changes` feed. It deliberately doesn't set a
// blanket http.Client timeout — the changes feed is a long-lived streaming
// request, so callers control deadlines via context instead.
type Client struct {
	baseURL  string // e.g. "https://couch.example.com/mydb"
	username string
	password string
	http     *http.Client
}

func NewClient(rawURL, database, username, password string) *Client {
	base := strings.TrimSuffix(rawURL, "/") + "/" + url.PathEscape(database)
	return &Client{baseURL: base, username: username, password: password, http: &http.Client{}}
}

func (c *Client) do(req *http.Request) (*http.Response, error) {
	if c.username != "" {
		req.SetBasicAuth(c.username, c.password)
	}
	req.Header.Set("Accept", "application/json")
	return c.http.Do(req)
}

// Get fetches a document by ID and returns its raw JSON body.
func (c *Client) Get(ctx context.Context, docID string) (json.RawMessage, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/"+url.PathEscape(docID), nil)
	if err != nil {
		return nil, err
	}
	return c.doJSON(req)
}

// GetLocal fetches a `_local/<id>` document, which CouchDB never replicates
// or assigns a _rev history to — LiveSync stores per-database sync
// parameters (including the global PBKDF2 salt) there.
func (c *Client) GetLocal(ctx context.Context, id string) (json.RawMessage, error) {
	return c.Get(ctx, "_local/"+id)
}

func (c *Client) doJSON(req *http.Request) (json.RawMessage, error) {
	resp, err := c.do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("livesync: %s %s: unexpected status %s", req.Method, req.URL.Path, resp.Status)
	}
	var raw json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("livesync: decode response for %s: %w", req.URL.Path, err)
	}
	return raw, nil
}

type allDocsRow struct {
	ID  string          `json:"id"`
	Doc json.RawMessage `json:"doc"`
}

type allDocsResponse struct {
	Rows []allDocsRow `json:"rows"`
}

// BulkGet fetches multiple documents by ID in one round trip. Missing IDs
// (deleted, or never existed) are simply absent from the returned map.
func (c *Client) BulkGet(ctx context.Context, ids []string) (map[string]json.RawMessage, error) {
	out := make(map[string]json.RawMessage, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	body, err := json.Marshal(struct {
		Keys []string `json:"keys"`
	}{Keys: ids})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/_all_docs?include_docs=true", strings.NewReader(string(body)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("livesync: POST _all_docs: unexpected status %s", resp.Status)
	}
	var parsed allDocsResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("livesync: decode _all_docs response: %w", err)
	}
	for _, row := range parsed.Rows {
		if row.Doc != nil {
			out[row.ID] = row.Doc
		}
	}
	return out, nil
}

// ChangeEvent is one line of the CouchDB `_changes` feed.
type ChangeEvent struct {
	Seq     json.RawMessage `json:"seq"`
	ID      string          `json:"id"`
	Doc     json.RawMessage `json:"doc"`
	Deleted bool            `json:"deleted"`
}

// SeqString returns Seq as a plain string regardless of whether CouchDB
// encoded it as a JSON string or number.
func (e ChangeEvent) SeqString() string {
	return strings.Trim(string(e.Seq), `"`)
}

// Changes streams the `_changes` feed starting after since (empty string
// means from the beginning) onto the returned channel, until ctx is
// canceled or the connection drops — either closes the channel. Callers
// should treat channel closure as "reconnect with backoff" unless ctx.Err()
// is non-nil.
func (c *Client) Changes(ctx context.Context, since string) (<-chan ChangeEvent, <-chan error) {
	events := make(chan ChangeEvent)
	errs := make(chan error, 1)

	go func() {
		defer close(events)
		defer close(errs)

		q := url.Values{
			"feed":         {"continuous"},
			"include_docs": {"true"},
			"heartbeat":    {"30000"},
			"since":        {sinceOrBeginning(since)},
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/_changes?"+q.Encode(), nil)
		if err != nil {
			errs <- err
			return
		}
		resp, err := c.do(req)
		if err != nil {
			errs <- err
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			errs <- fmt.Errorf("livesync: GET _changes: unexpected status %s", resp.Status)
			return
		}

		scanner := bufio.NewScanner(resp.Body)
		scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024) // notes can be large; grow past bufio's 64KiB default
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" { // heartbeat
				continue
			}
			var ev ChangeEvent
			if err := json.Unmarshal([]byte(line), &ev); err != nil {
				errs <- fmt.Errorf("livesync: decode _changes line: %w", err)
				return
			}
			select {
			case events <- ev:
			case <-ctx.Done():
				return
			}
		}
		if err := scanner.Err(); err != nil {
			errs <- err
		}
	}()

	return events, errs
}

// sinceOrBeginning returns "0" (CouchDB's "start of change history") when no
// checkpoint is stored yet, so a fresh deployment catches up on every
// publish-flagged note already in the vault, not just future edits.
func sinceOrBeginning(since string) string {
	if since == "" {
		return "0"
	}
	return since
}
