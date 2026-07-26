#!/bin/sh
# Builds the two projects the demo records against, and the config file that
# lists them — so the recording shows a real project switcher, not a fixed
# command-line list. Deterministic on purpose: the gif should look the same
# every time it is re-recorded, apart from task ids.
#
# Prints the id of the task the driver opens.
#
#   sh seed.sh /path/to/workdir
set -eu
work="$1"
main="$work/todomd-web/TODO.md"
house="$work/house/TODO.md"

rm -rf "$work/todomd-web" "$work/house" "$work/config"
mkdir -p "$work/todomd-web" "$work/house" "$work/config/todomd-web"

td() { todomd --file "$1" "$@" >/dev/null 2>&1 || true; }
# `add --json` prints the created task; its id is the first "id" field.
add_id() { todomd --file "$1" add "$2" --json | sed -n 's/.*"id": "\([^"]*\)".*/\1/p' | head -1; }

todomd --file "$main" init --title "todomd-web" >/dev/null
todomd --file "$house" init --title "house" >/dev/null

todomd --file "$main" add "Ship the web UI" --board Backlog --tag ui --tag core --due 2026-08-01 --priority high \
  --desc 'Kanban board, task detail, comments — all over the same `TODO.md`.

- [x] board and columns
- [x] task detail
- [ ] drag and drop' >/dev/null
todomd --file "$main" add "Write the README" --board Backlog --tag docs >/dev/null
todomd --file "$main" add "Support tag filters" --board Backlog --tag ui --due 2026-08-14 >/dev/null
todomd --file "$main" add "Publish a Homebrew tap" --board Backlog --tag release --priority low >/dev/null

parser=$(add_id "$main" "Rewrite the parser")
todomd --file "$main" update "$parser" --tag core --due 2026-07-29 --priority high \
  --desc 'Fenced code keeps its colours:

```go
func Parse(data []byte) (*task.File, error) {
    text := strings.ReplaceAll(string(data), "\r\n", "\n")
    if len(text) == 0 {
        return nil, errors.New("empty file")
    }
    return parse(text)
}
```' >/dev/null
todomd --file "$main" move "$parser" --to "In Progress" >/dev/null
# The agent's half of the conversation, so the demo opens on a real thread.
todomd --file "$main" comment "$parser" --author ai \
  "Hand-rolled the parser instead of goldmark — round-trips exactly, so hand edits survive." >/dev/null

todomd --file "$main" add "Design the HTTP API" --board Done --tag core >/dev/null

# The second project: quiet to begin with, so the unread count that appears on
# it later is unmistakably the agent's doing.
todomd --file "$house" add "Book the boiler service" --board Backlog --tag admin >/dev/null
todomd --file "$house" add "Fix the gate latch" --board "In Progress" --tag outdoor --priority high >/dev/null

cat >"$work/config/todomd-web/config.json" <<JSON
{
  "projects": [
    { "file": "$main" },
    { "file": "$house" }
  ]
}
JSON

echo "$parser"
