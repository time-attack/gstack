#!/usr/bin/env bash
set -euo pipefail

consumer="$(cygpath -u "${PR2260_CONSUMER_ROOT:?}")"
cd "$consumer"
printf 'PR2260_CONSUMER_CWD=%s\n' "$PWD"
printf 'PR2260_CONSUMER_ID=%s\n' "${GSTACK_PR_TEST_REPO:?}"
printf 'PR2260_CONSUMER_REVISION=%s\n' "${PR2260_CONSUMER_REVISION:?}"

case "$GSTACK_PR_TEST_REPO:$PR2260_CONSUMER_REVISION" in
  onemancompany:8f880c03b2014e866b374c039333a1f201c971e0)
    grep -Fq '# gstack' CLAUDE.md
    grep -Fq 'Use the `/browse` skill from gstack' CLAUDE.md
    ;;
  gbrain:5008b287e47bf791132eedfebf66bdef11e9398c)
    grep -Fq '"name": "gbrain"' package.json
    grep -Fq 'GStack teaches agents how to code' CLAUDE.md
    ;;
  plane:bed58d9b17dbc8b221af9cde0cec9cec299d183b)
    test -s AGENTS.md
    test -s package.json
    ;;
  *)
    printf 'SAFETY_REFUSAL: rejected consumer/revision pair\n' >&2
    exit 94
    ;;
esac

if [[ "${PR2260_KIND:?}" == affected ]]; then
  exec bash "$(cygpath -u "${PR2260_PROBE_SCRIPT:?}")"
fi
if [[ "$PR2260_KIND" == control ]]; then
  exec bash "$(cygpath -u "${PR2260_CONTROL_SCRIPT:?}")"
fi
printf 'SAFETY_REFUSAL: rejected cohort %s\n' "$PR2260_KIND" >&2
exit 95
