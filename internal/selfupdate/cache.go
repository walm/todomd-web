package selfupdate

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// CheckInterval is how long a recorded check stays fresh. A board that has
// been open for a week should notice a release; one open for an hour should
// not be asking GitHub about it repeatedly.
const CheckInterval = 6 * time.Hour

// NoCheckEnv disables the background check and the banner entirely.
const NoCheckEnv = "TODOMD_WEB_NO_UPDATE_CHECK"

type cacheFile struct {
	Latest    string    `json:"latest"`
	CheckedAt time.Time `json:"checked_at"`
}

// CachePath is where the last check is remembered:
// $XDG_STATE_HOME/todomd-web/update-check.json (~/.local/state when unset),
// alongside the state dir todomd itself uses.
func CachePath() (string, error) {
	base := os.Getenv("XDG_STATE_HOME")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		base = filepath.Join(home, ".local", "state")
	}
	return filepath.Join(base, "todomd-web", "update-check.json"), nil
}

// Disabled reports whether update checking is switched off, either by the
// user or because this build has no version to compare against.
func Disabled(current string) bool {
	return os.Getenv(NoCheckEnv) != "" || !IsRelease(current)
}

// LoadCache returns the last recorded latest version and when it was recorded.
// A missing or unreadable cache is not an error: it just isn't fresh.
func LoadCache() (latest string, checkedAt time.Time, ok bool) {
	p, err := CachePath()
	if err != nil {
		return "", time.Time{}, false
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return "", time.Time{}, false
	}
	var c cacheFile
	if err := json.Unmarshal(data, &c); err != nil || c.Latest == "" {
		return "", time.Time{}, false
	}
	return c.Latest, c.CheckedAt, true
}

// SaveCache records the latest known version and the time of the check.
func SaveCache(latest string, now time.Time) error {
	p, err := CachePath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	data, err := json.Marshal(cacheFile{Latest: latest, CheckedAt: now})
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0o644)
}

// refreshing keeps concurrent refreshes to one: several browser tabs asking at
// once should still be a single request to GitHub.
var refreshing sync.Mutex

// RefreshCache looks up the latest release and records it, but only if the
// cached answer has gone stale. Callers run this off the critical path — a
// slow or unreachable network must never hold up a request.
func RefreshCache(ctx context.Context, current string, now time.Time) {
	if Disabled(current) {
		return
	}
	if !refreshing.TryLock() {
		return
	}
	defer refreshing.Unlock()
	if _, checkedAt, ok := LoadCache(); ok && now.Sub(checkedAt) < CheckInterval {
		return
	}
	latest, err := NewClient().Latest(ctx)
	if err != nil {
		return // offline, rate-limited, whatever: the banner simply waits
	}
	_ = SaveCache(latest, now)
}

// Stale reports whether the cached answer is old enough to be worth
// refreshing.
func Stale(now time.Time) bool {
	_, checkedAt, ok := LoadCache()
	return !ok || now.Sub(checkedAt) >= CheckInterval
}
