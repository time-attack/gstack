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

The failed one-shots stay failed; the pass is a separate new one-shot under
the fixed classifier, never a retry or relabeling of a failed run. The v3
offline harness is green at 21 pass / 0 fail and 135 assertions; that unit
evidence does not belong in `runs/` and does not upgrade any failed result.
