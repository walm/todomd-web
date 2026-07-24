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
	var (
		file        = flag.String("file", "", "path to the todo markdown file (default: todomd's own discovery — TODOMD_FILE, then TODO.md searched upward)")
		fileShort   = flag.String("f", "", "shorthand for --file")
		port        = flag.Int("port", 7337, "port to listen on")
		author      = flag.String("author", "user", "default author for comments written in the UI")
		bin         = flag.String("todomd", "todomd", "path to the todomd binary")
		open        = flag.Bool("open", false, "open the board in your browser")
		dev         = flag.String("dev", "", "proxy the UI to a running Vite dev server, e.g. http://127.0.0.1:5173")
		showVersion = flag.Bool("version", false, "print the version and exit")
	)
	flag.Parse()
	if *showVersion {
		fmt.Println("todomd-web version " + resolveVersion())
		return nil
	}
	if *fileShort != "" && *file == "" {
		*file = *fileShort
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	client, err := todomd.New(ctx, *bin, *file)
	if err != nil {
		return err
	}

	assets, err := ui(*dev)
	if err != nil {
		return err
	}
	handler := server.New(server.Options{
		Client:  client,
		Author:  *author,
		Version: resolveVersion(),
		Assets:  assets,
	}).Handler()

	addr := fmt.Sprintf("%s:%d", host, *port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	srv := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second}

	origin := "http://" + addr
	fmt.Printf("todomd-web %s serving %s\n  %s\n", resolveVersion(), client.File, origin)
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
