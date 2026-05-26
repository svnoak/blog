package handlers

import (
	"crypto/md5"
	"encoding/json"
	"fmt"
	"html/template"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Templates struct {
	t *template.Template
}

func staticHash(dir string) string {
	h := md5.New()
	filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		h.Write(b)
		return nil
	})
	return fmt.Sprintf("%x", h.Sum(nil))[:8]
}

func LoadTemplates(dir string) (*Templates, error) {
	assetVer := staticHash("static/js")
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
		"isoDate": func(t *time.Time) string {
			if t == nil {
				return ""
			}
			return t.Format("2006-01-02")
		},
		"safeHTML": func(s string) template.HTML {
			return template.HTML(s)
		},
		"jsonString": func(s string) template.JS {
			b, _ := json.Marshal(s)
			return template.JS(b)
		},
		"assetVer": func() string { return assetVer },
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
		log.Printf("template error rendering %s: %v", name, err)
		http.Error(w, "internal server error", http.StatusInternalServerError)
	}
}
