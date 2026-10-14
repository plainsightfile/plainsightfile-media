#!/usr/bin/env bash
# push_media.sh <file> <name>
# Publishes one video on the "media" branch of plainsightfile/plainsightfile-media so Metricool can fetch it.
# The branch tip only ever holds the newest video (older ones are removed in the same commit). Pushes are plain
# fast-forwards; this session type cannot force-push or delete branches.
# Prints: <commit sha> <raw url pinned to that commit>
set -euo pipefail
SRC="$(realpath "$1")"; NAME="$2"
REPO="${MEDIA_REPO_DIR:-/home/claude/plainsightfile-media}"
[[ "$NAME" =~ ^[A-Za-z0-9._-]+\.mp4$ ]] || { echo "bad name: $NAME" >&2; exit 2; }
WT="$(mktemp -d)/media"
cd "$REPO"
if git ls-remote --exit-code --heads origin media >/dev/null 2>&1; then
  git fetch -q --depth 1 origin +refs/heads/media:refs/remotes/origin/media
  git worktree add -q --force -B media-pub "$WT" origin/media
else
  git worktree add -q --force --detach "$WT" HEAD
  cd "$WT"; git checkout -q --orphan media-pub; git rm -rfq . ; cd "$REPO"
fi
cd "$WT"
git rm -rfq --ignore-unmatch media >/dev/null 2>&1 || true
rm -rf media; mkdir -p media
cp "$SRC" "media/$NAME"
printf '# media\n\nThis branch holds only the video currently being scheduled for @plainsightfile. Each publish replaces it.\n' > README.md
git add -A media README.md
git -c user.name=plainsightfile -c user.email=plainsightfile@users.noreply.github.com commit -qm "Publish ${NAME}

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git -c push.negotiate=false push -q origin HEAD:refs/heads/media
SHA="$(git rev-parse HEAD)"
cd "$REPO"; git worktree remove --force "$WT" >/dev/null 2>&1 || true; git branch -D media-pub >/dev/null 2>&1 || true
echo "$SHA https://raw.githubusercontent.com/plainsightfile/plainsightfile-media/${SHA}/media/${NAME}"
