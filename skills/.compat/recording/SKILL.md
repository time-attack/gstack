---
name: recording
description: >-
  Compatibility alias for /recording. Routes to $qa --mode Report --module recording without copying specialist judgment.
metadata:
  internal: true
---

# Compatibility alias: /recording

Print this replacement invocation, then dispatch to it exactly:

`$qa --mode Report --module recording`

Do not reproduce or summarize the specialist here. The canonical dispatcher must load its preserved `recording` module. If that dispatcher is not installed, tell the user to install it with `npx skills add time-attack/gstack/skills --skill qa`.
