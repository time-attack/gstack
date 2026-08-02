# Total criteria: worked examples

Read this when a ledger fires on more than a rename. `references/VERIFICATION-CONTRACT.md`
owns the rules and carries the rename case inline; these two are the same rules at the
scales where they cost something. Rule numbers below refer to that file.

## A module port, where the inventory check and the behavior check are different checks

```text
Verification: ledger symbols.tsv, 63 exported symbols from
  `nm -gU build/libauth.dylib | c++filt | sort` at a3f21c, plus replay.tsv over
  1,204 recorded calls
  | 55 covered, 8 waived (12.7%), stub sweep 0/63 survive, vectors per member
    min 4 median 17
  | not covered: error paths, concurrency, memory, and any input absent from
    calls.jsonl
```

- Population: `nm -gU build/libauth.dylib | c++filt | sort > population.txt` at
  a3f21c, 63 lines, committed outside the mutation boundary.
- Second producer, a different mechanism than the symbol table: the linker map
  plus the public headers, `rg -o '^\w[\w ]*\b(\w+)\(' -r '$1' include/ | sort
  -u`, gives 71. Residue is 8 weak symbols, named in `waivers.tsv` with the
  user's approval quoted. The blind spot both still share: anything reached only
  through `dlsym` by a string the build never spells.
- Rung 0 row (never green alone): every symbol has a Swift counterpart,
  `comm -23 <(git show a3f21c:population.txt) <(swift symbolgraph-extract ... | sort)`
  prints nothing. A stubbed build passes this. It counts inventory.
- Rung 3 row: `swift test --filter Parity` replays the 1,204 vectors in
  `calls.jsonl` at a3f21c, writing one line per vector to `replay.tsv`. Pass
  requires 1,204 rows and zero mismatches, counted by reading `replay.tsv` after
  the run, not from the runner's summary line.
- Negative half (rule 15): `rg -c 'import LegacyAuth' -- Sources | wc -l` prints
  0, so a counterpart cannot be a shim over the module being replaced.
- Stub sweep (rule 13): every one of the 63 bodies emptied in turn, 0 rows
  survive. Six did on the first pass, all of them returning the zero value the
  corpus happened to record on the vectors chosen (`false`, `0`, `""`,
  `nil, nil`); each got a vector with a non-zero expected output before its row
  read `covered`.
- Negative control: the specimens come from
  `shuf -n5 --random-source=<(yes a3f21c) population.txt`, not from the agent.
  Emptying each body turns its rows in `replay.tsv` red by name; the symbol
  ledger stays green, which is the whole reason both exist.

## A whole-project migration, the owner's example made arithmetic

```text
Verification: ledger files.tsv (418 files), visual.tsv (366 cells),
  replay.tsv (34,902 requests), all populations generated at a3f21c before the
  first Swift file exists
  | files 418 covered / 0 waived, cells 366 covered / 0 waived, requests 34,902
    covered / 0 waived; screens 61 covered / 13 waived (17.6%, approved at the
    stop gate); stub sweep 0/418 survive
  | not covered: the 13 legacy Activity entry points, any input outside the
    14-day recording window, performance, memory, battery, offline behavior,
    VoiceOver and focus order on all 61 screens
```

Three populations, because "every line replicated" and "pixel 1:1" are total on
different axes and each is silent on the other's:

```bash
git ls-files '*.kt' | sort > population-files.txt                       # 418
rg -o 'composable\("([^"]+)"' -r '$1' | sort -u > population-screens.txt #  61
# 61 screens x 6 states (loading, empty, error, long-content, dark,
# largest Dynamic Type) = 366 cells
# requests.jsonl: production capture, 2026-07-01..07-14              # 34,902
```

- `files.tsv` is rung 0: every one of the 418 has a row naming its Swift
  counterpart or a waiver id. `diff <(sort population-files.txt) <(cut -f1 files.tsv | sort)`
  is empty. A row pointing at an empty Swift file passes, so this row carries no
  weight on its own.
- `visual.tsv` is rung 3: 366 rows, each under 0.1% differing pixels against
  `git show a3f21c:baselines/<cell>.png` with antialiasing masked. An empty
  SwiftUI view renders blank and differs 100%.
- `replay.tsv` is rung 3: all 34,902 recorded requests replayed against the
  Swift server at `git show a3f21c:requests.jsonl`, byte-equal after the
  timestamp and UUID normalizers in `normalize.ts`. Three differences are
  masked on purpose, each a waiver row carrying what it costs: pagination
  cursor format (fires on 412 of 34,902), error-code casing (1,190), ETag
  algorithm (34,902 on one header field). The last one is why the ETag axis
  reads uncovered rather than green.
- Second producer, a different mechanism than the source regex: dump the
  navigation graph from the running debug build,
  `adb shell dumpsys activity activities | rg -o 'cmp=[^ ]+' | sort -u`, 74
  against 61 screens. The 13 non-composable entry points crossed the tenth in
  rule 14, so the run stopped, and the user's "drop them, they die with the
  rewrite" is quoted with its timestamp in `waivers.tsv`. Blind spot both
  producers share: a screen reachable only from a push payload never fired
  during the capture.
- Negative half: `git ls-files '*.kt' | wc -l` prints 0 and
  `rg -l 'kotlin' Package.swift ios/ | wc -l` prints 0.
- Negative control, seeded rather than chosen:
  `shuf -n8 --random-source=<(yes a3f21c)` over each population. Emptying each
  Swift body turns its rows red by name. Two mutants target the normalizers
  themselves, a reordered map and a perturbed float, because a normalizer that
  swallows its own mutant is a weakened check under rule 3.
- Completion, per ledger: `awk -F'\t' 'NF!=3'` prints nothing, the `diff`
  against the population prints nothing, `cut -f2 | sort -u` prints only the
  three legal words, `awk -F'\t' '$2=="uncovered"' | wc -l` prints 0, `covered`
  is greater than zero, and the `waived` set equals `waivers.tsv` exactly.

What this makes visible that "migrated to Swift, tests pass" hides: 61 screens
is really 366 cells, the enumerator itself undercounted by 13 and a second
command caught it, and the pixel axis is total while the interaction axis is
empty.

