/**
 * Static tripwires for the /plan verification contract (thesis: name the check,
 * skip the scaffolding). Free, file IO only.
 *
 * Pins three things a future edit could silently undo:
 *   1. The contract exists and the dispatcher actually routes to it.
 *   2. The anti-gaming clauses survive (author the check first; weakening,
 *      deleting, or regenerating it to pass is a violation; unrun is unverified)
 *      both in the /plan reference and in the SHARED-JUDGMENT rule mirrored to
 *      all five dispatchers.
 *   3. It added no seventh top-level /plan mode and touched no legacy module.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const DISPATCHERS = ['plan', 'qa', 'debug', 'review', 'ship'] as const;
const CONTRACT = path.join(ROOT, 'skills', 'plan', 'references', 'VERIFICATION-CONTRACT.md');
const TOTALITY = path.join(ROOT, 'skills', 'plan', 'references', 'TOTAL-VERIFICATION.md');
const PLAN_SKILL = path.join(ROOT, 'skills', 'plan', 'SKILL.md');

// The contract is split so only rules 1-9 are read before every header; the
// totality machinery (rules 10-15) is read when a total check is authored.
// Assert against the surface the agent ends up with, not one file's slice.
const contract = [CONTRACT, TOTALITY].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
// Prose is hard-wrapped; match against a single-line view so wrapping is not load-bearing.
const flat = contract.replace(/\s+/g, ' ');
const planSkill = fs.readFileSync(PLAN_SKILL, 'utf8');

describe('verification contract: presence and wiring', () => {
  test('the contract reference exists outside references/legacy/', () => {
    for (const f of [CONTRACT, TOTALITY]) {
      expect(fs.existsSync(f)).toBe(true);
      expect(f).not.toContain(`${path.sep}legacy${path.sep}`);
    }
  });

  test('the /plan dispatch protocol routes to it', () => {
    expect(planSkill).toContain('references/VERIFICATION-CONTRACT.md');
    // Totality is conditional, so the dispatcher must state the condition
    // rather than fold it into the before-header read.
    expect(planSkill).toContain('references/TOTAL-VERIFICATION.md');
    expect(planSkill).toMatch(/before authoring a total check/i);
    // ...and the small file must point at it, so a plan that only reads the
    // before-header file still learns the totality rules are binding.
    expect(fs.readFileSync(CONTRACT, 'utf8')).toContain('references/TOTAL-VERIFICATION.md');
  });

  test('the execution header carries a Verification line after Mutation', () => {
    const mutation = planSkill.indexOf('Mutation: <');
    const verification = planSkill.indexOf('Verification: <');
    const active = planSkill.indexOf('Active modules: <');
    expect(mutation).toBeGreaterThan(-1);
    expect(verification).toBeGreaterThan(mutation);
    expect(active).toBeGreaterThan(verification);
  });

  test('`none` stays a legal header value so the line is not answered by bluffing', () => {
    expect(contract).toContain('`none`');
    // The header offers it; the treatment of when `none` is correct lives in
    // whichever reference the dispatcher routes to, so assert the surface the
    // agent actually reads rather than one file's current wording.
    expect(planSkill).toContain('`none (reason)`');
    const planSurface = fs
      .readdirSync(path.join(ROOT, 'skills', 'plan', 'references'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => fs.readFileSync(path.join(ROOT, 'skills', 'plan', 'references', f), 'utf8'))
      .join('\n');
    expect(`${planSkill}\n${planSurface}`).toContain('`Verification: none`');
  });
});

describe('verification contract: falsifiable and anti-gameable', () => {
  test('the check must be authored before the work starts', () => {
    expect(flat).toMatch(/author the check before the work/i);
    expect(flat).toMatch(/before the first edit/i);
  });

  test('weakening, deleting, or regenerating the check to pass is a violation', () => {
    const clause = flat.match(/Weakening, deleting, regenerating[^.]*\./i)?.[0] ?? '';
    for (const move of ['deleting', 'regenerating', 're-thresholding', 'narrowing', 'skipping']) {
      expect(clause.toLowerCase()).toContain(move);
    }
    expect(clause).toMatch(/contract violation/i);
  });

  test('the check lives outside the mutation boundary and unrun is unverified', () => {
    expect(flat).toMatch(/outside the mutation boundary/i);
    expect(flat).toMatch(/unrun is unverified/i);
    expect(flat).toMatch(/exit code/i);
  });

  test('a check that cannot name input, observable, and threshold is rejected', () => {
    expect(flat).toMatch(/an input, an observable, and a threshold/i);
    expect(flat).toMatch(/"no regressions"/i);
    expect(flat).toMatch(/if no state of the world fails the check/i);
  });

  test('the uncovered axis is named, so a green check cannot stand in for the rest', () => {
    expect(contract).toMatch(/not covered:/);
    expect(flat).toMatch(/does not cover/i);
  });
});

describe('verification contract: total over the work surface', () => {
  const EXAMPLES = path.join(ROOT, 'skills', 'plan', 'references', 'TOTAL-CRITERIA-EXAMPLES.md');
  const examples = fs.readFileSync(EXAMPLES, 'utf8');

  test('the original nine rules survive the renumber and the file numbers 1..15 in order', () => {
    const leads = [...contract.matchAll(/^(\d+)\. \*\*(.+?)\*\*/gm)];
    expect(leads.map((m) => Number(m[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    // Rule 2 is the anti-vacuous-check rule; it must not have been renumbered away.
    expect(leads[1][2]).toBe('Name an input, an observable, and a threshold.');
  });

  test('the population is named, produced by a command, and committed before the first edit', () => {
    expect(flat).toMatch(/name the population and count it with one command/i);
    expect(flat).toMatch(/commit the file before the first edit/i);
    expect(flat).toMatch(/widening an exclusion to shrink the count is re-thresholding/i);
    expect(flat).toMatch(/"the rest are similar" is not a count/i);
  });

  test('the inventory is proved complete by a second producer of a different mechanism', () => {
    expect(flat).toMatch(/second producer of a different mechanism/i);
    expect(flat).toMatch(/differs in kind, not in filter width/i);
    expect(flat).toMatch(/the same tool with looser flags is the same blind spot twice/i);
    expect(flat).toMatch(/if both producers would miss a member for the same\s+reason the second one does not count/i);
    expect(flat).toMatch(/print the residue as a number even when it is zero/i);
    expect(flat).toMatch(/naming the blind spot the two share/i);
    expect(flat).toMatch(/subtract the two lists/i);
    expect(flat).toMatch(/either the residue is empty or every member of it is named/i);
    expect(flat).toMatch(/a population born too small passes every later check/i);
  });

  test('completion is arithmetic over every member, not prose', () => {
    expect(contract).toContain('diff <(sort population.txt) <(cut -f1 ledger.tsv | sort)');
    expect(flat).toMatch(/completion is arithmetic, not prose/i);
    expect(flat).toMatch(/fewer rows than the population contains is a failed run/i);
    expect(flat).toMatch(/never from a summary the run printed/i);
  });

  test('the ledger vocabulary is closed at three states and `uncovered` blocks completion', () => {
    expect(flat).toMatch(/one row per member, three states, no fourth/i);
    // Field-anchored, not whitespace-anchored: `grep -cP '\tuncovered\t'` misses
    // a row whose third column is empty, so five invariants replace three.
    expect(contract).toContain(`awk -F'\\t' '$2=="uncovered"' ledger.tsv | wc -l`);
    expect(contract).toContain(`awk -F'\\t' 'NF!=3' ledger.tsv`);
    expect(contract).not.toContain("grep -cP '\\tuncovered\\t' ledger.tsv");
    const closed = flat.match(/The vocabulary is closed\.[^;]*;/i)?.[0] ?? '';
    for (const dodge of ['deferred', 'skipped', 'partial', 'pending', 'n/a', 'not applicable']) {
      expect(closed).toContain(dodge);
    }
    expect(closed).toMatch(/are not states/i);
  });

  test('`covered` requires a predicate a stub fails, with rung 3 as the floor', () => {
    expect(flat).toMatch(/`covered` means a check an empty implementation fails/i);
    expect(flat).toMatch(/throw NotImplemented/);
    expect(flat).toMatch(/rung 3 is the floor for `covered`/i);
    expect(flat).toMatch(/never green on their own/i);
    // The whole point: a total inventory of stub-passing rows must not read as done.
    expect(flat).toMatch(/worse than an honest sample/i);
  });

  test('a waiver is per-member, pre-approved, and read from the baseline commit', () => {
    expect(flat).toMatch(/a waiver is one member, one reason, approved by the user before the run/i);
    expect(flat).toMatch(/the agent does not add one mid-run/i);
    expect(flat).toMatch(/"already untested" is not one, it is the thing\s+being measured/i);
    expect(contract).toContain('`git show <sha>:<path>`, never `cat <path>`');
  });

  test('the negative half and one observed red run are both required', () => {
    expect(flat).toMatch(/zero references remain to the thing\s+being replaced/i);
    expect(flat).toMatch(/shim that calls the code being replaced/i);
    expect(flat).toMatch(/negative\s+control/i);
    expect(flat).toMatch(/never observed red is not known to be capable of\s+red/i);
  });

  test('`sampled` stays the sanctioned escape hatch, so "every" is not simply avoided', () => {
    expect(contract).toContain('Verification: sampled <N> of <universe>');
    expect(contract).toContain('`sampled: <N> of <universe>`');
    expect(flat).toMatch(/do not write "every"/i);
  });

  test('the contract names where a ledger is the wrong answer, and excludes renames from it', () => {
    expect(flat).toMatch(/when a ledger is the wrong answer/i);
    expect(flat).toMatch(/a fake number is worse than an honest sample/i);
    expect(flat).toMatch(/a rename is not on that list/i);
  });

  test('worked examples span a rename through a whole-project migration, each with its deciding command', () => {
    expect(contract).toContain('references/TOTAL-CRITERIA-EXAMPLES.md');
    expect(flat).toMatch(/a rename, where totality costs one command/i);
    expect(contract).toContain("rg -l '\\bresolveHost\\b' -- src test | sort");
    expect(examples).toMatch(/## A module port/i);
    expect(examples).toMatch(/## A whole-project migration/i);
    expect(examples).toContain('nm -gU build/libauth.dylib');
    expect(examples).toContain("git ls-files '*.kt' | sort");
    expect(EXAMPLES).not.toContain(`${path.sep}legacy${path.sep}`);
  });

  test('the evidence is cited with URLs and the unverified figure stays out', () => {
    for (const id of ['2606.28430', '2506.09289', '2605.21384']) {
      expect(contract).toContain(`https://arxiv.org/abs/${id}`);
    }
    // Verified against the abstract 2026-08-02: this figure is not in UTBoost.
    expect(flat).not.toMatch(/27-36 percentage/i);
  });
});

describe('verification contract: the holes a red team walked through', () => {
  test('totality is a property of the deliverable, not a keyword in the prompt', () => {
    expect(flat).toMatch(/totality is a property of the deliverable, not a word in the prompt/i);
    expect(flat).toMatch(/ask what\s+plural noun the work ranges over/i);
    expect(flat).toMatch(/examples of the trigger, not the test/i);
    expect(flat).toMatch(/restating the request over a smaller population than the\s+user posed is a scope change/i);
  });

  test('the count reconciles with the magnitude the request implies', () => {
    expect(flat).toMatch(/request implied <M>/);
    expect(flat).toMatch(/an unexplained delta is\s+a STOP gate/i);
    expect(flat).toMatch(/a producer authored narrow in the first place is\s+re-thresholding done early/i);
  });

  test('the downgrade out of totality is demonstrated, not asserted', () => {
    expect(flat).toMatch(/that downgrade is demonstrated,\s+never asserted/i);
    expect(flat).toMatch(/show the producer you ran and the construct that defeated it/i);
    expect(flat).toMatch(/runtime introspection a fallback producer always\s+exists/i);
  });

  test('a stub is defined by what it returns, and the sweep is run rather than claimed', () => {
    expect(flat).toMatch(/a stub is not a\s+syntax/i);
    expect(flat).toMatch(/still returns its language's zero value/i);
    expect(flat).toMatch(/a row is a stub row if it stays green when the implementation\s+body is deleted/i);
    expect(flat).toMatch(/at least one\s+vector per member expects a value that is not the target language's zero\s+value/i);
    expect(flat).toMatch(/do not claim the stub score, run it/i);
    expect(flat).toMatch(/stub sweep: 6 of 40 rows survive stubbing/i);
    expect(flat).toMatch(/every row a stub\s+satisfies is `uncovered`/i);
    // Interactive surfaces: a rendered label is not a round trip.
    expect(flat).toMatch(/drive\s+the control, observe the persisted value change, restart the process, observe\s+it restored/i);
    expect(flat).toMatch(/is rung 2 and is never green alone/i);
  });

  test('per-member evidence has a floor, so 1,204 vectors cannot sit on three symbols', () => {
    expect(flat).toMatch(/evidence carries its vector count/i);
    expect(flat).toMatch(/vectors per member as min and median, never the bare total/i);
    expect(contract).toContain('vectors per member min <a> median <b>');
    expect(flat).toMatch(/an axis a cheap check could have covered is work still\s+owed/i);
  });

  test('neither the mutant nor the negative control is agent-selected', () => {
    expect(flat).toMatch(/do not pick its specimen/i);
    expect(flat).toMatch(/shuf\s+--random-source` selects under the population sha/i);
    expect(flat).toMatch(/break the implementation body rather than the test/i);
    expect(flat).toMatch(/one honest red run over the\s+single richly-behaved symbol vouches for nothing/i);
  });

  test('authoring a normalizer counts as touching the check, and one mutant targets it', () => {
    expect(flat).toMatch(/authoring\s+a new comparator, normalizer, or tolerance is the same act as loosening an old\s+one/i);
    expect(flat).toMatch(/carries the\s+count of vectors it fires on/i);
    expect(flat).toMatch(/a normalizer that\s+swallows its own targeted mutant is a weakened check under rule 3/i);
  });

  test('waivers need user consent, a visible rate, a cap, and a committed justification', () => {
    expect(flat).toMatch(/the agent's own\s+pre-run commit is not approval/i);
    expect(flat).toMatch(/quotes the user's approval verbatim\s+with its timestamp/i);
    expect(flat).toMatch(/the count and the\s+rate go in the header/i);
    expect(flat).toMatch(/past a tenth of the population waiving is\s+itself the scope change/i);
    for (const dodge of ['internal', 'deprecated', 'covered\n    transitively', 'not part of the surface']) {
      expect(contract).toContain(dodge);
    }
    expect(flat).toMatch(/an artifact the repository does not hold \(a\s+mockup, a ticket, a conversation\) leaves the row `uncovered`/i);
  });

  test('the read discipline and the hash check cover every check artifact, not just two', () => {
    const clause = flat.match(/Read every check\s*artifact[^.]*\./i)?.[0] ?? '';
    for (const artifact of ['population', 'waivers', 'corpus', 'goldens', 'normalizers', 'thresholds', 'runner']) {
      expect(clause).toContain(artifact);
    }
    expect(flat).toMatch(/git show <sha>:<path> \| sha256sum` beside the working tree's\s+hash/i);
    expect(flat).toMatch(/a mismatch on any of them voids the claim/i);
  });

  test('the ledger arithmetic reads the distribution, so an all-waived run is not complete', () => {
    expect(flat).toMatch(/all five hold\s+or the work is not complete/i);
    expect(contract).toContain('cut -f2 ledger.tsv | sort | uniq -c');
    expect(flat).toMatch(/`covered` counts more than\s+zero/i);
    expect(flat).toMatch(/a ledger where every row is `waived`[^.]*is a\s+cancelled run/i);
    expect(contract).toContain(`awk -F'\\t' '$2=="waived"{print $1}' ledger.tsv | sort`);
  });

  test('a redesign gets a ledger over a pre-change population, not an exemption', () => {
    expect(flat).toMatch(/### Populations for a redesign/);
    expect(flat).toMatch(/a redesign is not an exemption from rule 10, it is a change of population/i);
    expect(flat).toMatch(/four\s+places it is wrong/i);
    expect(contract).toContain('Verification: ledger controls.tsv');
    expect(flat).toMatch(/dumped from the PRE-change build at the baseline sha/i);
    expect(flat).toMatch(/a population defined by the agent's own output/i);
    expect(contract).toContain('comm -23 <(git show <sha>:population.txt) <(post-change dump)');
    expect(flat).toMatch(/a deleted control is a finding/i);
    // The old bullet licensed skipping the ledger form entirely.
    expect(flat).not.toMatch(/For a redesign the total population is semantic/i);
  });

  test("the ledger invariants actually catch what they claim (they are run, not quoted)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-'));
    const ledger = path.join(dir, 'ledger.tsv');
    // Row 2 is genuinely uncovered but has no third column: the old
    // `grep -cP '\tuncovered\t'` scored this file 0.
    fs.writeFileSync(ledger, 'alpha\tcovered\treplay:12\nbeta\tuncovered\n');
    const sh = (cmd: string) =>
      spawnSync('bash', ['-c', cmd], { cwd: dir, encoding: 'utf8' }).stdout.trim();
    expect(sh(`grep -c $'\\tuncovered\\t' ledger.tsv || true`)).toBe('0');
    expect(sh(`awk -F'\\t' 'NF!=3' ledger.tsv`)).not.toBe('');
    expect(sh(`awk -F'\\t' '$2=="uncovered"' ledger.tsv | wc -l`).trim()).toBe('1');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('verification contract: the shared claim limit reaches all five dispatchers', () => {
  const rule = (text: string) => text.split('\n').find((l) => l.startsWith('15. ')) ?? '';

  test('SHARED-JUDGMENT rule 15 exists and stays byte-identical across dispatchers', () => {
    const bodies = DISPATCHERS.map((s) =>
      fs.readFileSync(path.join(ROOT, 'skills', s, 'references', 'SHARED-JUDGMENT.md'), 'utf8'),
    );
    expect(new Set(bodies).size).toBe(1);
    const r = rule(bodies[0]);
    expect(r).toMatch(/authored before the work/i);
    expect(r).toMatch(/contract violation/i);
    expect(r).toMatch(/exit code/i);
    expect(r).toMatch(/base branch/i);
    expect(r).toMatch(/not verified/i);
  });
});

describe('verification contract: adds no surface', () => {
  test('/plan still has exactly the six canonical top-level modes', () => {
    const table = planSkill.slice(planSkill.indexOf('## Top-level modes'));
    const modes = [...table.matchAll(/^\| `([A-Z][^`]*)` \|/gm)].map((m) => m[1]);
    expect(modes).toEqual(['Discovery', 'Product', 'Engineering', 'DX', 'Specification', 'Full chain']);
  });

  test('the contract lives at the dispatcher layer, never inside a legacy module', () => {
    const legacy = path.join(ROOT, 'skills', 'plan', 'references', 'legacy');
    const carriers = fs
      .readdirSync(legacy)
      .filter((f) => f.endsWith('.md'))
      .filter((f) => fs.readFileSync(path.join(legacy, f), 'utf8').includes('VERIFICATION-CONTRACT'));
    expect(carriers).toEqual([]);
  });
});
