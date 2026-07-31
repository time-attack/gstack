# Live run records

Live one-shot JSON evidence is written here. No successful live run has been recorded merely because this directory exists; consult each file's top-level `status`, `harness_version`, fixture manifest hash, and `claim`.

`2026-07-17T03-26-33-114Z-22457bba.json` is the immutable failed v1 slash-invocation result. Its SHA-256 is `aa40a533a9677cf79ccb85b84297177a58296eee6c66cc9977493138435eb391`. It must remain unfavorable evidence and must not be automatically rerun or relabeled after v2 harness fixes.

`2026-07-17T04-09-01-809Z-3d23a270.json` is the immutable failed v2 `$skill` result. Its SHA-256 is `7ab15ea575cb9a634b7d00212dd9d74902b1188281ae6a503a32ccf382facbf5`. All dispatchers activated and QA passed, but the other three fixtures were rejected by the v2 classifier's read-only-Git sandbox-warning defect. It must not be rerun or relabeled after the v3 classifier fix.

Three live v3 one-shots are recorded here; each is immutable:

- `2026-07-17T19-48-45Z-v3-live-gpt-5-4.json` — **failed 3/4** (Codex CLI
  0.144.5; review flagged for compound read-only inspection). SHA-256
  `fcffdf2b0ee7bb9ac1351e246546af2cd352779bda7b1f8dc4a08f51fc66ef2f`.
- `2026-07-22T20-57-26-117Z-b39a6a57.json` — **failed 3/4** (Codex CLI
  0.145.0; ship flagged when `git symbolic-ref --short HEAD` met the
  sandbox cache-write warning under the pre-fix classifier). SHA-256
  `2e88a81a851efeb378a72a1c7e4039eaa435fc30a3b2d2416f3f0b6b3327998b`.
- `2026-07-22T21-33-20-053Z-84fcb74b.json` — **passed 4/4 one-shot**
  (`retry_count` 0, Codex CLI 0.145.0, `gpt-5.4`) after the gate-classifier
  fix for chained pure read-only Git inspection. SHA-256
  `304c2797b145ac837c102cd93244548ee9b243edd81d3567f3319635442b006a`.

`2026-07-21-v4-live-gpt-5-6-sol.json` is an immutable harness-4 live one-shot
on `gpt-5.6-sol` (Codex CLI 0.144.4, `retry_count` 0) — **failed 3/4**: debug,
qa, and review passed; the ship fixture was flagged for one forbidden command
attempt (the session ran `npm run check` during the report-only readiness
assessment). SHA-256
`d0e5a305384186314db781342937575859d48b678fc2ae506d174e2f620f29e9`. It is
retained unfavorable evidence: the 2026-07-22 `gpt-5.4` pass is a
different-model one-shot and does not supersede or relabel it.

The failed one-shots stay failed; the pass is a separate new one-shot under
the fixed classifier, never a retry or relabeling of a failed run. The
offline harness suite (now harness 4) is green at 32 pass / 0 fail and 183
assertions; that unit evidence does not belong in `runs/` and does not
upgrade any failed result.

Harness-4 single-fixture host UI-launch cells (2026-07-28, all retained;
single-fixture cells are top-level `incomplete` by construction and are
never adversarial-parity evidence):

- `2026-07-28-uilaunch-claude.json` — **failed** (consolidated-final-message
  parser defect; harness fixed afterward). SHA-256
  `1c82f3c2fa2a317fbd492e577c17b42207220a0cf9c3532a72541e854fa57d17`.
- `2026-07-28-uilaunch-claude-2.json` — **fixture passed 13/13**, suite
  `incomplete` (subset). Claude Code 2.1.220, `claude-fable-5`. SHA-256
  `18165c6ebb01ce545e290fe032925b374e6dd861874006105b345906baa0b6fd`.
- `2026-07-28-uilaunch-cursor.json` — **failed** (plan-mode final-message
  conflict plus `createPlanToolCall` misclassification; harness fixed
  afterward). SHA-256
  `da710ac77f276bea7b09ebc9498a55468f162aac922333d92f3f298d70787541`.
- `2026-07-28-uilaunch-cursor-2.json` — **fixture passed 13/13**, suite
  `incomplete` (subset). Cursor 2026.07.23-e383d2b, `composer-2.5`. SHA-256
  `5c06d15f49aec0ffa0fac550af9ba7c3c92aacd83fafdb888ad6fefcbfa3bef3`.
- `2026-07-28-uilaunch-pi.json` — **failed**: activation and safe
  report-only behavior with correct structured output, but only 2/5
  required reads. Genuine host+model compliance gap (pi 0.80.9,
  `gemini-2.5-pro`); retained as-is. SHA-256
  `04c9d9bc9cb70ef2c841de2e075fb130e8f7d4b333eb47bb7f3a0cc94b3e3b74`.
