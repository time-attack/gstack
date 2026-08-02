# Total verification

Rules 10 through 15 of the verification contract, binding whenever the work has
an enumerable population and a per-member check a stub fails. Read
`references/VERIFICATION-CONTRACT.md` first; rules 1 through 9 still apply.

### Totality: quantify over the population, do not sample it

Rules 1 through 9 constrain what the check asserts. They say nothing about how
much of the work it touches. "The login test passes" names an input, an
observable, and a threshold on a forty-file diff and satisfies all nine.

10. **Name the population and count it with one command.** The population is the
    set of things "every" ranges over, and it is always a plural noun: files,
    exported symbols, call sites, screens, routes, rows, cells. Produce its
    members with one command, redirect that command to a file, and commit the
    file before the first edit. The header carries the file, the command, the
    commit, and the literal count. The command and its exclusions are part of
    the check (rule 3): widening an exclusion to shrink the count is
    re-thresholding, and a producer authored narrow in the first place is
    re-thresholding done early. When the request states or implies a magnitude,
    the header reconciles: `<N> members from <command>; request implied <M>;
    delta <M-N>: <one named reason per missing member>`. An unexplained delta is
    a STOP gate, not a footnote. If no command can produce the members, the
    request is not total in this repository. Write `sampled: <N> of <universe>`,
    name the universe, and do not write "every". That downgrade is demonstrated,
    never asserted: show the producer you ran and the construct that defeated it.
    Wherever the language has runtime introspection a fallback producer always
    exists (`inspect.getmembers` on the imported module, the route table, the
    running app's accessibility dump), so the downgrade is unavailable there.
    "The rest are similar" is not a count.
11. **Prove the inventory with a second producer of a different mechanism.**
    One command sees only what its globs let it see. The second
    producer differs in kind, not in filter width: a different layer (runtime
    import, AST, compiler, linker, the running app's accessibility dump, the
    route registry) and no path filter. The same tool with looser flags is the
    same blind spot twice, and if both producers would miss a member for the same
    reason the second one does not count. Print both commands verbatim, subtract
    the two lists, and print the residue as a number even when it is zero, next
    to one sentence naming the blind spot the two share. Either the residue is
    empty or every member of it is named, then added to the population or waived
    under rule 14. This one extra line is what catches the directory the glob
    never entered and the route that quietly lost its guard. A population born
    too small passes every later check.
12. **One row per member, three states, no fourth.** The run writes a ledger,
    one line per member: `<member> <TAB> covered|waived|uncovered <TAB>
    <evidence or waiver id>`. Completion is arithmetic, not prose. All five hold
    or the work is not complete. Anchor on the field, never on the whitespace
    around it: a row that lost its third column is a failed run, not a silent
    pass.
    - `awk -F'\t' 'NF!=3' ledger.tsv` prints nothing.
    - `diff <(sort population.txt) <(cut -f1 ledger.tsv | sort)` prints nothing.
    - `cut -f2 ledger.tsv | sort -u` prints only `covered`, `waived`,
      `uncovered`.
    - `awk -F'\t' '$2=="uncovered"' ledger.tsv | wc -l` prints 0.
    - `cut -f2 ledger.tsv | sort | uniq -c` goes in the exit report, and its
      `waived` set equals the approved waiver file exactly:
      `diff <(awk -F'\t' '$2=="waived"{print $1}' ledger.tsv | sort)
      <(cut -f1 waivers.tsv | sort)` prints nothing.

    The distribution is read, not just the vocabulary. `covered` counts more than
    zero: a ledger where every row is `waived` satisfies a whitelist and is a
    cancelled run wearing a complete one's arithmetic. The vocabulary is closed. `deferred`, `skipped`, `partial`, `pending`,
    `n/a`, and `not applicable` are not states; each is `uncovered` wearing a
    better word. A run that produced fewer rows than the population contains is
    a failed run, not a partial pass. The verdict is read from the ledger file
    after the run, never from a summary the run printed.
13. **`covered` means a check an empty implementation fails.** A stub is not a
    syntax. `throw NotImplemented` and an empty body are the same thing: a member
    whose body was never written, which still returns its language's zero value,
    and zero values are real outputs. `false` from a predicate, `0` from a
    counter, `""` from a formatter, `nil, nil` from a Go parser: that is exactly
    what a corpus recorded on typical inputs holds, so six empty Go functions
    replay a recorded corpus 6/6 green. The operational definition is the one
    that survives: a row is a stub row if it stays green when the implementation
    body is deleted. The ladder:

    | Rung | The row asserts | A stub scores |
    |---|---|---|
    | 0 | it exists in the new tree | pass |
    | 1 | it compiles or type-checks | pass |
    | 2 | it runs without throwing, or renders with the right label | pass |
    | 3 | it reproduces a recorded non-zero-value output, or round-trips the real user path | fail |

    Rung 3 is the floor for `covered`, and it has three conditions. At least one
    vector per member expects a value that is not the target language's zero
    value. For anything a user operates, the round trip is the whole path: drive
    the control, observe the persisted value change, restart the process, observe
    it restored. Reading the rendered tree, or asserting the store's schema holds
    the key, is rung 2 and is never green alone. And the relation is not
    self-authored into vacuity: state it before the run, in the check artifact.
    Do not claim the stub score, run it. Stub every member in turn and publish the
    sweep as a header field, `stub sweep: 6 of 40 rows survive stubbing`; sample
    it with `shuf --random-source` seeded by the population sha when the full
    sweep is too expensive, never by a member the agent picked. Every row a stub
    satisfies is `uncovered`, whatever it was labelled: that is the row's real
    rung, discovered instead of declared. Evidence carries its vector count, and
    the header prints vectors per member as min and median, never the bare total.
    Rows at rungs 0 through 2 are legal to write and are never green on their
    own: they ship alongside a rung 3 ledger over the same population. A total
    inventory of stub-passing rows is worse than an honest sample, because it
    launders "418 members accounted for" as completion.
14. **A waiver is one member, one reason, approved by the user before the run.**
    Waivers live in their own committed file, one line per member, and a row is
    `waived` only when its member is already in that file. The agent's own
    pre-run commit is not approval: the file quotes the user's approval verbatim
    with its timestamp, or the run stops on the proposed waiver list and asks.
    The agent does not add one mid-run either: dropping a member is a scope
    change the user approves, not a verdict the run reaches. The count and the
    rate go in the header beside the population count, so the drop is visible
    without opening the ledger, and past a tenth of the population waiving is
    itself the scope change: stop and re-open scope rather than proceed. A reason
    is a property of the member's testability. "Already untested" is not one, it
    is the thing being measured; neither are "internal", "deprecated", "covered
    transitively", or "not part of the surface", which are claims about
    importance. A reason resting on an artifact the repository does not hold (a
    mockup, a ticket, a conversation) leaves the row `uncovered` until that
    artifact is committed and the waiver cites its region. Read every check
    artifact as `git show <sha>:<path>`, never `cat <path>`: population, waivers,
    recorded corpus, goldens, normalizers, thresholds, and the runner. The exit
    report prints `git show <sha>:<path> | sha256sum` beside the working tree's
    hash for each, and a mismatch on any of them voids the claim. A baseline the
    working tree can produce is not a baseline.
15. **Enumerate the negative half, and show the check going red once.**
    Replacement work owes a second total: zero references remain to the thing
    being replaced, counted by command. Without it every row can reach `covered`
    through a shim that calls the code being replaced. Then run a negative
    control, and do not pick its specimen: break the members `shuf
    --random-source` selects under the population sha, or the ones the user
    names, and break the implementation body rather than the test. Report each
    member and whether the run went red naming it. One honest red run over the
    single richly-behaved symbol vouches for nothing. Where a normalizer or a
    tolerance sits in the path, one mutant is one it would plausibly mask:
    perturb a float, reorder a map, change an error string. A normalizer that
    swallows its own targeted mutant is a weakened check under rule 3. A check
    never observed red is not known to be capable of red, and those runs are the
    only defense that generalizes across golden files, pixel thresholds,
    normalizers, and property generators.

### When a ledger is the wrong answer

Demand one when both hold: a command can list the members before the first edit,
and a per-member check exists that a stub fails. Missing either, the ledger
produces a fake number, and a fake number is worse than an honest sample. Four
places it is wrong:

- Rule 6 territory. Goal selection, one-way doors, taste, underspecified
  requests. No plural noun exists for "every" to range over. `none` answers it.
- Absence properties (rule 7). The population is unbounded, so the honest output
  is a coverage boundary, not a count.
- A new feature with no old system. Nothing to diff against. Enumerate the
  configuration space, label it `sampled`, and count the uncovered axes.
- Work the user sampled on purpose: a spike, a probe, a deliberately partial
  migration. The user already chose the sample.

A rename is not on that list. Totality costs one `rg -l` and a number there, and
skipping it is how the six sibling call sites stay broken. Neither is a
redesign, which is the next section.

### Populations for a redesign

A redesign is not an exemption from rule 10, it is a change of population.
Pixels are out: regenerating a pixel baseline to match the new design violates
rule 3, and blocking on 1:1 pixels blocks the work. 1:1 is right for a port or a
reskin. Semantics are in, and they take a header value like any other ledger:

```text
Verification: ledger controls.tsv, 40 controls from
  `<accessibility dump of the pre-change build> | sort` at <sha>
  | 34 covered, 6 waived (15%), stub sweep 0/40 survive, vectors min 2 median 3
  | not covered: <axes>
```

The population is dumped from the PRE-change build at the baseline sha, before
the first edit, by the same command that regenerates it afterward. "Every
control still in the tree" is a population defined by the agent's own output:
whatever the redesign deletes leaves the denominator instead of registering as
loss. A control in the baseline dump and absent afterward is `uncovered` until
waived under rule 14, so
`comm -23 <(git show <sha>:population.txt) <(post-change dump)` prints nothing.
A deleted control is a finding. Twelve of them is a product decision the user
makes, not a verdict the run reaches.

## What a real check buys

When the check already exists and this run may not edit it, the plan is the
check plus the edit list, and the oracle-backed entry to the trivial-change fast
path applies: skip the pre-mortem, the coverage diagram, the failure-modes
table, and the scores, and name the skips in one line. A committed population
with a rung 3 predicate is the strongest form of that entry, not a new gate.
Telling a modern model how to write the migration adds nothing. Telling it what
will fail if the migration is wrong is the plan.

Suppression never skips a STOP gate, an approval boundary, or the mutation
boundary. Those are consent, not ceremony.

The check is not a formality that follows the work; it is the thing the work
optimizes. Eighteen agent runs porting a React Fluent-UI data table to Angular
under a hidden 222-test Playwright oracle reached near-perfect scores while the
requested reusable library was left dead or absent, because that requirement
lived in the prose and not in the oracle
([arXiv 2606.28430](https://arxiv.org/abs/2606.28430)). On SWE-bench,
strengthening insufficient tests on 36 task instances exposed 345 patches
recorded as passing, correcting 40.9% of SWE-Bench Lite and 24.4% of SWE-Bench
Verified leaderboard entries ([arXiv 2506.09289](https://arxiv.org/abs/2506.09289)).
And the hole widens with the work: the gap between visible and held-out suites
grows 28 percentage points for every tenfold increase in code size
([arXiv 2605.21384](https://arxiv.org/abs/2605.21384)). A check that samples gets
a codebase that satisfies the sample. Note what the ledger does not buy: a total
check is a more attractive optimization target than a weak one, so whatever gets
hollowed out still gets hollowed out. What changes is that it is countable
afterward, in the uncovered line, as a number.

## Examples

### A rename, where totality costs one command

```text
Verification: ledger callsites.tsv, 49 call sites of `resolveHost` from
  `rg -l '\bresolveHost\b' -- src test | sort` at 9c1e40, plus the 2 alias sites
  the type checker added
  | 49 covered, 0 waived (0%), stub sweep 0/49 survive, 1 vector per member
  | not covered: string literals, comments, and dynamic access `obj[name]`,
  which neither producer sees
```

- Population, before the first edit:
  `rg -l '\bresolveHost\b' -- src test | sort > population.txt` at 9c1e40,
  47 lines, plus the 2 the second producer added below, committed at 49.
- Second producer (rule 11), a different mechanism rather than a looser glob:
  rename the declaration on a scratch branch and let the type checker enumerate
  the breaks, `bun run tsc --noEmit | rg -o '^[^(]+' | sort -u`, which gives 49.
  Residue is 2, both reaching the symbol under a local alias through
  `export * from`, which the regex could never see. Both go into the population.
  The blind spot the two producers still share: neither resolves `obj[name]`.
- `covered` at rung 3 (rule 13): `bun run tsc --noEmit` exits 0 and
  `rg -c '\bresolveHost\b' -- src test | wc -l` prints 0. A file the rename
  missed fails the type check, so a stub cannot pass this row.
- Negative control (rule 15): three files picked by
  `shuf -n3 --random-source=<(yes 9c1e40) population.txt`, reverted one at a
  time; `bun run tsc --noEmit` exits 1 naming each.
- Completion: `diff <(sort population.txt) <(cut -f1 callsites.tsv | sort)` is
  empty, `awk -F'\t' 'NF!=3' callsites.tsv` prints nothing, and
  `awk -F'\t' '$2=="uncovered"' callsites.tsv | wc -l` prints 0.

The plan that says "renamed it, tests pass" is not shorter. It is quieter about
the six call sites it missed.

### Larger scales

When the ledger fires on more than a rename, read
`references/TOTAL-CRITERIA-EXAMPLES.md`. It works two cases end to end with the
exact commands: a module port, where the inventory check and the behavior check
have to be different checks, and a whole-project migration to Swift, where three
populations (418 files, 366 screen cells, 34,902 recorded requests) are total on
three different axes and each is silent on the other two.

### The two values that are not ledgers

```text
Verification: sampled 12 of ~200 report templates | render each and diff against
  its committed golden file | not covered: the other ~188, which no command can
  enumerate because the set is user-authored at runtime
```

```text
Verification: none (the plan selects what to build; no check inside this session
  separates a product users want from one they do not). Demand evidence and
  premise challenge stay on.
```
