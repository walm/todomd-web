package main

import (
	"slices"
	"testing"
)

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
		{"no arguments", nil, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := flagsFirst(tt.args); !slices.Equal(got, tt.want) {
				t.Errorf("flagsFirst(%q) = %q, want %q", tt.args, got, tt.want)
			}
		})
	}
}
