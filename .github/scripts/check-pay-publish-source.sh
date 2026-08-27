#!/usr/bin/env bash
# Direct, same-repository workflow_dispatch only. Never rewrite GitHub identity.
set -euo pipefail
# Do not let inherited command-scope configuration introduce content filters.
# Keep checkout-local config (including its authentication) and GitHub identity.
unset GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS
for config_variable in "${!GIT_CONFIG_KEY_@}" "${!GIT_CONFIG_VALUE_@}"; do
  unset "$config_variable"
done
export LC_ALL=C GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_ATTR_NOSYSTEM=1

fail() {
  echo "Pay publisher source binding: $1" >&2
  exit 1
}

source_git() {
  git --no-replace-objects -c core.fsmonitor=false -c core.hooksPath=/dev/null "$@"
}

for coordinate in PAY_PUBLISH_SOURCE_SHA GITHUB_SHA GITHUB_WORKFLOW_SHA; do
  [[ "${!coordinate:-}" =~ ^[0-9a-f]{40}$ ]] || fail "$coordinate must be a full lowercase Git commit SHA."
done
[[ "$PAY_PUBLISH_SOURCE_SHA" == "$GITHUB_SHA" && "$GITHUB_SHA" == "$GITHUB_WORKFLOW_SHA" ]] ||
  fail "requested source, GitHub run and executing workflow must be the same commit; dispatch a fresh matching run."
[[ "${GITHUB_EVENT_NAME:-}" == workflow_dispatch ]] || fail "only direct workflow_dispatch is supported."
[[ "${GITHUB_REPOSITORY:-}" == 0xkey-io/sdk-js ]] || fail "unexpected GitHub repository."
[[ "${GITHUB_SERVER_URL:-}" == https://github.com ]] || fail "unexpected GitHub server."
[[ -n "${PAY_PUBLISH_DEFAULT_BRANCH:-}" ]] || fail "default branch is required."
source_git check-ref-format "refs/heads/$PAY_PUBLISH_DEFAULT_BRANCH" || fail "invalid default branch."
[[ "${GITHUB_REF:-}" == "refs/heads/$PAY_PUBLISH_DEFAULT_BRANCH" ]] || fail "run ref must be the exact default branch."
[[ "${GITHUB_WORKFLOW_REF:-}" == "0xkey-io/sdk-js/.github/workflows/pay-publish.yml@refs/heads/$PAY_PUBLISH_DEFAULT_BRANCH" ]] ||
  fail "executing workflow must be the exact default-branch Pay publisher."

# Read immutable objects without replacement refs, including on reruns and
# after build steps. A clean tree alone does not identify the checkout commit.
[[ "$(source_git rev-parse --verify HEAD)" == "$PAY_PUBLISH_SOURCE_SHA" ]] || fail "checkout HEAD differs from the publishing source."
[[ "$(source_git rev-parse --verify "${PAY_PUBLISH_SOURCE_SHA}^{commit}")" == "$PAY_PUBLISH_SOURCE_SHA" ]] || fail "source is not the exact commit."
source_git fetch --no-tags origin "+refs/heads/$PAY_PUBLISH_DEFAULT_BRANCH:refs/remotes/origin/$PAY_PUBLISH_DEFAULT_BRANCH"
[[ "$(source_git rev-parse --verify "refs/remotes/origin/$PAY_PUBLISH_DEFAULT_BRANCH")" == "$PAY_PUBLISH_SOURCE_SHA" ]] ||
  fail "source is not the current default-branch HEAD."

# Status/diff must not execute repository-local clean/process filters, external
# diff/textconv drivers or fsmonitor/hooks. Global/system config is disabled.
filter_status=0
source_git config --local --includes --get-regexp '^filter\..*\.(clean|process)$' >/dev/null || filter_status=$?
[[ "$filter_status" == 1 ]] || fail "repository-local clean/process filters are not permitted."
source_git diff --no-ext-diff --no-textconv --quiet || fail "tracked worktree is dirty."
source_git diff --no-ext-diff --no-textconv --cached --quiet || fail "index is dirty."
tree_status="$(source_git status --porcelain=v1 --untracked-files=all)"
[[ -z "$tree_status" ]] || fail "source tree contains unexpected changes or untracked files."
echo "Pay publisher source binding verified: $PAY_PUBLISH_SOURCE_SHA"
