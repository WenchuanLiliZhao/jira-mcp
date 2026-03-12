#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
JIRA_MCP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

COMMANDS=(
  ".cursor/commands/queries/jira.md"
  ".cursor/commands/queries/confluence.md"
  ".cursor/commands/queries/jira-create-issues.md"
)
RULES=(
  ".cursor/rules/task-creation.mdc"
)

usage() {
  cat <<EOF
Usage: $(basename "$0") [options] <target-project>

Link jira-mcp commands and rules into another project via symlinks.

Options:
  -u, --unlink   Remove previously created symlinks
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

ALL_FILES=("${COMMANDS[@]}" "${RULES[@]}")

if $LIST; then
  echo "Would link from jira-mcp into $TARGET:"
  for f in "${ALL_FILES[@]}"; do
    echo "  $f"
  done
  exit 0
fi

if $UNLINK; then
  removed=0
  for f in "${ALL_FILES[@]}"; do
    dest="$TARGET/$f"
    if [[ -L "$dest" ]]; then
      rm "$dest"
      echo "  removed  $f"
      ((removed++))
    fi
  done
  echo "Done — $removed symlink(s) removed."
else
  linked=0
  skipped=0
  for f in "${ALL_FILES[@]}"; do
    src="$JIRA_MCP_ROOT/$f"
    dest="$TARGET/$f"

    if [[ ! -f "$src" ]]; then
      echo "  missing  $f  (source not found, skipped)"
      ((skipped++))
      continue
    fi

    mkdir -p "$(dirname "$dest")"

    if [[ -L "$dest" ]]; then
      rm "$dest"
    elif [[ -e "$dest" ]]; then
      echo "  skipped  $f  (regular file already exists)"
      ((skipped++))
      continue
    fi

    ln -s "$src" "$dest"
    echo "  linked   $f"
    ((linked++))
  done
  echo "Done — $linked linked, $skipped skipped."
fi
