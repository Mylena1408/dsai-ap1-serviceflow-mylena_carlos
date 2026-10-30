#!/usr/bin/env sh
# Counts executable lines added since the baseline (SPEC/2026-10-29-plano-escala-100k.md, section 3.2).
# Usage: sh scripts/cloc-diff.sh [base-ref] [head-ref]   (defaults: baseline-ap2 HEAD)
# Extracts both versions with git archive because `cloc --git --diff` under-reports on Windows.
set -eu

base_ref="${1:-baseline-ap2}"
head_ref="${2:-HEAD}"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

mkdir -p "$work_dir/base" "$work_dir/head"
git archive "$base_ref" src tests scripts | tar -x -C "$work_dir/base"
git archive "$head_ref" src tests scripts | tar -x -C "$work_dir/head"

cd "$work_dir"
for scope in src tests scripts; do
  echo "== $scope"
  cloc --quiet --diff "base/$scope" "head/$scope" \
    --include-lang=TypeScript,JavaScript --not-match-f='\.d\.ts$' | sed -n '/^SUM:/,$p'
done
echo "== total"
cloc --quiet --diff base head --include-lang=TypeScript,JavaScript --not-match-f='\.d\.ts$' \
  | awk '/^SUM:/ { sum = 1 } sum { print }
         sum && $1 == "added" { added = $NF }
         sum && $1 == "removed" { removed = $NF }
         END { printf "net (added - removed): %d\n", added - removed }'
