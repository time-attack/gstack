---
name: alpha
description: Fixture dispatcher with a mode table and forced-read references.
triggers: dead-key-the-router-never-reads
---

# Alpha

## Dispatch protocol

1. Infer the mode from the request.
2. Read `references/CORE.md` and `references/POLICY.md` for every invocation. Read `references/OPTIONAL.md` before public-web work.

## Top-level modes

| Mode | Infer when | Candidate internal specialists |
|---|---|---|
| `Discovery` | The idea is fluid. | `references/legacy/office.md` |
| `Full chain` | Everything at once. | `references/legacy/auto.md` |

## Internal specialist routing aliases

| Legacy invocation | Public mode | Module |
|---|---|---|
| `/office-hours` | `Discovery` | `references/legacy/office.md` |
