package handlers

import (
	"encoding/json"
	"html/template"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Templates struct {
	t *template.Template
}

func LoadTemplates(dir string) (*Templates, error) {
	funcMap := template.FuncMap{
		"formatDate": func(t *time.Time) string {
			if t == nil {
				return ""
			}
			return t.Format("2 January 2006")
		},
		"formatDateVal": func(t time.Time) string {
			return t.Format("2 January 2006")
		},
		"safeHTML": func(s string) template.HTML {
			return template.HTML(s)
		},
		"jsonString": func(s string) template.JS {
			b, _ := json.Marshal(s)
			return template.JS(b)
		},
	}
	t := template.New("").Funcs(funcMap)
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".html") {
			return err
		}
		rel, _ := filepath.Rel(dir, path)
		name := filepath.ToSlash(rel)
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if _, err := t.New(name).Parse(string(b)); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &Templates{t: t}, nil
}

func (t *Templates) Render(w http.ResponseWriter, name string, data any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := t.t.ExecuteTemplate(w, name, data); err != nil {
		http.Error(w, "template error: "+err.Error(), http.StatusInternalServerError)
	}
}
