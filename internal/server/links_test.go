package server

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/walm/todomd-web/internal/todomd"
)

// newCard adds a card through the API. It skips the test when the todomd on
// PATH predates links (v0.14.0): its cards come back without them.
func newCard(t *testing.T, srv *httptest.Server, title, board string) string {
	t.Helper()
	var created taskResponse
	if code := do(t, srv, "POST", "/api/projects/solo/tasks", `{"title":"`+title+`","board":"`+board+`"}`, &created); code != http.StatusCreated {
		t.Fatalf("create %q: status %d", title, code)
	}
	if created.Task.Links == nil {
		t.Skip("the todomd on PATH predates links (v0.14.0)")
	}
	return created.Task.ID
}

func linksOf(t *testing.T, srv *httptest.Server, id string) []todomd.Link {
	t.Helper()
	var board boardResponse
	if code := do(t, srv, "GET", "/api/projects/solo/board", "", &board); code != http.StatusOK {
		t.Fatalf("board status = %d", code)
	}
	for _, b := range board.Boards {
		for _, task := range b.Tasks {
			if task.ID == id {
				return task.Links
			}
		}
	}
	t.Fatalf("no card %s on the board", id)
	return nil
}

func TestLinksAddAndRemove(t *testing.T) {
	srv, file := newTestServer(t)
	parent := newCard(t, srv, "Offline mode", "Backlog")
	child := newCard(t, srv, "Queue writes", "In Progress")

	var linked taskResponse
	code := do(t, srv, "POST", "/api/projects/solo/tasks/"+child+"/links", `{"kind":"split from","to":"`+parent+`"}`, &linked)
	if code != http.StatusOK {
		t.Fatalf("link status = %d", code)
	}
	if len(linked.Task.Links) != 1 || linked.Task.Links[0].Kind != "split from" || linked.Task.Links[0].StoredOn != child {
		t.Fatalf("links on the reply = %+v", linked.Task.Links)
	}

	// Stored once, on the card it was made from, in todomd's own format…
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if n := strings.Count(string(raw), "#### Links"); n != 1 || !strings.Contains(string(raw), "- split from "+parent+"\n") {
		t.Fatalf("TODO.md after linking:\n%s", raw)
	}
	// …and shown from the other end, inverted, with the card's title and board.
	back := linksOf(t, srv, parent)
	if len(back) != 1 || back[0].Kind != "split into" || back[0].ID != child || back[0].StoredOn != child ||
		back[0].Title == nil || *back[0].Title != "Queue writes" || *back[0].Board != "In Progress" {
		t.Fatalf("links on the parent = %+v", back)
	}

	// The same link again, from either end, changes nothing.
	do(t, srv, "POST", "/api/projects/solo/tasks/"+parent+"/links", `{"kind":"split into","to":"`+child+`"}`, nil)
	if again, _ := os.ReadFile(file); string(again) != string(raw) {
		t.Errorf("relinking changed the file:\n%s", again)
	}

	// Removing from the parent, whose kind reads "split into", takes the
	// line off the child, where it is stored.
	var removed unlinkResponse
	code = do(t, srv, "DELETE", "/api/projects/solo/tasks/"+parent+"/links/"+child+"?kind="+url.QueryEscape("split into"), "", &removed)
	if code != http.StatusOK {
		t.Fatalf("unlink status = %d", code)
	}
	if len(removed.Removed) != 1 || removed.Removed[0].StoredOn != child || removed.Removed[0].Kind != "split from" {
		t.Errorf("removed = %+v", removed.Removed)
	}
	if l := linksOf(t, srv, child); l == nil || len(l) != 0 {
		t.Errorf("links left on the child = %#v", l)
	}
	if after, _ := os.ReadFile(file); strings.Contains(string(after), "#### Links") {
		t.Errorf("an empty section was left behind:\n%s", after)
	}

	// Nothing left to remove: todomd's exit 2.
	if code := do(t, srv, "DELETE", "/api/projects/solo/tasks/"+parent+"/links/"+child, "", nil); code != http.StatusNotFound {
		t.Errorf("unlinking twice: status %d, want 404", code)
	}
}

func TestLinksRefused(t *testing.T) {
	srv, _ := newTestServer(t)
	a := newCard(t, srv, "A", "Backlog")
	b := newCard(t, srv, "B", "Backlog")

	for _, tt := range []struct {
		name, id, body string
		want           int
	}{
		{"self link", a, `{"kind":"related","to":"` + a + `"}`, http.StatusBadRequest},
		{"unknown kind", a, `{"kind":"parent of","to":"` + b + `"}`, http.StatusBadRequest},
		{"flag as kind", a, `{"kind":"--help","to":"` + b + `"}`, http.StatusBadRequest},
		{"flag as target", a, `{"kind":"related","to":"--json"}`, http.StatusBadRequest},
		{"no such card", a, `{"kind":"related","to":"zzzz"}`, http.StatusNotFound},
		{"no such source", "zzzz", `{"kind":"related","to":"` + b + `"}`, http.StatusNotFound},
		{"unknown field", a, `{"kind":"related","to":"` + b + `","title":"x"}`, http.StatusBadRequest},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var e errorResponse
			if code := do(t, srv, "POST", "/api/projects/solo/tasks/"+tt.id+"/links", tt.body, &e); code != tt.want {
				t.Errorf("status = %d (%s), want %d", code, e.Error, tt.want)
			}
		})
	}
	if l := linksOf(t, srv, a); len(l) != 0 {
		t.Errorf("a refused link was stored: %+v", l)
	}
}

func TestLinksLimit(t *testing.T) {
	srv, file := newTestServer(t)
	hub := newCard(t, srv, "Hub", "Backlog")
	for i := range 50 {
		other := newCard(t, srv, "Other "+string(rune('a'+i%26))+string(rune('a'+i/26)), "Backlog")
		cli(t, file, "links", "add", hub, "related", other)
	}
	last := newCard(t, srv, "One too many", "Backlog")
	var e errorResponse
	if code := do(t, srv, "POST", "/api/projects/solo/tasks/"+hub+"/links", `{"kind":"related","to":"`+last+`"}`, &e); code != http.StatusBadRequest {
		t.Errorf("the 51st link: status %d, want 400", code)
	}
	if !strings.Contains(e.Error, "50") {
		t.Errorf("error = %q", e.Error)
	}
}

// An agent's link, stored on the other card, counts as its change; the
// server's own unlink of it doesn't come back as one.
func TestUnlinkIsOwnChange(t *testing.T) {
	srv, file := newTestServer(t)
	a := newCard(t, srv, "A", "Backlog")
	b := newCard(t, srv, "B", "Backlog")
	do(t, srv, "GET", "/api/projects/solo/changes", "", &changesResponse{}) // start the cursor

	cli(t, file, "links", "add", b, "blocks", a)
	var ch changesResponse
	do(t, srv, "GET", "/api/projects/solo/changes", "", &ch)
	if len(ch.Events) != 1 || ch.Events[0].TaskID != b || ch.Events[0].Fields["links"].New == nil {
		t.Fatalf("the agent's link: events = %+v", ch.Events)
	}

	if code := do(t, srv, "DELETE", "/api/projects/solo/tasks/"+a+"/links/"+b, "", nil); code != http.StatusOK {
		t.Fatalf("unlink status = %d", code)
	}
	do(t, srv, "GET", "/api/projects/solo/changes", "", &ch)
	if len(ch.Events) != 0 {
		t.Errorf("our own unlink came back as a change: %+v", ch.Events)
	}
}
