#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
node tools/build_runtime.js
echo "Runtime build complete."
