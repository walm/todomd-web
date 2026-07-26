package todomd

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Address is a todo file, on this machine or another one.
type Address struct {
	// Host is "" for a local file, otherwise the ssh destination — a hostname,
	// a user@host, or an alias from the user's ssh config.
	Host string
	Path string
}

// Remote reports whether this address is on another machine.
func (a Address) Remote() bool { return a.Host != "" }

// String renders the address the way it is written: scp syntax for remote.
func (a Address) String() string {
	if a.Remote() {
		return a.Host + ":" + a.Path
	}
	return a.Path
}

// remoteRe matches scp-style destinations: an ssh destination, a colon, and an
// absolute or home-relative path. Requiring the path to start with / or ~ is
// what keeps a local file called "notes:2026.md" local.
var remoteRe = regexp.MustCompile(`^([A-Za-z0-9_][A-Za-z0-9_.@-]*):([~/].*)$`)

// ParseAddress reads "host:/path", "user@host:~/path" or a local path.
// Local paths are made absolute; remote ones are left exactly as written,
// because only the remote machine can resolve them.
func ParseAddress(s string) (Address, error) {
	s = strings.TrimSpace(s)
	if m := remoteRe.FindStringSubmatch(s); m != nil {
		return Address{Host: m[1], Path: m[2]}, nil
	}
	abs, err := filepath.Abs(s)
	if err != nil {
		return Address{}, err
	}
	return Address{Path: abs}, nil
}

// quote wraps an argument for the remote shell. ssh concatenates its command
// arguments into one string that the *remote* shell parses, so the "no shell
// is involved" guarantee local invocations enjoy has to be re-established
// here — this is the one place a task description containing quotes, newlines
// or $ could otherwise turn into remote command execution.
func quote(arg string) string {
	return "'" + strings.ReplaceAll(arg, "'", `'\''`) + "'"
}

// quotePath is quote for a file path, keeping a leading ~ outside the quotes
// so the remote shell still expands it. Only the path is treated this way;
// everything else stays fully quoted.
func quotePath(path string) string {
	switch {
	case path == "~":
		return "~"
	case strings.HasPrefix(path, "~/"):
		return "~/" + quote(strings.TrimPrefix(path, "~/"))
	default:
		return quote(path)
	}
}

// remoteCommand builds the single command string ssh will hand to the remote
// shell: the binary, --file, and the arguments, each quoted.
func remoteCommand(bin, file string, args []string) string {
	parts := make([]string, 0, len(args)+3)
	parts = append(parts, quote(bin))
	if file != "" {
		parts = append(parts, "--file", quotePath(file))
	}
	for _, a := range args {
		parts = append(parts, quote(a))
	}
	return strings.Join(parts, " ")
}

// controlPath is where ssh keeps its multiplexed connection sockets. %C is a
// hash of (host, port, user), which keeps the socket path short — unix sockets
// are capped around 100 characters.
func controlPath() string {
	base := os.Getenv("XDG_STATE_HOME")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "" // no multiplexing; correctness is unaffected
		}
		base = filepath.Join(home, ".local", "state")
	}
	dir := filepath.Join(base, "todomd-web", "ssh")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return ""
	}
	return filepath.Join(dir, "%C")
}

// sshArgs assembles the ssh invocation for one command.
//
// The options are deliberate: a fresh handshake costs 100–300ms and the board
// makes several requests per refresh, so connections are multiplexed and kept
// warm; and BatchMode turns a host that wants a passphrase into a fast, legible
// error instead of a request that hangs on a prompt nobody can see. The user's
// ~/.ssh/config is left alone, so aliases, jump hosts, keys and ports keep
// working where they are already configured.
func sshArgs(host, command string) []string {
	args := []string{
		"-o", "BatchMode=yes",
		"-o", "ConnectTimeout=10",
	}
	if path := controlPath(); path != "" {
		args = append(args,
			"-o", "ControlMaster=auto",
			"-o", "ControlPersist=60s",
			"-o", "ControlPath="+path,
		)
	}
	return append(args, host, command)
}

// sshError turns ssh's own failures into something that names the machine and
// says what to do. todomd's exit codes (1, 2, 3) travel through ssh unchanged,
// so they keep their meaning and are left alone.
func sshError(host string, e *Error) *Error {
	switch e.Code {
	case 255:
		msg := strings.TrimSpace(e.Msg)
		if msg == "" {
			msg = "connection failed"
		}
		e.Msg = fmt.Sprintf("cannot reach %s over ssh: %s", host, msg)
	case 127:
		e.Msg = fmt.Sprintf("todomd is not on PATH on %s — set this project's "+
			"\"todomd\" to its full path (an ssh command runs a non-interactive "+
			"shell, which often skips ~/.local/bin)", host)
	}
	return e
}

// hostKey is a stable identifier for a host, used where a filename is needed.
func hostKey(host string) string {
	sum := sha256.Sum256([]byte(host))
	return hex.EncodeToString(sum[:4])
}
