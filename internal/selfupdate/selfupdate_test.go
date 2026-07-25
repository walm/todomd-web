package selfupdate

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// tarball builds a release archive containing a todomd-web binary with the
// given contents.
func tarball(t *testing.T, binary string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for _, f := range []struct{ name, body string }{
		{"README.md", "docs"},
		{Binary, binary},
	} {
		if err := tw.WriteHeader(&tar.Header{
			Name: f.name, Mode: 0o755, Size: int64(len(f.body)), Typeflag: tar.TypeReg,
		}); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(f.body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// releaseServer serves a fake v9.9.9 release. corrupt publishes a checksum
// that does not match the archive.
func releaseServer(t *testing.T, archive []byte, corrupt bool) *Client {
	t.Helper()
	asset := AssetName("v9.9.9", runtime.GOOS, runtime.GOARCH)
	sum := sha256.Sum256(archive)
	digest := hex.EncodeToString(sum[:])
	if corrupt {
		digest = strings.Repeat("0", 64)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/releases/latest"):
			fmt.Fprint(w, `{"tag_name":"v9.9.9"}`)
		case strings.HasSuffix(r.URL.Path, "/"+asset):
			w.Write(archive)
		case strings.HasSuffix(r.URL.Path, "/checksums.txt"):
			fmt.Fprintf(w, "%s  %s\n%s  other_asset.tar.gz\n", digest, asset, strings.Repeat("1", 64))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return &Client{HTTP: srv.Client(), APIURL: srv.URL, DownloadURL: srv.URL}
}

// script is a tiny executable standing in for a downloaded binary: it answers
// --version the way the real one does, which is what Install checks.
func script(version string) string {
	return "#!/bin/sh\necho 'todomd-web version " + version + "'\n"
}

func TestLatestAndDownload(t *testing.T) {
	archive := tarball(t, script("v9.9.9"))
	client := releaseServer(t, archive, false)

	latest, err := client.Latest(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if latest != "v9.9.9" {
		t.Fatalf("latest = %q", latest)
	}

	bin, err := client.Download(t.Context(), latest)
	if err != nil {
		t.Fatal(err)
	}
	if string(bin) != script("v9.9.9") {
		t.Errorf("downloaded the wrong file: %q", bin)
	}
}

func TestDownloadRefusesABadChecksum(t *testing.T) {
	// The whole point of checking: a mismatch must stop the install, not warn.
	client := releaseServer(t, tarball(t, script("v9.9.9")), true)
	_, err := client.Download(t.Context(), "v9.9.9")
	if err == nil || !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatalf("err = %v, want a checksum mismatch", err)
	}
}

func TestInstallReplacesInPlace(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, Binary)
	if err := os.WriteFile(target, []byte(script("v0.0.1")), 0o755); err != nil {
		t.Fatal(err)
	}

	if err := Install([]byte(script("v9.9.9")), target); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != script("v9.9.9") {
		t.Errorf("target was not replaced: %q", got)
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o755 {
		t.Errorf("mode = %v, want 0755", info.Mode().Perm())
	}
	// No temp files left behind.
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Errorf("directory = %d entries, want just the binary", len(entries))
	}
}

func TestInstallRefusesABinaryThatDoesNotRun(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, Binary)
	original := script("v0.0.1")
	if err := os.WriteFile(target, []byte(original), 0o755); err != nil {
		t.Fatal(err)
	}

	// A checksum proves the bytes arrived, not that they run on this machine —
	// and the server execs into this binary, so a broken one would take the
	// board down with no terminal in sight.
	for _, bad := range []struct {
		name, body string
	}{
		{"not executable at all", "\x00\x01 not a program"},
		{"some other program", "#!/bin/sh\necho hello\n"},
	} {
		t.Run(bad.name, func(t *testing.T) {
			if err := Install([]byte(bad.body), target); err == nil {
				t.Fatal("expected an error")
			}
			got, _ := os.ReadFile(target)
			if string(got) != original {
				t.Errorf("a failed install must leave the old binary alone, got %q", got)
			}
		})
	}
}

func TestInstallFollowsSymlinks(t *testing.T) {
	dir := t.TempDir()
	real := filepath.Join(dir, "real-binary")
	link := filepath.Join(dir, Binary)
	if err := os.WriteFile(real, []byte(script("v0.0.1")), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(real, link); err != nil {
		t.Fatal(err)
	}

	if err := Install([]byte(script("v9.9.9")), link); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(real); string(got) != script("v9.9.9") {
		t.Errorf("the link target should have been replaced: %q", got)
	}
	if info, err := os.Lstat(link); err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Errorf("the symlink itself should survive: %v %v", info.Mode(), err)
	}
}

func TestVersionComparison(t *testing.T) {
	for _, tt := range []struct {
		current, remote string
		newer           bool
	}{
		{"v0.2.1", "v0.3.0", true},
		{"v0.9.0", "v0.10.0", true}, // not a string comparison
		{"v0.2.1", "v0.2.1", false},
		{"v0.3.0", "v0.2.1", false},
		{"dev", "v0.3.0", false}, // nothing to compare
		// A go-install pseudo-version sorts below the release it names, which
		// is what semver says. Not "upgrading" such a build backwards is
		// IsRelease's job, not this one's.
		{"v0.2.1-0.20260725151828-ad0f4898b977", "v0.2.1", true},
		{"v0.2.1-0.20260725151828-ad0f4898b977", "v0.3.0", true},
	} {
		if got := Newer(tt.current, tt.remote); got != tt.newer {
			t.Errorf("Newer(%q, %q) = %v, want %v", tt.current, tt.remote, got, tt.newer)
		}
	}
}

func TestIsRelease(t *testing.T) {
	for v, want := range map[string]bool{
		"v0.2.1": true,
		"v1.0.0": true,
		"dev":    false,
		"":       false,
		// go install stamps a pseudo-version; it is already past the release
		// it was built from, so it must not be "upgraded" backwards into it.
		"v0.2.1-0.20260725151828-ad0f4898b977": false,
	} {
		if got := IsRelease(v); got != want {
			t.Errorf("IsRelease(%q) = %v, want %v", v, got, want)
		}
	}
}

func TestAssetNameMatchesWhatGoreleaserPublishes(t *testing.T) {
	// If this drifts, upgrades 404 while install.sh keeps working.
	if got := AssetName("v0.2.1", "darwin", "arm64"); got != "todomd-web_0.2.1_darwin_arm64.tar.gz" {
		t.Errorf("AssetName = %q", got)
	}
}

func TestCacheRoundTrip(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	if _, _, ok := LoadCache(); ok {
		t.Fatal("a missing cache should not report a hit")
	}
	now := time.Date(2026, 7, 25, 12, 0, 0, 0, time.UTC)
	if err := SaveCache("v9.9.9", now); err != nil {
		t.Fatal(err)
	}
	latest, at, ok := LoadCache()
	if !ok || latest != "v9.9.9" || !at.Equal(now) {
		t.Errorf("cache = %q %v %v", latest, at, ok)
	}
	if Stale(now.Add(time.Hour)) {
		t.Error("an hour old is fresh")
	}
	if !Stale(now.Add(CheckInterval + time.Minute)) {
		t.Error("past the interval is stale")
	}
}

func TestDisabled(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	if Disabled("v0.2.1") {
		t.Error("a release build should check")
	}
	if !Disabled("dev") {
		t.Error("a dev build has nothing to compare and should stay quiet")
	}
	t.Setenv(NoCheckEnv, "1")
	if !Disabled("v0.2.1") {
		t.Errorf("%s should switch checking off", NoCheckEnv)
	}
}

func TestRefreshCacheRespectsTheInterval(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	now := time.Now()
	if err := SaveCache("v1.0.0", now); err != nil {
		t.Fatal(err)
	}
	// Fresh: no network call, so the recorded version stays put even though a
	// newer one is published.
	RefreshCache(t.Context(), "v0.1.0", now.Add(time.Minute))
	if latest, _, _ := LoadCache(); latest != "v1.0.0" {
		t.Errorf("a fresh cache should not be refetched, got %q", latest)
	}
}
