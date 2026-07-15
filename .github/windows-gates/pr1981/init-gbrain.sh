#!/usr/bin/env bash
set -euo pipefail
unset GBRAIN_HOME MSYS_NO_PATHCONV MSYS2_ARG_CONV_EXCL
gbrain init --pglite --no-embedding
gbrain sources list --json
