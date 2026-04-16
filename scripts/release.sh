#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# release.sh — Commit all changes, bump version if needed, push, and tag
#               to trigger the GitHub Actions Release workflow.
#
# Usage:
#   bash scripts/release.sh            # interactive
#   bash scripts/release.sh --dry-run  # preview without pushing
# ---------------------------------------------------------------------------

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

# ── helpers ────────────────────────────────────────────────────────────────

die()   { echo "ERROR: $*" >&2; exit 1; }
info()  { echo "── $*"; }
confirm() {
  local prompt="$1"
  read -rp "$prompt [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
}

# ── preflight checks ──────────────────────────────────────────────────────

command -v git  >/dev/null || die "git is not installed"
command -v node >/dev/null || die "node is not installed"
command -v npm  >/dev/null || die "npm is not installed"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "Not inside a git repository"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# ── read current version from package.json ────────────────────────────────

PKG_VERSION="$(node -p "require('./package.json').version")"
info "package.json version: $PKG_VERSION"

# ── determine latest released tag ─────────────────────────────────────────

LATEST_TAG="$(git tag --sort=-v:refname --list 'v[0-9]*' | head -1)"
LATEST_RELEASED="${LATEST_TAG#v}"
info "Latest released tag:  ${LATEST_TAG:-<none>} (${LATEST_RELEASED:-<none>})"

# ── bump version if it matches the latest release ─────────────────────────

if [[ "$PKG_VERSION" == "$LATEST_RELEASED" ]]; then
  echo ""
  echo "⚠  package.json version ($PKG_VERSION) matches the latest release ($LATEST_TAG)."
  echo "   You need to specify a new version."
  echo ""
  echo "   Examples:  5.0.2 | patch | minor | major | prepatch | preminor | premajor | prerelease"
  echo ""
  read -rp "New version: " NEW_VERSION
  [[ -n "$NEW_VERSION" ]] || die "No version provided"

  # npm version updates package.json (and package-lock.json if present).
  # --no-git-tag-version: we create the tag ourselves later.
  npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version=false 2>/dev/null \
    || die "npm version failed — is '$NEW_VERSION' a valid semver bump?"

  PKG_VERSION="$(node -p "require('./package.json').version")"
  info "Version bumped to: $PKG_VERSION"
fi

TAG="v$PKG_VERSION"

# ── guard: tag must not already exist ─────────────────────────────────────

if git rev-parse "$TAG" >/dev/null 2>&1; then
  die "Tag $TAG already exists. Bump the version first or delete the stale tag."
fi

# ── check for changes to commit ───────────────────────────────────────────

if git diff --quiet && git diff --cached --quiet && [[ -z "$(git ls-files --others --exclude-standard)" ]]; then
  info "Working tree is clean — nothing to commit."
  NEED_COMMIT=false
else
  NEED_COMMIT=true
fi

# ── show summary and confirm ──────────────────────────────────────────────

echo ""
echo "┌───────────────────────────────────────────"
echo "│  Release summary"
echo "├───────────────────────────────────────────"
echo "│  Version : $PKG_VERSION"
echo "│  Tag     : $TAG"
echo "│  Commit  : ${NEED_COMMIT}"
if $DRY_RUN; then
echo "│  Mode    : DRY RUN (no push)"
fi
echo "└───────────────────────────────────────────"
echo ""

if $NEED_COMMIT; then
  git status --short
  echo ""
fi

confirm "Proceed?"

# ── commit ────────────────────────────────────────────────────────────────

if $NEED_COMMIT; then
  info "Staging all changes…"
  git add -A
  info "Committing…"
  git commit -m "Release $TAG"
fi

# ── push + tag ────────────────────────────────────────────────────────────

if $DRY_RUN; then
  info "[DRY RUN] Would push to origin and create tag $TAG"
  echo "Done (dry run)."
  exit 0
fi

info "Pushing to origin…"
git push origin main

info "Creating tag $TAG…"
git tag "$TAG"

info "Pushing tag $TAG to trigger Release workflow…"
git push origin "$TAG"

echo ""
echo "✔ Release $TAG pushed. GitHub Actions will build and publish the release."
echo "  Track progress: https://github.com/$(git remote get-url origin | sed -E 's|.*github\.com[:/]||;s|\.git$||')/actions"
