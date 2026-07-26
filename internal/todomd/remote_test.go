package todomd

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestParseAddress(t *testing.T) {
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct{ in, host, path string }{
		{"deploy@web1:/srv/app/TODO.md", "deploy@web1", "/srv/app/TODO.md"},
		{"web1:/srv/app/TODO.md", "web1", "/srv/app/TODO.md"},
		{"web1:~/notes/TODO.md", "web1", "~/notes/TODO.md"},
		{"my-box.local:/x/TODO.md", "my-box.local", "/x/TODO.md"},
		{" web1:/x/TODO.md ", "web1", "/x/TODO.md"}, // trimmed
		// Local paths, including the ones that look almost remote: a relative
		// path after the colon is not an ssh destination, and a colon in a
		// filename must not send anyone's todo list to a nonexistent host.
		{"/Users/walm/TODO.md", "", "/Users/walm/TODO.md"},
		{"notes:2026.md", "", filepath.Join(cwd, "notes:2026.md")},
		{"./weird:name.md", "", filepath.Join(cwd, "weird:name.md")},
		// "C:/x" reads as the host "C" — which is what scp syntax says, and we
		// only ship on darwin and linux, so a Windows drive letter is not a
		// case that needs rescuing.
		{"C:/x/TODO.md", "C", "/x/TODO.md"},
	} {
		got, err := ParseAddress(tt.in)
		if err != nil {
			t.Fatalf("ParseAddress(%q): %v", tt.in, err)
		}
		if got.Host != tt.host || got.Path != tt.path {
			t.Errorf("ParseAddress(%q) = %+v, want host %q path %q", tt.in, got, tt.host, tt.path)
		}
		if got.Remote() != (tt.host != "") {
			t.Errorf("ParseAddress(%q).Remote() = %v", tt.in, got.Remote())
		}
	}
}

func TestAddressString(t *testing.T) {
	if got := (Address{Host: "web1", Path: "/x/TODO.md"}).String(); got != "web1:/x/TODO.md" {
		t.Errorf("String = %q", got)
	}
	if got := (Address{Path: "/x/TODO.md"}).String(); got != "/x/TODO.md" {
		t.Errorf("String = %q", got)
	}
}

// The quoting is the one place a remote command can go genuinely wrong: ssh
// hands a single string to the remote shell, so anything a task description
// can contain has to come out the other side as one argument.
func TestQuoting(t *testing.T) {
	for in, want := range map[string]string{
		"plain":          "'plain'",
		"two words":      "'two words'",
		"$HOME":          "'$HOME'",
		"`whoami`":       "'`whoami`'",
		"a'b":            `'a'\''b'`,
		"; rm -rf /":     "'; rm -rf /'",
		"line\nbreak":    "'line\nbreak'",
		"## not a board": "'## not a board'",
		"$(id)":          "'$(id)'",
		"back\\slash":    "'back\\slash'",
		"":               "''",
	} {
		if got := quote(in); got != want {
			t.Errorf("quote(%q) = %s, want %s", in, got, want)
		}
	}
}

func TestQuotePathKeepsTildeExpandable(t *testing.T) {
	// ~ has to reach the remote shell unquoted or it is a literal directory
	// name, but the rest of the path still needs quoting.
	for in, want := range map[string]string{
		"~":                "~",
		"~/TODO.md":        "~/'TODO.md'",
		"~/my notes/T.md":  "~/'my notes/T.md'",
		"/srv/app/TODO.md": "'/srv/app/TODO.md'",
		"/srv/a b/T.md":    "'/srv/a b/T.md'",
	} {
		if got := quotePath(in); got != want {
			t.Errorf("quotePath(%q) = %s, want %s", in, got, want)
		}
	}
}

func TestRemoteCommand(t *testing.T) {
	got := remoteCommand("todomd", "/srv/app/TODO.md",
		[]string{"comment", "3f2a", "it's $HOME\nsecond line", "--author", "user", "--json"})
	want := `'todomd' --file '/srv/app/TODO.md' 'comment' '3f2a' ` +
		`'it'\''s $HOME` + "\n" + `second line' '--author' 'user' '--json'`
	if got != want {
		t.Errorf("remoteCommand =\n%s\nwant\n%s", got, want)
	}
}

func TestSSHArgsCarryTheOptionsThatMatter(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	args := sshArgs("web1", "'todomd' 'list'")
	joined := strings.Join(args, " ")

	// BatchMode: a host that wants a passphrase must fail, not hang a request
	// on a prompt in a terminal nobody is looking at.
	for _, want := range []string{
		"BatchMode=yes", "ConnectTimeout=10",
		"ControlMaster=auto", "ControlPersist=60s", "ControlPath=",
	} {
		if !strings.Contains(joined, want) {
			t.Errorf("ssh args missing %s: %v", want, args)
		}
	}
	// The destination and the command come last, in that order.
	if args[len(args)-2] != "web1" || args[len(args)-1] != "'todomd' 'list'" {
		t.Errorf("ssh args end = %q", args[len(args)-2:])
	}
}

func TestSSHErrorsSayWhichMachineAndWhatToDo(t *testing.T) {
	unreachable := sshError("web1", &Error{Code: 255, Msg: "Connection refused"})
	if !strings.Contains(unreachable.Error(), "web1") ||
		!strings.Contains(unreachable.Error(), "Connection refused") {
		t.Errorf("255: %q", unreachable.Error())
	}
	// 127 is the shell saying "command not found", which over ssh nearly
	// always means a non-interactive PATH without ~/.local/bin.
	missing := sshError("web1", &Error{Code: 127, Msg: "bash: todomd: command not found"})
	if !strings.Contains(missing.Error(), "not on PATH on web1") ||
		!strings.Contains(missing.Error(), "\"todomd\"") {
		t.Errorf("127: %q", missing.Error())
	}
	// todomd's own exit codes travel through ssh unchanged and keep meaning
	// what they mean.
	notFound := sshError("web1", &Error{Code: 2, Msg: `no task with id "zz"`})
	if notFound.Error() != `no task with id "zz"` || !notFound.NotFound() {
		t.Errorf("2: %q", notFound.Error())
	}
}

// fakeSSH puts an "ssh" on PATH that records the argv it was called with and
// replays canned stdout — the whole chain, quoting included, without a host.
func fakeSSH(t *testing.T, stdout string, exitCode int) (*Client, string) {
	t.Helper()
	dir := t.TempDir()
	argsFile := filepath.Join(dir, "args")
	outFile := filepath.Join(dir, "stdout")
	if err := os.WriteFile(outFile, []byte(stdout), 0o644); err != nil {
		t.Fatal(err)
	}
	script := "#!/bin/sh\n" +
		"printf '%s\\0' \"$@\" > \"$TODOMD_FAKE_ARGS\"\n" +
		"if [ \"$TODOMD_FAKE_EXIT\" != 0 ]; then echo 'ssh: connect to host web1 port 22: Connection refused' >&2; exit \"$TODOMD_FAKE_EXIT\"; fi\n" +
		"cat \"$TODOMD_FAKE_STDOUT\"\n"
	if err := os.WriteFile(filepath.Join(dir, "ssh"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("TODOMD_FAKE_ARGS", argsFile)
	t.Setenv("TODOMD_FAKE_STDOUT", outFile)
	t.Setenv("TODOMD_FAKE_EXIT", "0")
	t.Setenv("XDG_STATE_HOME", dir)
	return &Client{Bin: "todomd", File: "/srv/app/TODO.md", Host: "deploy@web1"}, argsFile
}

func TestRemoteClientBuildsOneQuotedCommand(t *testing.T) {
	c, argsFile := fakeSSH(t, oneTask, 0)

	tricky := "it's $HOME\n## not a board"
	if _, err := c.Comment(t.Context(), "3f2a", "user", tricky); err != nil {
		t.Fatal(err)
	}
	args := recordedArgs(t, argsFile)
	if args[len(args)-2] != "deploy@web1" {
		t.Fatalf("destination = %q", args[len(args)-2])
	}
	command := args[len(args)-1]
	// One argument to ssh, with the file and the comment text quoted inside it.
	if !strings.Contains(command, `--file '/srv/app/TODO.md'`) {
		t.Errorf("command lost the file: %s", command)
	}
	if !strings.Contains(command, `'it'\''s $HOME`+"\n"+`## not a board'`) {
		t.Errorf("command did not quote the comment: %s", command)
	}
}

func TestRemoteClientSurfacesConnectionFailures(t *testing.T) {
	c, _ := fakeSSH(t, "", 255)
	t.Setenv("TODOMD_FAKE_EXIT", "255")

	_, err := c.List(t.Context())
	if err == nil {
		t.Fatal("expected an error")
	}
	if !strings.Contains(err.Error(), "cannot reach deploy@web1") {
		t.Errorf("err = %q", err)
	}
}

func TestRemoteClientHasNoRev(t *testing.T) {
	// stat would be another round trip for something the UI only uses as a
	// hint, so remote projects simply have no revision.
	c := &Client{Bin: "todomd", File: "/srv/app/TODO.md", Host: "web1"}
	if got := c.Rev(); got != "" {
		t.Errorf("Rev = %q, want empty", got)
	}
}

func TestLocalClientIsUnaffected(t *testing.T) {
	// The local path must not gain an ssh hop by accident.
	c, argsFile := fakeClient(t, oneTask, 0)
	if _, err := c.Show(t.Context(), "3f2a"); err != nil {
		t.Fatal(err)
	}
	if got := recordedArgs(t, argsFile); !slices.Equal(got,
		[]string{"--file", "/tmp/TODO.md", "show", "3f2a", "--json"}) {
		t.Errorf("argv = %q", got)
	}
}
