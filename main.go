// Command todomd-web serves a Kanban web UI over a TODO.md file, driving the
// todomd CLI for every read and write.
//
// It binds to localhost only and has no authentication: it can create, edit
// and delete tasks in a file on your machine. To reach it from a phone, put
// it behind something that does authentication and transport security —
// `tailscale serve` or an SSH tunnel — rather than exposing the port.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"runtime/debug"
	"strings"
	"syscall"
	"time"

	"github.com/walm/todomd-web/internal/project"
	"github.com/walm/todomd-web/internal/server"
	"github.com/walm/todomd-web/internal/todomd"
	"github.com/walm/todomd-web/web"
)

// version is stamped by the release build via
// -ldflags "-X main.version=v0.x.y"; plain `go build` falls back to module
// build info.
var version = "dev"

// host is deliberately not configurable — see the package comment.
const host = "127.0.0.1"

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "todomd-web: "+err.Error())
		os.Exit(1)
	}
}

func run() error {
	// One subcommand, so no framework: anything else is flags and file paths.
	if len(os.Args) > 1 && os.Args[1] == "upgrade" {
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		return runUpgrade(ctx, os.Args[2:])
	}

	var files fileList
	var (
		port        = flag.Int("port", 7337, "port to listen on")
		author      = flag.String("author", "user", "default author for comments written in the UI")
		bin         = flag.String("todomd", "todomd", "path to the todomd binary")
		open        = flag.Bool("open", false, "open the board in your browser")
		dev         = flag.String("dev", "", "proxy the UI to a running Vite dev server, e.g. http://127.0.0.1:5173")
		configPath  = flag.String("config", "", "project list to use (default: $XDG_CONFIG_HOME/todomd-web/config.json)")
		showVersion = flag.Bool("version", false, "print the version and exit")
	)
	flag.Var(&files, "file", "todo markdown file to serve; repeat for several projects (default: the config file, else TODO.md searched upward)")
	flag.Var(&files, "f", "shorthand for --file")
	flag.Usage = func() {
		fmt.Fprint(os.Stderr, "Usage: todomd-web [flags] [TODO.md...]\n\n"+
			"Commands:\n  upgrade\tinstall the latest release over this binary\n\nFlags:\n")
		flag.PrintDefaults()
	}
	if err := flag.CommandLine.Parse(flagsFirst(os.Args[1:])); err != nil {
		return err
	}
	// Files may also be given positionally: todomd-web a/TODO.md b/TODO.md
	files = append(files, flag.Args()...)
	if *showVersion {
		fmt.Println("todomd-web version " + resolveVersion())
		return nil
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	registry, err := projects(ctx, *bin, files, *configPath)
	if err != nil {
		return err
	}

	assets, err := ui(*dev)
	if err != nil {
		return err
	}
	handler := server.New(server.Options{
		Registry: registry,
		Bin:      *bin,
		Author:   *author,
		Version:  resolveVersion(),
		Assets:   assets,
		Restart:  restart,
	}).Handler()

	addr := fmt.Sprintf("%s:%d", host, *port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	srv := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second}

	origin := "http://" + addr
	fmt.Printf("todomd-web %s\n", resolveVersion())
	for _, entry := range registry.List() {
		fmt.Printf("  %-16s %s\n", entry.Name, entry.File)
	}
	if len(registry.List()) == 0 {
		fmt.Printf("  no projects yet — add one in the browser\n")
	}
	fmt.Printf("  %s\n", origin)
	if *open {
		openBrowser(origin)
	}

	errs := make(chan error, 1)
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errs <- err
		}
	}()
	select {
	case err := <-errs:
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return srv.Shutdown(shutdown)
	}
}

// valueFlags are the flags that take a separate argument. flagsFirst needs to
// know them to tell "--port 8080" (a flag and its value) from a file path.
var valueFlags = map[string]bool{
	"file": true, "f": true, "port": true, "author": true,
	"todomd": true, "dev": true, "config": true,
}

// flagsFirst moves flags ahead of positional arguments, because Go's flag
// package stops parsing at the first non-flag argument: without this,
// `todomd-web a/TODO.md --port 8080` reads --port as a third todo file and
// fails with a baffling "no TODO.md found".
func flagsFirst(args []string) []string {
	var flags, positional []string
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--":
			positional = append(positional, args[i+1:]...)
			i = len(args)
		case len(arg) > 1 && strings.HasPrefix(arg, "-"):
			flags = append(flags, arg)
			name := strings.TrimLeft(arg, "-")
			if !strings.Contains(arg, "=") && valueFlags[name] && i+1 < len(args) {
				i++
				flags = append(flags, args[i])
			}
		default:
			positional = append(positional, arg)
		}
	}
	if len(positional) == 0 {
		return flags
	}
	// "--" so a file path that happens to start with a dash stays a file.
	return append(append(flags, "--"), positional...)
}

// restart replaces this process with a fresh one, same arguments and
// environment. Used after an upgrade applied from the browser: exec keeps the
// pid and the terminal it was started from, and the listening socket is closed
// by the exec so the new process can take the port straight back.
func restart() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return syscall.Exec(exe, os.Args, os.Environ())
}

// fileList collects a repeatable --file flag.
type fileList []string

func (f *fileList) String() string { return strings.Join(*f, ", ") }

func (f *fileList) Set(value string) error {
	*f = append(*f, value)
	return nil
}

// projects builds the registry: files named on the command line are the whole
// list and cannot be edited from the browser; otherwise the config file is,
// and a TODO.md discovered in the working directory seeds it without being
// written to disk until the list actually changes.
func projects(ctx context.Context, bin string, files []string, configPath string) (*project.Registry, error) {
	if len(files) > 0 {
		for _, f := range files {
			// Fail loudly at startup rather than with a broken board later.
			if _, err := todomd.New(ctx, bin, f); err != nil {
				return nil, err
			}
		}
		return project.FromFiles(files)
	}

	if configPath == "" {
		var err error
		if configPath, err = project.ConfigPath(); err != nil {
			return nil, err
		}
	}
	registry, err := project.Load(configPath)
	if err != nil {
		return nil, err
	}
	if len(registry.List()) > 0 {
		return registry, nil
	}

	// Nothing configured: fall back to what a single-file todomd-web did —
	// todomd's own discovery from the working directory. A missing file is no
	// longer fatal, because the UI can add one.
	client, err := todomd.New(ctx, bin, "")
	if err != nil {
		if errors.Is(err, todomd.ErrNotInstalled) {
			return nil, err
		}
		fmt.Fprintln(os.Stderr, "todomd-web: "+err.Error())
		return registry, nil
	}
	return registry, registry.Seed(client.File)
}

// ui serves the embedded bundle, or proxies to a Vite dev server when --dev
// gives its address.
func ui(devTarget string) (http.Handler, error) {
	if devTarget == "" {
		return web.Assets(), nil
	}
	target, err := url.Parse(devTarget)
	if err != nil {
		return nil, fmt.Errorf("--dev %q: %w", devTarget, err)
	}
	return httputil.NewSingleHostReverseProxy(target), nil
}

func resolveVersion() string {
	if version != "dev" {
		return version
	}
	// A local `go build` synthesises a v0.0.0-<date>-<commit> pseudo-version,
	// which reads like a real release but isn't one — call those "dev".
	if bi, ok := debug.ReadBuildInfo(); ok && bi.Main.Version != "" &&
		bi.Main.Version != "(devel)" && !strings.HasPrefix(bi.Main.Version, "v0.0.0-") {
		return bi.Main.Version
	}
	return version
}

func openBrowser(url string) {
	cmd := "xdg-open"
	if _, err := exec.LookPath("open"); err == nil {
		cmd = "open"
	}
	_ = exec.Command(cmd, url).Start()
}
