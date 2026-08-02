# Runtime-only tail for office-hours

Nothing here runs on the canonical `npx skills add` install: it ships no `$GSTACK_BIN`.
Read this file only after the probe in `references/RUNTIME.md` reported
`GSTACK_RUNTIME_PRESENT`. Every command below writes to or reads from
`${GSTACK_HOME:-$HOME/.gstack}`, never project files.

## Brain Cache Background Refresh

After the skill's work completes (and telemetry has logged), kick a
background refresh of any cache digest that's getting close to its TTL.
This is non-blocking — the user doesn't wait. Next invocation benefits
from the warm cache.

```bash
eval "$($GSTACK_BIN/gstack-slug 2>/dev/null)" 2>/dev/null || true
($GSTACK_BIN/gstack-brain-cache refresh --project "$SLUG" 2>/dev/null &) || true
```
