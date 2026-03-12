#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
JIRA_MCP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

COMMANDS_DIR=".cursor/commands/jira-mcp"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options] <target-project>

Link jira-mcp commands into another project via a single directory symlink.

What gets linked:
  .cursor/commands/jira-mcp/   (all Jira/Confluence commands)

Options:
  -u, --unlink   Remove previously created symlink
  -l, --list     Show what would be linked (dry run)
  -h, --help     Show this help

Example:
  $(basename "$0") ~/projects/my-app
  $(basename "$0") --unlink ~/projects/my-app
EOF
  exit 0
}

UNLINK=false
LIST=false
TARGET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -u|--unlink) UNLINK=true; shift ;;
    -l|--list)   LIST=true; shift ;;
    -h|--help)   usage ;;
    -*) echo "Unknown option: $1"; exit 1 ;;
    *)  TARGET="$1"; shift ;;
  esac
done

[[ -z "$TARGET" ]] && { echo "Error: target project path required."; echo "Run with --help for usage."; exit 1; }

TARGET="$(cd "$TARGET" 2>/dev/null && pwd)" || { echo "Error: directory does not exist: $TARGET"; exit 1; }
[[ "$TARGET" == "$JIRA_MCP_ROOT" ]] && { echo "Error: target is jira-mcp itself."; exit 1; }

if $LIST; then
  echo "Would link from jira-mcp into $TARGET:"
  echo "  $COMMANDS_DIR/"
  exit 0
fi

if $UNLINK; then
  if [[ -L "$TARGET/$COMMANDS_DIR" ]]; then
    rm "$TARGET/$COMMANDS_DIR"
    echo "  removed  $COMMANDS_DIR"
    echo "Done — 1 symlink removed."
  else
    echo "Done — nothing to remove."
  fi
else
  mkdir -p "$TARGET/.cursor/commands"

  if [[ -L "$TARGET/$COMMANDS_DIR" ]]; then
    rm "$TARGET/$COMMANDS_DIR"
  elif [[ -e "$TARGET/$COMMANDS_DIR" ]]; then
    echo "  skipped  $COMMANDS_DIR  (already exists as regular directory)"
    echo "Done — 0 linked, 1 skipped."
    exit 0
  fi

  ln -s "$JIRA_MCP_ROOT/$COMMANDS_DIR" "$TARGET/$COMMANDS_DIR"
  echo "  linked   $COMMANDS_DIR/"
  echo "Done — 1 linked."
fi
