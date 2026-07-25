package livesync

import (
	"reflect"
	"testing"
)

func TestParseFrontmatter(t *testing.T) {
	cases := []struct {
		name     string
		content  string
		wantFM   Frontmatter
		wantBody string
	}{
		{
			name: "basic fields with list tags",
			content: "---\n" +
				"publish: stories\n" +
				"title: A Short Story\n" +
				"tags: [fiction, short]\n" +
				"---\n" +
				"Once upon a time.",
			wantFM:   Frontmatter{Publish: "stories", Title: "A Short Story", Tags: []string{"fiction", "short"}},
			wantBody: "Once upon a time.",
		},
		{
			name: "csv tags and quoted values",
			content: "---\n" +
				"publish: \"blog\"\n" +
				"tags: selfhosting, docker\n" +
				"---\n" +
				"Body text here.\n",
			wantFM:   Frontmatter{Publish: "blog", Tags: []string{"selfhosting", "docker"}},
			wantBody: "Body text here.\n",
		},
		{
			name:     "no frontmatter block",
			content:  "# Just a heading\n\nNo frontmatter here.",
			wantFM:   Frontmatter{},
			wantBody: "# Just a heading\n\nNo frontmatter here.",
		},
		{
			name:     "unclosed frontmatter is left as-is",
			content:  "---\npublish: blog\nno closing delimiter",
			wantFM:   Frontmatter{},
			wantBody: "---\npublish: blog\nno closing delimiter",
		},
		{
			name:     "frontmatter with no trailing body",
			content:  "---\npublish: blog\n---",
			wantFM:   Frontmatter{Publish: "blog"},
			wantBody: "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotFM, gotBody := ParseFrontmatter(tc.content)
			if !reflect.DeepEqual(gotFM, tc.wantFM) {
				t.Errorf("frontmatter = %+v, want %+v", gotFM, tc.wantFM)
			}
			if gotBody != tc.wantBody {
				t.Errorf("body = %q, want %q", gotBody, tc.wantBody)
			}
		})
	}
}
