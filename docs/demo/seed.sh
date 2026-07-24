#!/bin/sh
# Builds the board the demo records against. Deterministic on purpose: the
# gif should look the same every time it is re-recorded, apart from task ids.
# Prints the id of the task the driver opens.
#
#   sh seed.sh /path/to/TODO.md
set -eu
file="$1"
rm -f "$file"

td() { todomd --file "$file" "$@" >/dev/null; }
# `add --json` prints the created task; its id is the first "id" field.
add_id() { todomd --file "$file" add "$@" --json | sed -n 's/.*"id": "\([^"]*\)".*/\1/p' | head -1; }

td init --title "todomd-web"

td add "Ship the web UI" --board Backlog --tag ui --tag core --due 2026-08-01 \
  --desc 'Kanban board, task detail, comments — all over the same `TODO.md`.

- [x] board and columns
- [x] task detail
- [ ] drag and drop'
td add "Write the README" --board Backlog --tag docs
td add "Support tag filters" --board Backlog --tag ui --due 2026-08-14
td add "Publish a Homebrew tap" --board Backlog --tag release

parser=$(add_id "Rewrite the parser" --board "In Progress" --tag core --due 2026-07-29 \
  --desc 'Fenced code keeps its colours:

```go
func Parse(data []byte) (*task.File, error) {
    text := strings.ReplaceAll(string(data), "\r\n", "\n")
    if len(text) == 0 {
        return nil, errors.New("empty file")
    }
    return parse(text)
}
```')

td add "Design the HTTP API" --board Done --tag core

# The agent's half of the conversation, so the demo opens on a real thread.
td comment "$parser" --author ai \
  "Hand-rolled the parser instead of goldmark — round-trips exactly, so hand edits survive."

echo "$parser"
