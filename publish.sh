#!/usr/bin/env bash
set -euo pipefail

# Publishes the current main branch to the public remote.
#
# Default (incremental): replays each new commit on main onto public/main,
#   preserving original commit messages and author info.
#
# --squash: resets public repo to a single orphan commit (no history).
#
# Public-only file rules applied to every published commit:
#   - .github/workflows/      replaced with .github/workflows-public/ contents
#   - .github/workflows-public/  removed
#   - .public-overlay/<path>     copied over project root <path>
#   - .public-strip              listed paths removed
#   - .public-overlay/, .public-strip  themselves removed
#
# How "what's new" is tracked: a local tag 'published' points at the last
# main commit that was published. The tag is updated after each push.
#
# Setup (one-time):
#   git remote add public git@github.com:<your-user>/apelsin.git
#   git tag published $(git rev-parse HEAD)
#
# Usage:
#   ./publish.sh                  # incremental publish (preserves history)
#   ./publish.sh --dry-run        # preview without pushing
#   ./publish.sh --squash         # reset public to a single orphan commit
#   ./publish.sh --squash -m "msg" # squash with custom commit message

REMOTE="public"
BRANCH="main"
PUBLISHED_TAG="published"
DRY_RUN=false
SQUASH=false
COMMIT_MSG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --squash)  SQUASH=true; shift ;;
    -m)        COMMIT_MSG="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# Ensure we're on main
CURRENT_BRANCH=$(git branch --show-current)
if [[ "$CURRENT_BRANCH" != "$BRANCH" ]]; then
  echo "Error: must be on '$BRANCH' branch (currently on '$CURRENT_BRANCH')"
  exit 1
fi

# Ensure working tree is clean
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: working tree is not clean. Commit or stash changes first."
  exit 1
fi

# Ensure remote exists
if ! git remote get-url "$REMOTE" &>/dev/null; then
  echo "Error: remote '$REMOTE' not found."
  echo "Set it up with: git remote add $REMOTE git@github.com:<your-user>/apelsin.git"
  exit 1
fi

ORIGINAL_COMMIT=$(git rev-parse HEAD)
TMP_BRANCH="publish-tmp-$$"

# Snapshot all "public-only" sources before we start manipulating the tree.
SNAPSHOT_DIR=$(mktemp -d)
mkdir -p "$SNAPSHOT_DIR/workflows" "$SNAPSHOT_DIR/overlay"
cp -r .github/workflows-public/. "$SNAPSHOT_DIR/workflows/"
[[ -d .public-overlay ]] && cp -r .public-overlay/. "$SNAPSHOT_DIR/overlay/"
[[ -f .public-strip ]] && cp .public-strip "$SNAPSHOT_DIR/strip"

restore() {
  git checkout --quiet "$BRANCH" 2>/dev/null || true
  git reset --hard --quiet "$ORIGINAL_COMMIT" 2>/dev/null || true
  git branch -D "$TMP_BRANCH" --quiet 2>/dev/null || true
  rm -rf "$SNAPSHOT_DIR"
}
trap restore EXIT

# Apply all public-only transformations to the current working tree
# and stage the changes.
apply_public_overlay() {
  # 1. Swap workflows
  rm -rf .github/workflows .github/workflows-public
  mkdir -p .github/workflows
  cp -r "$SNAPSHOT_DIR/workflows/." .github/workflows/

  # 2. Apply overlay files (each path under .public-overlay/ overwrites the same path at root)
  if [[ -d "$SNAPSHOT_DIR/overlay" ]]; then
    cp -r "$SNAPSHOT_DIR/overlay/." ./
  fi

  # 3. Remove paths listed in .public-strip
  if [[ -f "$SNAPSHOT_DIR/strip" ]]; then
    while IFS= read -r path; do
      # skip blank lines and comments
      [[ -z "$path" || "$path" =~ ^[[:space:]]*# ]] && continue
      rm -rf "$path"
    done < "$SNAPSHOT_DIR/strip"
  fi

  # 4. Remove the overlay/strip files themselves
  rm -rf .public-overlay .public-strip

  git add -A
}

if $SQUASH; then
  COMMIT_MSG="${COMMIT_MSG:-feat: apelsin}"
  echo "==> Squash mode: creating orphan branch..."
  git checkout --orphan "$TMP_BRANCH" --quiet
  apply_public_overlay
  git commit -m "$COMMIT_MSG" --no-verify --quiet
  PUSH_FORCE="--force"
else
  if ! git rev-parse "$PUBLISHED_TAG" >/dev/null 2>&1; then
    echo "Error: no '$PUBLISHED_TAG' tag found locally."
    echo
    echo "If your previous publish was the squash from this script, mark it:"
    echo "  git tag $PUBLISHED_TAG <last-published-commit-hash>"
    echo
    echo "Or run with --squash to reset the public repo (loses public history)."
    exit 1
  fi

  LAST_PUBLISHED=$(git rev-parse "$PUBLISHED_TAG")
  NEW_COMMITS=$(git rev-list --reverse "$LAST_PUBLISHED..$ORIGINAL_COMMIT")

  if [[ -z "$NEW_COMMITS" ]]; then
    echo "==> No new commits since last publish."
    exit 0
  fi

  COUNT=$(echo "$NEW_COMMITS" | wc -l | tr -d ' ')
  echo "==> Replaying $COUNT new commit(s) onto $REMOTE/$BRANCH..."

  echo "==> Fetching $REMOTE/$BRANCH..."
  git fetch --quiet "$REMOTE" "$BRANCH"

  git checkout -b "$TMP_BRANCH" --quiet "$REMOTE/$BRANCH"

  for commit in $NEW_COMMITS; do
    SHORT=$(git rev-parse --short "$commit")
    SUBJECT=$(git log -1 --pretty=%s "$commit")
    echo "    - $SHORT $SUBJECT"

    if ! git cherry-pick --no-commit -X theirs "$commit" >/dev/null 2>&1; then
      UNMERGED=$(git diff --name-only --diff-filter=U)
      if [[ -n "$UNMERGED" ]]; then
        echo "$UNMERGED" | xargs git checkout --theirs --
        git add -A
      fi
    fi

    apply_public_overlay

    # Skip empty commits (e.g. commit only changed files we just stripped/overlaid)
    if git diff --cached --quiet HEAD; then
      git reset --hard --quiet HEAD
      continue
    fi

    GIT_AUTHOR_NAME=$(git log -1 --pretty=%an "$commit") \
    GIT_AUTHOR_EMAIL=$(git log -1 --pretty=%ae "$commit") \
    GIT_AUTHOR_DATE=$(git log -1 --pretty=%aI "$commit") \
      git commit -m "$(git log -1 --pretty=%B "$commit")" --no-verify --quiet
  done

  PUSH_FORCE=""
fi

if $DRY_RUN; then
  echo "==> [dry-run] Would push to $REMOTE/$BRANCH${PUSH_FORCE:+ (force)}"
  echo "    Commits to be pushed:"
  if $SQUASH; then
    git log --oneline HEAD | head -5
  else
    git log --oneline "$REMOTE/$BRANCH..HEAD"
  fi
else
  echo "==> Pushing to $REMOTE/$BRANCH${PUSH_FORCE:+ (force)}..."
  git push $PUSH_FORCE "$REMOTE" "HEAD:$BRANCH"

  git tag -f "$PUBLISHED_TAG" "$ORIGINAL_COMMIT" >/dev/null
  echo "==> Updated '$PUBLISHED_TAG' tag → $(git rev-parse --short "$ORIGINAL_COMMIT")"
fi

echo "==> Done!"
