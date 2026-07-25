package livesync

import "strings"

// Frontmatter holds the handful of flat fields the publish pipeline reads
// out of a note's YAML frontmatter. This is deliberately not a general YAML
// parser — the vault only ever needs a few flat scalar/list fields here, and
// pulling in a full YAML library would be more machinery than that warrants.
type Frontmatter struct {
	Publish string // tenant key this note should publish to, e.g. "blog" or "stories"
	Title   string // optional; falls back to the note's first H1 or its filename
	Tags    []string
}

// ParseFrontmatter splits a leading "---\n...\n---\n" block off content and
// parses its flat key: value lines. If content has no frontmatter block, it
// returns a zero Frontmatter and content unchanged as the body.
func ParseFrontmatter(content string) (Frontmatter, string) {
	normalized := strings.ReplaceAll(content, "\r\n", "\n")
	const delim = "---\n"
	if !strings.HasPrefix(normalized, delim) {
		return Frontmatter{}, content
	}

	rest := normalized[len(delim):]
	end := strings.Index(rest, "\n---\n")
	bodyStart := -1
	var block string
	if end != -1 {
		block = rest[:end]
		bodyStart = end + len("\n---\n")
	} else if strings.HasSuffix(rest, "\n---") {
		block = rest[:len(rest)-len("\n---")]
		bodyStart = len(rest)
	} else {
		// No closing delimiter — not a valid frontmatter block.
		return Frontmatter{}, content
	}

	var fm Frontmatter
	for _, line := range strings.Split(block, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = unquote(strings.TrimSpace(value))
		switch key {
		case "publish":
			fm.Publish = value
		case "title":
			fm.Title = value
		case "tags":
			fm.Tags = parseTagList(value)
		}
	}
	return fm, rest[bodyStart:]
}

func unquote(s string) string {
	if len(s) >= 2 {
		if (s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'') {
			return s[1 : len(s)-1]
		}
	}
	return s
}

// parseTagList accepts both inline-list ("[a, b, c]") and comma-separated
// ("a, b, c") tag syntax.
func parseTagList(value string) []string {
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(value, "[")
	value = strings.TrimSuffix(value, "]")
	var tags []string
	for _, raw := range strings.Split(value, ",") {
		tag := unquote(strings.TrimSpace(raw))
		if tag != "" {
			tags = append(tags, tag)
		}
	}
	return tags
}
