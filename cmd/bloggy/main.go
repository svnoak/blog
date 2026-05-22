package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"syscall"

	"bloggy/internal/config"
	"bloggy/internal/db"
	"bloggy/internal/handlers"
	mw "bloggy/internal/middleware"
	"bloggy/internal/models"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"golang.org/x/term"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "usage: bloggy <serve|useradd> [flags]\n")
		os.Exit(1)
	}

	switch os.Args[1] {
	case "serve":
		runServe(os.Args[2:])
	case "useradd":
		runUseradd(os.Args[2:])
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", os.Args[1])
		os.Exit(1)
	}
}

func runServe(args []string) {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	cfgPath := fs.String("config", "config.toml", "path to config file")
	fs.Parse(args)

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	database, err := db.Open(cfg.Server.DBPath)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer database.Close()

	// Sync tenants from config
	for _, tc := range cfg.Tenants {
		if _, err := mw.UpsertTenant(database, tc.Name, tc.Domain); err != nil {
			log.Fatalf("upsert tenant %s: %v", tc.Domain, err)
		}
	}

	store := mw.SessionStore(cfg.Server.SecretKey)
	tmpls, err := handlers.LoadTemplates("templates")
	if err != nil {
		log.Fatalf("templates: %v", err)
	}

	authH := &handlers.AuthHandler{DB: database, Store: store, Tmpls: tmpls}
	publicH := handlers.NewPublicHandler(database, tmpls, store)
	adminH := &handlers.AdminHandler{DB: database, Store: store, Tmpls: tmpls}
	setupH := &handlers.SetupHandler{DB: database, Store: store, Tmpls: tmpls}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(mw.TenantMiddleware(database))

	r.Handle("/static/*", http.StripPrefix("/static/", http.FileServer(http.Dir("static"))))

	// Public routes
	r.Get("/", publicH.Index)
	r.Get("/posts/{slug}", publicH.ShowPost)
	r.Get("/tags/{slug}", publicH.TagIndex)
	r.Get("/feed.xml", publicH.Feed)
	r.Get("/sitemap.xml", publicH.Sitemap)

	// First-run setup (no auth required)
	r.Get("/admin/setup", setupH.SetupGet)
	r.Post("/admin/setup", setupH.SetupPost)

	// Auth routes
	r.Get("/admin/login", authH.LoginGet)
	r.Post("/admin/login", authH.LoginPost)
	r.Get("/admin/logout", authH.Logout)

	// Admin routes (require session)
	r.Group(func(r chi.Router) {
		r.Use(mw.RequireAuth(store))
		r.Get("/admin", func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, "/admin/posts", http.StatusFound)
		})
		r.Get("/admin/posts", adminH.PostList)
		r.Get("/admin/posts/new", adminH.NewPost)
		r.Post("/admin/posts", adminH.CreatePost)
		r.Get("/admin/posts/{id}/edit", adminH.EditPost)
		r.Get("/admin/posts/{id}/preview", adminH.PreviewPost)
		r.Post("/admin/posts/{id}", adminH.UpdatePost)
		r.Post("/admin/posts/{id}/publish", adminH.PublishPost)
		r.Post("/admin/posts/{id}/unpublish", adminH.UnpublishPost)
		r.Post("/admin/posts/{id}/delete", adminH.DeletePost)
		r.Get("/admin/users", adminH.UserList)
		r.Get("/admin/users/new", adminH.UserNew)
		r.Post("/admin/users", adminH.UserCreate)
		r.Post("/admin/users/{id}/delete", adminH.UserDelete)
		r.Get("/admin/account", adminH.AccountGet)
		r.Post("/admin/account", adminH.AccountPost)
		r.Get("/admin/settings", adminH.SettingsGet)
		r.Post("/admin/settings", adminH.SettingsPost)
		r.Post("/admin/settings/fonts", adminH.FontUpload)
		r.Post("/admin/settings/fonts/{id}/delete", adminH.FontDelete)
		r.Post("/admin/upload/image", adminH.ImageUpload)
	})

	addr := fmt.Sprintf(":%d", cfg.Server.Port)
	log.Printf("bloggy listening on %s", addr)
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatal(err)
	}
}

func runUseradd(args []string) {
	fs := flag.NewFlagSet("useradd", flag.ExitOnError)
	cfgPath := fs.String("config", "config.toml", "path to config file")
	domain := fs.String("domain", "", "tenant domain")
	email := fs.String("email", "", "author email")
	name := fs.String("name", "", "display name")
	fs.Parse(args)

	if *domain == "" || *email == "" || *name == "" {
		fmt.Fprintln(os.Stderr, "usage: bloggy useradd --domain DOMAIN --email EMAIL --name NAME")
		os.Exit(1)
	}

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	database, err := db.Open(cfg.Server.DBPath)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer database.Close()

	// Ensure tenant exists
	tenant, err := mw.UpsertTenant(database, *domain, *domain)
	if err != nil || tenant == nil {
		// Try to find an existing tenant for this domain
		log.Fatalf("domain %q not found in tenants table — add it to config.toml and run 'serve' first", *domain)
	}

	fmt.Printf("Password for %s: ", *email)
	pw, err := term.ReadPassword(int(syscall.Stdin))
	fmt.Println()
	if err != nil {
		log.Fatalf("read password: %v", err)
	}

	if err := models.CreateUser(database, tenant.ID, *email, *name, string(pw)); err != nil {
		log.Fatalf("create user: %v", err)
	}
	fmt.Printf("User %s (%s) created for %s\n", *name, *email, *domain)
}
