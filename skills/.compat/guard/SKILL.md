---
name: guard
description: >-
  Compatibility alias for the retired /guard command. Routes to $debug --mode Diagnose-only with the careful and freeze modules both active, without copying specialist judgment.
metadata:
  internal: true
---

# Compatibility alias: /guard

Print this replacement invocation, then dispatch to it exactly:

`$debug --mode Diagnose-only --module careful` plus `--module freeze` in the same run (both protections active)

Do not reproduce or summarize the retired specialist here. The canonical dispatcher must load its preserved `careful` and `freeze` modules. If that dispatcher is not installed, tell the user to install it with `npx skills add time-attack/gstack/skills --skill debug`.
