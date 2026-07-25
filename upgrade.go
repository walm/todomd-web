package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/walm/todomd-web/internal/selfupdate"
)

// runUpgrade implements `todomd-web upgrade`, the terminal half of what the
// board's update banner does. Nothing writes anything until the download has
// been checksummed and the new binary has proved it runs.
func runUpgrade(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("todomd-web upgrade", flag.ContinueOnError)
	check := fs.Bool("check", false, "report the latest release without installing it")
	force := fs.Bool("force", false, "install even when already up to date or running a source build")
	asJSON := fs.Bool("json", false, "print the outcome as JSON")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: todomd-web upgrade [--check] [--force] [--json]\n\n"+
			"Download the latest release for this platform and replace this binary\n"+
			"with it, verifying the published sha256 checksum first.")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}

	current := resolveVersion()
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	client := selfupdate.NewClient()
	latest, err := client.Latest(ctx)
	if err != nil {
		return fmt.Errorf("checking for releases: %w", err)
	}
	_ = selfupdate.SaveCache(latest, time.Now())

	upToDate := !selfupdate.Newer(current, latest)
	report := func(upgraded bool, path string) error {
		if *asJSON {
			enc := json.NewEncoder(os.Stdout)
			enc.SetIndent("", "  ")
			return enc.Encode(struct {
				Current  string `json:"current"`
				Latest   string `json:"latest"`
				UpToDate bool   `json:"up_to_date"`
				Upgraded bool   `json:"upgraded"`
				Path     string `json:"path,omitempty"`
			}{current, latest, upToDate, upgraded, path})
		}
		switch {
		case upgraded:
			fmt.Printf("upgraded to todomd-web %s (%s)\n", latest, path)
		case !selfupdate.IsRelease(current):
			fmt.Printf("todomd-web %s is a development build; latest release is %s\n", current, latest)
		case upToDate:
			fmt.Printf("todomd-web %s is the latest release\n", current)
		default:
			fmt.Printf("todomd-web %s is available (you have %s) — run 'todomd-web upgrade'\n", latest, current)
		}
		return nil
	}

	if *check || (upToDate && !*force) {
		return report(false, "")
	}
	// A source build has no release it corresponds to, so upgrading would
	// silently swap it for a published binary.
	if !selfupdate.IsRelease(current) && !*force {
		return fmt.Errorf("this is a development build (%s), not a release; "+
			"use 'git pull', or pass --force to install %s anyway", current, latest)
	}

	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if !*asJSON {
		fmt.Printf("downloading todomd-web %s…\n", latest)
	}
	bin, err := client.Download(ctx, latest)
	if err != nil {
		return err
	}
	if err := selfupdate.Install(bin, exe); err != nil {
		return err
	}
	return report(true, exe)
}
