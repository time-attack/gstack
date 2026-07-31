# Mac mini production-faithful visible-QA eval — 2026-07-20

## Verdict

**NOT READY.** The standards-based QA skill install succeeds, and the clean
Codex CLI agent makes the correct provider and consent decisions. The first
official `browser-visible` metadata preview fails with HTTP 404, so a fresh
production user cannot install or launch the visible GStack Browser and cannot
begin browser QA.

No developer source fallback was used.

## Environment

- Device: `sina’s Mac mini`, reached over passwordless SSH on the direct local
  link.
- OS: macOS 26.5.1 (25F80).
- Candidate: GStack commit `d6ef673e` on `codex/gstack-2`, transferred as a new
  Git bundle and cloned into a new Git checkout.
- Product: a fresh copy of `/Users/sina/Downloads/roamehack/web`, including its
  current working product files but excluding `.git`, `node_modules`, `.next`,
  `.agents`, `.claude`, `.gstack`, and prior skill/runtime state.
- Eval root: `/Users/sina/gstack-production-eval.GWZpUm`.
- Isolation: new app checkout, npm cache, `HOME`, `CODEX_HOME`, and
  `GSTACK_HOME`. Only the existing Codex authentication file was copied into
  the isolated Codex home with mode `0600`.
- Browser provider: none exposed to the remote Codex CLI tool surface.
- App server: Next.js 16.2.10 on `http://127.0.0.1:3100`; HTTP 200 confirmed,
  then the server was stopped and port 3100 was verified released.

## Journey evidence

1. A clean `npm ci` installed 364 packages without reusing `node_modules`.
2. `npx skills add <candidate-clone> --list` exposed exactly six public skills:
   `debug`, `design`, `plan`, `qa`, `review`, and `ship`.
3. Explicit Codex project installation selected only `qa` and wrote exactly one
   skill at `.agents/skills/qa/SKILL.md`.
4. The installed QA dispatcher SHA-256 exactly matched the candidate source:
   `1d0d141dd0ab79144761335630784717c4d96655a276206ba466ed8077c8618d`.
5. First human-style Codex turn detected provider state `unavailable`, did not
   infer readiness from Codex/environment metadata, offered the official
   visible-browser preview, disclosed the one-request privacy boundary, and
   stopped for consent.
6. Second turn received preview-only approval and ran the canonical command:

   ```text
   node references/support/runtime-bootstrap.mjs preview --capability browser-visible
   ```

7. Exact result:

   ```text
   gstack bootstrap: Download failed with HTTP 404
   ```

   Exit code: 1.
8. The agent attempted no installation, alternate provider, `./setup`, or
   source fallback. The isolated `GSTACK_HOME` remained empty.

## Findings

### P0 — Official visible-browser preview is unavailable

The production bootstrap cannot retrieve the signed component manifest. The
fresh journey stops before component planning, exact-byte disclosure,
installation approval, doctor, readiness, or browser launch. This blocks the
requested visible QA completely.

Evidence: reproduced by both the human-style Codex turn and the direct canonical
preview; both returned HTTP 404 with exit code 1.

### P1 — Explicit selected-skill install reports `Found 111 skills`

The same candidate clone reports six skills under `--list`, then prints
`Found 111 skills` during `--skill qa --agent codex --copy --yes`. It still
installs exactly one byte-identical QA skill, but the pre-filter count contradicts
the six-skill public surface and makes the user doubt the selection boundary.

Evidence: installer output plus filesystem enumeration showing only
`.agents/skills/qa/SKILL.md`.

### P1 — Bootstrap failure lacks actionable production context

The only user-facing failure text is `Download failed with HTTP 404`. It does
not identify the requested manifest, distinguish an unpublished release from a
network problem, or state that no installation occurred. The agent supplied the
no-installation context; the bootstrap did not.

## Passed gates

- Canonical six-skill discovery.
- Exactly one QA skill installed and hash-equal to the candidate.
- No browser inferred from binaries, host name, or inherited metadata.
- Correct `unavailable` provider state.
- Correct preview/privacy consent stop.
- No silent installation, cloud/remote browser, alternate local backend,
  personal profile, `./setup`, or developer fallback.
- No runtime state after failure.
- App server teardown and port release.

## Blocked and untested

- Exact dependency-closed component list and compressed bytes.
- Separate installation-consent gate.
- Managed runtime installation and doctor.
- Visible GStack Browser launch.
- Common readiness fixture.
- Navigation, clicking, screenshots, console, network, responsive, and app-flow
  QA.
- Physical-iOS routing, which was out of scope for this Mac/web journey.

The verdict can change only after a production signed manifest and its declared
`core`, `browser-code`, and `browser-visible` artifacts are available through
the canonical bootstrap path and the same fresh-machine journey passes without
a source fallback.
