package middleware

import (
	"net/http"

	"github.com/gorilla/sessions"
)

const SessionName = "bloggy_session"
const SessionUserID = "user_id"

func RequireAuth(store sessions.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			sess, err := store.Get(r, SessionName)
			if err != nil || sess.Values[SessionUserID] == nil {
				http.Redirect(w, r, "/admin/login", http.StatusFound)
				return
			}
			userID, ok := sess.Values[SessionUserID].(int64)
			if !ok {
				http.Redirect(w, r, "/admin/login", http.StatusFound)
				return
			}
			ctx := SetUserID(r.Context(), userID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func SessionStore(secretKey string) sessions.Store {
	store := sessions.NewCookieStore([]byte(secretKey))
	store.Options = &sessions.Options{
		Path:     "/",
		MaxAge:   86400 * 30,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	}
	return store
}
