package main

import (
	"flag"
	"slices"
	"testing"
)

// realFlags mirrors how run() asks the live flag set which flags take a
// value, so this test cannot drift from the program.
func realFlags() func(string) bool {
	fs := flag.NewFlagSet("todomd-web", flag.ContinueOnError)
	fs.String("file", "", "")
	fs.String("f", "", "")
	fs.String("port", "", "")
	fs.String("poll", "", "")
	fs.String("todomd", "", "")
	fs.Bool("open", false, "")
	fs.Bool("version", false, "")
	return takesValue(fs)
}

func TestFlagsFirst(t *testing.T) {
	tests := []struct {
		name string
		args []string
		want []string
	}{
		{
			// The case that shipped broken in v0.2.0: --port was read as a
			// third todo file, and the error talked about a missing TODO.md.
			"flags after files",
			[]string{"a/TODO.md", "b/TODO.md", "--port", "8080"},
			[]string{"--port", "8080", "--", "a/TODO.md", "b/TODO.md"},
		},
		{
			"flags before files are left alone",
			[]string{"--port", "8080", "a/TODO.md"},
			[]string{"--port", "8080", "--", "a/TODO.md"},
		},
		{
			"boolean flags take no value",
			[]string{"a/TODO.md", "--open", "b/TODO.md"},
			[]string{"--open", "--", "a/TODO.md", "b/TODO.md"},
		},
		{
			"--flag=value keeps its value",
			[]string{"a/TODO.md", "--port=8080"},
			[]string{"--port=8080", "--", "a/TODO.md"},
		},
		{
			"repeated -f",
			[]string{"-f", "a/TODO.md", "-f", "b/TODO.md", "--open"},
			[]string{"-f", "a/TODO.md", "-f", "b/TODO.md", "--open"},
		},
		{
			"everything after -- is a file",
			[]string{"--port", "8080", "--", "-weird-name.md"},
			[]string{"--port", "8080", "--", "-weird-name.md"},
		},
		{
			// The case that sent --poll's value off as a file path, because a
			// hand-kept list of value-taking flags had not heard of it.
			"a flag added later still takes its value",
			[]string{"a/TODO.md", "--poll", "10s"},
			[]string{"--poll", "10s", "--", "a/TODO.md"},
		},
		{"no arguments", nil, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := flagsFirst(tt.args, realFlags()); !slices.Equal(got, tt.want) {
				t.Errorf("flagsFirst(%q) = %q, want %q", tt.args, got, tt.want)
			}
		})
	}
}
