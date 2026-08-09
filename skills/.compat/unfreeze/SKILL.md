---
name: unfreeze
description: >-
  Compatibility alias for the retired /unfreeze command. Routes to $debug --mode Diagnose-only --module investigate, whose Scope Lock section owns clearing the edit boundary, without copying specialist judgment.
metadata:
  internal: true
---

# Compatibility alias: /unfreeze

Print this replacement invocation, then dispatch to it exactly:

`$debug --mode Diagnose-only --module investigate` (the Scope Lock section owns clearing the boundary; clear it, do not start a new investigation)

Do not reproduce or summarize the retired specialist here. The canonical dispatcher must load its preserved `investigate` module. If that dispatcher is not installed, tell the user to install it with `npx skills add time-attack/gstack/skills --skill debug`.
