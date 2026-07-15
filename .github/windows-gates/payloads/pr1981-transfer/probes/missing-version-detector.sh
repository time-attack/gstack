#!/usr/bin/env bash
# Secondary-only malformed-shape fixture for the Windows fallback control.
# Primary affected probes use the untouched production detector.
printf '%s\n' '{'
printf '%s\n' '  "gbrain_on_path": true,'
printf '%s\n' '  "gbrain_config_exists": true,'
printf '%s\n' '  "gbrain_local_status": "ok"'
printf '%s\n' '}'
