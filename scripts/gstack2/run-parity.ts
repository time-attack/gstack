#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import * as fs from 'fs';
import * as path from 'path';
import { BUG_FIX_OVERLAYS, evaluateBugFixRegression, overlaysForSource } from './bug-fix-overlays';
import { contractFor, DISPATCHERS, SOURCE_ASSIGNMENTS } from './assignments';
import { ROOT, blobShaForPath, legacySections, renderLegacyBody, renderPortedAssetBytes, renderPortedLegacyBody, renderPortedLegacySection, retiredInvocationPattern, sourceBlobSha } from './render-legacy';
import { routeStructured } from './route';
import { SCENARIOS } from './scenarios';
import { GSTACK2_BASE_SHA, TREE_NAMES } from './types';

const CONTRACT_KEYS = ['question_order', 'pressure', 'smart_skips', 'stop_approval_gates', 'evidence', 'artifacts', 'mutation', 'exit', 'voice'];
const PROVENANCE_KEYS = ['original_source_file', 'original_line_range', 'purpose', 'invocation_conditions', 'modes', 'question_sequence', 'follow_up_behavior', 'smart_skip_rules', 'pushback_rules', 'stop_gates', 'approval_gates', 'rubrics_and_scoring', 'cognitive_frameworks', 'evidence_requirements', 'artifacts_produced', 'mutation_authority', 'exit_states', 'voice', 'response_posture', 'new_location', 'parity_test'];
const ALLOWED_DISPOSITIONS = new Set(['VERBATIM_PORT', 'MECHANICAL_PORT', 'JUDGMENT_PRESERVING_CARVE', 'SHARED_MODULE', 'BUG_FIX', 'DUPLICATE_INFRASTRUCTURE', 'REMOVE_WITH_USER_APPROVAL']);
// Inventory history: the componentized-runtime parity expansion added 152
// checks to the previously verified 4,681-check corpus. The first update only
// accounted for the 16 lazy-section checks; the remaining 136 cover runtime
// contracts, retired-invocation guards, and generated package closure. Porting
// six more upstream judgment overlays (16 -> 22) added 30 checks. Three more
// Tier-2 overlays (22 -> 25) added 15 checks (5 per overlay). The
// proportional-planning overlay for issue #886 (25 -> 26, six plan-tree
// targets) added 15 more (2 per targeted module + 3 regression checks). The
// repo-local design-doc overlay for issue #703 (26 -> 27, five plan-tree
// targets) added 13 more. The design-doc concision overlay for issue #2000
// (27 -> 28, office-hours only) added 5 more. The self-contained-questions
// overlay for issue #879 (28 -> 29, targets '*', all 55 modules) added 113
// more (2 per module + 3 regression checks). The founder-resources opt-out
// overlay for issue #538 (29 -> 30, office-hours only) added 5 more. The
// per-tree code-intelligence offer contract added 18 (3 per dispatcher). The
// third-party web-action contract added 24 more (4 per tree: exists, marker
// format, dispatcher load, consent/secret content). Extending the #886
// overlay to the review specialists added more (2 per newly targeted module).
// Removing the /design skill and its design-review offerings then dropped
// design source modules, routing scenarios, carved sections, and design-only
// overlays (#696, #1777, #1920, #2189) while keeping #538, which recomputes
// the inventory to the value below. The ship-tree Apple App Store release
// adapter added 3 more (adapter exists, preserved gate content, dispatcher
// load). Removing the remaining design-review footprint then dropped the
// review/design-checklist.md asset from the review and ship trees (18 fewer
// asset checks), recomputing the inventory to the value below. Emitting the
// make-pdf tool skill into skills/make-pdf/ (six discoverable skills) added 6
// more (SKILL.md exists, frontmatter name, description, canonical-render
// freshness, runtime handoff reference, references/RUNTIME.md exists). The two
// privacy-audit redact/consent overlays (26 -> 28; #9108 autoplan-only, #9109
// codex+claude) added 12 more (2 per targeted module + 3 regression checks
// each; see evals/privacy/egress-audit-2026-07-28.md findings 8-9). The
// portable-dispatch overlay for upstream #2370 (28 -> 29, codex+claude)
// added 7 more (2 per targeted module + 3 regression checks). The no-key-echo
// overlay for upstream #1078 (29 -> 30, setup-deploy only) added 5 more. The
// external-effects overlay for upstream #1079/#1892 (30 -> 31; ship,
// land-and-deploy, document-release, codex) added 11 more. The packaged
// QUESTION-FORMAT contract (#1208/#1066 class) added 15 (3 per tree:
// exists, dispatcher load, brief/caps/fallback content). The emitted
// bash-block lint added 1,214: 2 fence/plausibility invariants plus 2 per
// fenced bash block (606 blocks: `bash -n` syntax + portability lint) — this
// component scales with the emitted block inventory, so content changes that
// add or remove bash blocks move the pin by 2 per block.
export const EXPECTED_PARITY_CHECKS = 5631;

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function json(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function files(directory: string, suffix = ''): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((file) => file.endsWith(suffix)).sort();
}

export function normalizeGolden(value: string): string {
  return `${value.replace(/\r\n/g, '\n').trim()}\n`;
}

export function extractLegacyBody(module: string, source: string): string {
  const startMarker = `<!-- GSTACK2_LEGACY_BODY_START source=${source} -->`;
  const endMarker = `<!-- GSTACK2_LEGACY_BODY_END source=${source} -->`;
  const start = module.indexOf(startMarker);
  const end = module.indexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) throw new Error(`Missing legacy body markers for ${source}`);
  return normalizeGolden(module.slice(start + startMarker.length, end));
}

export interface ParityResult {
  checks: number;
  sources: number;
  sections: number;
  scenarios: number;
  regressions: number;
  assets: number;
  bashBlocks: number;
}

// --- Emitted bash-block lint --------------------------------------------
// Every fenced bash block in the emitted tree (skills/ + compat/ markdown)
// must parse (`bash -n`) and avoid known BSD/GNU portability traps. The
// generator actively rewrites bash inside preserved bodies; without this
// dimension a corrupted rewrite would be faithfully hash-pinned.

interface EmittedBashBlock {
  file: string;
  line: number;
  content: string;
}

function markdownFilesUnder(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...markdownFilesUnder(child));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(child);
  }
  return out.sort();
}

export function extractEmittedBashBlocks(): { blocks: EmittedBashBlock[]; fenceErrors: string[] } {
  const blocks: EmittedBashBlock[] = [];
  const fenceErrors: string[] = [];
  const files = [
    ...markdownFilesUnder(path.join(ROOT, 'skills')),
    ...markdownFilesUnder(path.join(ROOT, 'compat')),
  ];
  for (const file of files) {
    const relative = path.relative(ROOT, file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    let open: { indent: string; start: number; body: string[] } | null = null;
    lines.forEach((line, index) => {
      const fence = line.match(/^(\s*)```(\w*)/);
      if (open) {
        if (fence && fence[2] === 'bash') {
          // A new bash fence while one is open means the previous block never
          // closed — markdown swallows the prose in between into the block.
          fenceErrors.push(`${relative}:${open.start} bash fence never closes before ${relative}:${index + 1}`);
          open = { indent: fence[1], start: index + 1, body: [] };
        } else if (fence && fence[1].length <= open.indent.length && fence[2] === '') {
          blocks.push({ file: relative, line: open.start, content: open.body.join('\n') });
          open = null;
        } else {
          open.body.push(line.startsWith(open.indent) ? line.slice(open.indent.length) : line);
        }
      } else if (fence && fence[2] === 'bash') {
        open = { indent: fence[1], start: index + 1, body: [] };
      }
    });
    if (open) fenceErrors.push(`${relative}:${(open as { start: number }).start} bash fence never closes before end of file`);
  }
  return { blocks, fenceErrors };
}

/**
 * Prose placeholders like `<base>`, `<slug>`, `<paste the contents here>` are
 * documentation, not shell. Replace each with a plain word so `bash -n`
 * checks the real shell around them. Heredocs (`<<`), process substitution
 * (`<(`), and plain redirects (`< file` — space after `<`) are untouched.
 */
export function normalizeBashPlaceholders(value: string): string {
  return value.replace(/<(?![<( ])[A-Za-z0-9 _.'"/|:+,$@{}()*#=?!-]*?>/g, 'PLACEHOLDER');
}

/** Known cross-platform (BSD/GNU/BusyBox) traps in emitted shell. */
export function bashPortabilityIssues(content: string): string[] {
  const issues: string[] = [];
  if (/(?<![\w-])stat\s+-[fc]\b/.test(content)) issues.push('stat -f/-c is BSD/GNU-specific; derive the value another way');
  if (/\bsed\s+-i\b/.test(content)) issues.push("sed -i argument shape differs between BSD ('' required) and GNU; use a temp file");
  const quotedTilde = content
    .split('\n')
    .some((line) => /["']~\//.test(line) && !line.includes('expanduser'));
  if (quotedTilde) issues.push('quoted tilde path never expands; use $HOME or unquoted ~');
  if (/^#!\/bin\/sh/.test(content) && /\[\[|(?:^|\s)local\s/.test(content)) issues.push('sh-mode block uses bashisms ([[ / local)');
  return issues;
}

export function runParity(): ParityResult {
  const failures: string[] = [];
  let checks = 0;
  const check = (condition: unknown, message: string): void => {
    checks += 1;
    if (!condition) failures.push(message);
  };
  const retiredInvocation = retiredInvocationPattern();

  const TOOL_SKILLS = ['make-pdf'] as const;
  const publicSkills = fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(ROOT, 'skills', entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
  check(
    JSON.stringify(publicSkills) === JSON.stringify([...TREE_NAMES, ...TOOL_SKILLS].sort()),
    `Discoverable skills differ: ${publicSkills.join(', ')}`,
  );
  // The five judgment dispatchers are mode-based; make-pdf is a tool skill that
  // ships in the same tree. Verify its host-neutral surface is emitted fresh and
  // its runtime handoff reference exists.
  for (const tool of TOOL_SKILLS) {
    const toolSkillPath = path.join(ROOT, 'skills', tool, 'SKILL.md');
    check(fs.existsSync(toolSkillPath), `Tool skill ${tool} is missing its SKILL.md`);
    if (fs.existsSync(toolSkillPath)) {
      const toolSkill = fs.readFileSync(toolSkillPath, 'utf8');
      check(new RegExp(`^---\\nname: ${tool}\\n`).test(toolSkill), `${tool} tool skill frontmatter name mismatch`);
      check(toolSkill.includes('description: >-'), `${tool} tool skill lacks a frontmatter description`);
      check(toolSkill.includes(renderPortedLegacyBody(tool).trim()), `${tool} tool skill body drifted from its canonical render`);
      check(toolSkill.includes('references/RUNTIME.md'), `${tool} tool skill does not hand off to the runtime contract`);
      check(fs.existsSync(path.join(ROOT, 'skills', tool, 'references', 'RUNTIME.md')), `${tool} tool skill lacks references/RUNTIME.md`);
    }
  }
  check(SOURCE_ASSIGNMENTS.length === 47, `Expected 47 source assignments; got ${SOURCE_ASSIGNMENTS.length}`);
  check(SOURCE_ASSIGNMENTS.filter((entry) => entry.mandatory).length === 25, 'Mandatory specialist count is not 25');
  const exactModes: Record<string, string[]> = {
    plan: ['Discovery', 'Product', 'Engineering', 'DX', 'Specification', 'Full chain'],
    qa: ['Report', 'Fix'],
    debug: ['Diagnose-only', 'Fix'],
    review: ['Normal', 'Security', 'Performance', 'Deep'],
    ship: ['Prepare', 'Land', 'Deploy', 'Monitor', 'Resume'],
  };
  for (const [tree, modes] of Object.entries(exactModes)) {
    const actual = DISPATCHERS.find((entry) => entry.name === tree)?.modes.map((entry) => entry.mode);
    check(JSON.stringify(actual) === JSON.stringify(modes), `${tree} top-level modes differ: ${actual?.join(', ')}`);
  }

  for (const tree of TREE_NAMES) {
    const skillPath = path.join(ROOT, 'skills', tree, 'SKILL.md');
    const skill = fs.readFileSync(skillPath, 'utf8');
    const fmEnd = skill.indexOf('\n---', 4);
    const fm = skill.slice(4, fmEnd);
    const keys = fm.split('\n').map((line) => line.match(/^([a-z][a-z0-9_-]*):/)?.[1]).filter(Boolean).sort();
    check(JSON.stringify(keys) === JSON.stringify(['description', 'name']), `${tree} frontmatter must contain only name and description`);
    check(new RegExp(`^name: ${tree}$`, 'm').test(fm), `${tree} frontmatter name mismatch`);
    check(skill.split('\n').length < 500, `${tree}/SKILL.md exceeds 500 lines`);
    let prior = -1;
    for (const label of ['Target:', 'Mode:', 'Depth:', 'Mutation:', 'Active modules:', 'Skipped modules:', 'Web context:']) {
      const position = skill.indexOf(label);
      check(position > prior, `${tree} required execution header is missing or out of order at ${label}`);
      prior = position;
    }
    const metadata = fs.readFileSync(path.join(ROOT, 'skills', tree, 'agents', 'openai.yaml'), 'utf8');
    check(/^interface:\n  display_name: .+\n  short_description: .+\n  default_prompt: .+\n$/.test(metadata), `${tree} openai.yaml schema mismatch`);
    check(metadata.includes(`$${tree}`), `${tree} default prompt does not mention $${tree}`);
    const dispatcher = DISPATCHERS.find((entry) => entry.name === tree)!;
    for (const mode of dispatcher.modes) {
      for (const source of mode.modules) {
        const localModule = path.join(ROOT, 'skills', tree, 'references', 'legacy', `${source}.md`);
        const owner = SOURCE_ASSIGNMENTS.find((entry) => entry.source === source)!;
        const canonicalModule = path.join(ROOT, 'skills', owner.tree, 'references', 'legacy', `${source}.md`);
        check(fs.existsSync(localModule), `${tree}:${mode.mode} is not package-closed; missing ${source}`);
        check(skill.includes(`references/legacy/${source}.md`), `${tree}:${mode.mode} does not use its package-local ${source} module`);
        if (fs.existsSync(localModule) && fs.existsSync(canonicalModule)) {
          check(sha256(fs.readFileSync(localModule)) === sha256(fs.readFileSync(canonicalModule)), `${tree}:${mode.mode} dependency copy drifted for ${source}`);
        }
      }
    }
    const packagedModules = files(path.join(ROOT, 'skills', tree, 'references', 'legacy'), '.md');
    for (const moduleName of packagedModules) {
      const modulePath = path.join(ROOT, 'skills', tree, 'references', 'legacy', moduleName);
      const module = fs.readFileSync(modulePath, 'utf8');
      check(
        !/(?:~\/\.claude\/skills\/gstack|\$GSTACK_ROOT)\/[a-z0-9-]+\/SKILL\.md|\$\{?CLAUDE_SKILL_DIR\}?\/\.\.\/[a-z0-9-]+\/SKILL\.md/.test(module),
        `${tree}/${moduleName} still reaches another host or source checkout for a skill`,
      );
      check(!/GSTACK_ROOT="\$HOME\/\.(?:claude|codex)\/skills\/gstack"/.test(module), `${tree}/${moduleName} still binds runtime state to a host skill directory`);
      check(!/(?:\$HOME\/|\$_ROOT\/|^)\.agents\/skills\/gstack\/(?:bin|browse|design|make-pdf|lib|extension)/m.test(module), `${tree}/${moduleName} still resolves a runtime capability through host placement`);
      check(
        !/(?:\$\{GSTACK_HOME:-\$HOME\/\.gstack\}|\$GSTACK_STATE_ROOT|\$\{GSTACK_STATE_ROOT\}|\$GSTACK_HOME)[^\n]{0,16}\/projects\/(?:\$\{SLUG|\$SLUG\b|\$_PLAN_SLUG\b|<slug>|\{slug\})/.test(module),
        `${tree}/${moduleName} still keys worktree-local state by repository slug`,
      );
      check(!/~\/\.gstack(?:\/|(?=[\s`'"),.;:\]}]))/.test(module), `${tree}/${moduleName} bypasses GSTACK_HOME with a literal state path`);
      check(!/"\$HOME\/\.gstack(?:\/|")/.test(module), `${tree}/${moduleName} bypasses GSTACK_HOME with a quoted HOME state path`);
      check(!/\$\{HOME\}\/\.gstack(?:\/|(?=[\s`'"),.;:\]}]))/.test(module), `${tree}/${moduleName} bypasses GSTACK_HOME with a braced HOME state path`);
      check(!/(?<![-"{])\$HOME\/\.gstack(?:\/|(?=[\s`'"),.;:\]}]))/.test(module), `${tree}/${moduleName} bypasses GSTACK_HOME with an unquoted HOME state path`);
      if (module.includes('GSTACK_BIN=')) check(module.includes('GSTACK_HOME="${GSTACK_HOME:-$HOME/.gstack}"'), `${tree}/${moduleName} lacks the host-neutral runtime root`);
      for (const match of module.matchAll(/(?:^|[\s`(])((?:references\/(?:legacy|sections|support|artifacts)|assets)\/[A-Za-z0-9_.\/-]+)/g)) {
        const relative = match[1].replace(/[.,;:]+$/, '');
        check(fs.existsSync(path.join(ROOT, 'skills', tree, relative)), `${tree}/${moduleName} has an unpackaged local reference: ${relative}`);
      }
    }
  }
  const systemFunctionalPath = path.join(ROOT, 'skills', 'qa', 'references', 'SYSTEM-FUNCTIONAL.md');
  check(fs.existsSync(systemFunctionalPath), 'QA lacks the system-functional execution adapter');
  if (fs.existsSync(systemFunctionalPath)) {
    const adapter = fs.readFileSync(systemFunctionalPath, 'utf8');
    check(
      adapter.includes('Report mode reads `qa-only` and never changes product code')
        && adapter.includes('`investigate` proves root cause')
        && adapter.includes('rerun the exact failing probe'),
      'System-functional adapter lost preserved report/fix, root-cause, or exact re-verification behavior',
    );
    for (const source of ['devex-review', 'qa-only', 'qa', 'investigate']) {
      check(fs.existsSync(path.join(ROOT, 'skills', 'qa', 'references', 'legacy', `${source}.md`)), `System-functional QA package lacks preserved ${source}`);
    }
    check(adapter.includes('API, CLI command, backend job, worker, queue consumer, webhook'), 'System-functional adapter does not cover the required non-browser surfaces');
  }
  check(fs.readFileSync(path.join(ROOT, 'skills', 'qa', 'SKILL.md'), 'utf8').includes('references/SYSTEM-FUNCTIONAL.md'), 'QA dispatcher does not load system-functional when activated');
  for (const tree of TREE_NAMES) {
    const dispatcher = fs.readFileSync(path.join(ROOT, 'skills', tree, 'SKILL.md'), 'utf8');
    const authority = path.join(ROOT, 'skills', tree, 'references', 'AUTHORITY-POLICY.md');
    check(fs.existsSync(authority), `${tree} lacks the executable authority/evidence policy`);
    check(dispatcher.includes('references/AUTHORITY-POLICY.md'), `${tree} dispatcher does not load the authority/evidence policy`);
    const codeIntel = path.join(ROOT, 'skills', tree, 'references', 'CODE-INTELLIGENCE.md');
    check(fs.existsSync(codeIntel), `${tree} lacks the optional code-intelligence offer contract`);
    check(dispatcher.includes('references/CODE-INTELLIGENCE.md'), `${tree} dispatcher does not load the code-intelligence offer`);
    if (fs.existsSync(codeIntel)) {
      const offer = fs.readFileSync(codeIntel, 'utf8');
      check(
        offer.includes('offer: false`, continue silently')
          && offer.includes('No indexing')
          && offer.includes('never auto-install a provider'),
        `${tree} code-intelligence offer lost its silent-degrade, decline, or no-auto-install behavior`,
      );
    }
    const questionFormatPath = path.join(ROOT, 'skills', tree, 'references', 'QUESTION-FORMAT.md');
    check(fs.existsSync(questionFormatPath), `${tree} lacks the packaged question-format contract`);
    check(dispatcher.includes('references/QUESTION-FORMAT.md'), `${tree} dispatcher does not load the question-format contract`);
    if (fs.existsSync(questionFormatPath)) {
      const questionFormat = fs.readFileSync(questionFormatPath, 'utf8');
      check(
        questionFormat.includes('as direct assistant text')
          && questionFormat.includes('NEVER silently default')
          && questionFormat.includes('At most 4 options per call'),
        `${tree} question-format contract lost its brief-as-text, no-silent-default, or payload-cap rules`,
      );
    }
    check(dispatcher.includes('references/THIRD-PARTY-ACTIONS.md'), `${tree} dispatcher does not load the third-party web-action contract`);
    const thirdPartyPath = path.join(ROOT, 'skills', tree, 'references', 'THIRD-PARTY-ACTIONS.md');
    if (fs.existsSync(thirdPartyPath)) {
      const thirdParty = fs.readFileSync(thirdPartyPath, 'utf8');
      check(
        thirdParty.includes('STOP and ask one explicit question before any browsing')
          && thirdParty.includes('per-task consent')
          && thirdParty.includes('never appears in chat output, logs, or shell history')
          && thirdParty.includes('verify the captured credential with one non-mutating API call'),
        `${tree} third-party web-action contract lost its consent gate or secret-handling rules`,
      );
    }
  }
  const effectsPath = path.join(ROOT, 'skills', 'ship', 'references', 'EXTERNAL-EFFECTS.md');
  check(fs.existsSync(effectsPath), 'Ship lacks the durable external-effect protocol');
  if (fs.existsSync(effectsPath)) {
    const effects = fs.readFileSync(effectsPath, 'utf8');
    check(effects.includes('gstack state effect') && effects.includes('Never retry automatically'), 'Ship external-effect protocol lost durable claim or no-repeat behavior');
  }
  check(fs.readFileSync(path.join(ROOT, 'skills', 'ship', 'SKILL.md'), 'utf8').includes('references/EXTERNAL-EFFECTS.md'), 'Ship dispatcher does not bind external actions to durable state');
  const appleReleasePath = path.join(ROOT, 'skills', 'ship', 'references', 'APPLE-RELEASE.md');
  check(fs.existsSync(appleReleasePath), 'Ship lacks the Apple App Store release adapter');
  if (fs.existsSync(appleReleasePath)) {
    const apple = fs.readFileSync(appleReleasePath, 'utf8');
    check(
      apple.includes('paid Apple Developer Program membership')
        && apple.includes('The upload is an external effect')
        && apple.includes('the release itself adds no new dependency'),
      'Apple release adapter lost its membership gate, durable-upload binding, or no-new-dependency rule',
    );
  }
  check(fs.readFileSync(path.join(ROOT, 'skills', 'ship', 'SKILL.md'), 'utf8').includes('references/APPLE-RELEASE.md'), 'Ship dispatcher does not load the Apple release adapter for Apple targets');

  check(files(path.join(ROOT, 'evals', 'parity', 'contracts'), '.json').length === 47, 'Contract fixture count is not 47');
  const baselineRenders = json(path.join(ROOT, 'evals', 'parity', 'baseline-render-hashes.json'));
  check(baselineRenders.base_sha === GSTACK2_BASE_SHA, 'Immutable rendered-baseline SHA mismatch');
  for (const assignment of SOURCE_ASSIGNMENTS) {
    const baseBlob = sourceBlobSha(assignment.source);
    const baselineBody = normalizeGolden(renderLegacyBody(assignment.source));
    const expectedBody = normalizeGolden(renderPortedLegacyBody(assignment.source));
    const immutableRenderHash = baselineRenders.sources[assignment.source];
    if (immutableRenderHash == null) {
      check(assignment.source === 'codex', `${assignment.source} unexpectedly lacks an immutable Codex render`);
    } else {
      check(sha256(baselineBody) === immutableRenderHash, `${assignment.source} current resolver output drifted from the immutable base render`);
    }
    const modulePath = path.join(ROOT, 'skills', assignment.tree, 'references', 'legacy', `${assignment.source}.md`);
    const module = fs.readFileSync(modulePath, 'utf8');
    const generatedBody = extractLegacyBody(module, assignment.source);
    const legacyMarker = `<!-- GSTACK2_LEGACY_BODY_START source=${assignment.source} -->`;
    const prelude = module.slice(0, module.indexOf(legacyMarker));
    check(!/^\s*#{1,6}\s|^\s*[-*]\s|^\s*\d+\.\s/m.test(prelude), `${assignment.source} has visible generated prose before preserved judgment`);
    check(prelude.split('\n').length <= 5, `${assignment.source} generated prelude is not thin`);
    check(generatedBody === expectedBody, `${assignment.source} normalized legacy body differs`);
    check(!generatedBody.includes('## Preamble (run first)'), `${assignment.source} still executes the retired shared onboarding preamble`);
    check(!/MODEL_OVERLAY: claude|CLAUDE_PLAN_FILE|Add routing rules to CLAUDE\.md|Boil the Ocean principle|TEL_PROMPTED|PROACTIVE_PROMPTED/.test(generatedBody), `${assignment.source} retains host-specific onboarding, engagement, or telemetry machinery`);
    check(!/cd <SKILL_DIR> && \.\/setup/.test(generatedBody), `${assignment.source} tells a standard-installed skill to run a nonexistent local setup script`);
    check(!retiredInvocation.test(generatedBody), `${assignment.source} recommends a retired public invocation instead of a five-skill route`);
    const usesRuntimeBinding = /\$(?:GSTACK_BIN|GSTACK_ROOT|GSTACK_STATE_ROOT)\b|\$(?:B|D|P)\b/.test(generatedBody);
    check(!usesRuntimeBinding || generatedBody.includes('## Host-neutral runtime bindings'), `${assignment.source} uses an unbound retained runtime helper variable`);
    check(!/bun\.sh\/install|bun run \$GSTACK_BIN|command -v bun/.test(generatedBody), `${assignment.source} retains GStack-owned host Bun onboarding or invocation`);
    const visiblePointOfUse = ['open-gstack-browser', 'pair-agent', 'setup-browser-cookies'].includes(assignment.source);
    check(
      generatedBody.includes('## Visible-browser point-of-use gate') === visiblePointOfUse,
      `${assignment.source} visible-browser point-of-use gate classification is wrong`,
    );
    check(module.includes(`blob=${baseBlob}`), `${assignment.source} module lacks source blob provenance`);
    check(module.includes(`baseline_render_sha256=${sha256(baselineBody)}`), `${assignment.source} module lacks immutable baseline render hash`);
    check(module.includes(`ported_render_sha256=${sha256(expectedBody)}`), `${assignment.source} module lacks installable port render hash`);
    const contract = json(path.join(ROOT, 'evals', 'parity', 'contracts', `${assignment.source}.json`));
    check(contract.base_sha === GSTACK2_BASE_SHA && contract.blob_sha === baseBlob, `${assignment.source} contract provenance mismatch`);
    check(JSON.stringify(Object.keys(contract.contract).sort()) === JSON.stringify([...CONTRACT_KEYS].sort()), `${assignment.source} contract dimensions mismatch`);
    check(JSON.stringify(contract.contract) === JSON.stringify(contractFor(assignment)), `${assignment.source} contract content mismatch`);
    for (const overlay of overlaysForSource(assignment.source)) {
      check(module.includes(`anchor=${overlay.anchor}`), `${assignment.source} is missing PR #${overlay.pr} anchor`);
      check(module.includes(overlay.body), `${assignment.source} is missing PR #${overlay.pr} judgment body`);
    }
  }

  const baselinePromptBytes = SOURCE_ASSIGNMENTS.reduce((total, assignment) => total + Buffer.byteLength(renderLegacyBody(assignment.source)), 0);
  const canonicalPromptBytes = SOURCE_ASSIGNMENTS.reduce((total, assignment) => total + Buffer.byteLength(renderPortedLegacyBody(assignment.source)), 0);
  check(canonicalPromptBytes < baselinePromptBytes * 0.5, `Canonical specialist corpus did not cut prompt bytes by at least 50% (${canonicalPromptBytes}/${baselinePromptBytes})`);

  const sections = legacySections();
  check(sections.length === 14, `Expected 14 section templates; got ${sections.length}`);
  for (const section of sections) {
    check(blobShaForPath(section.relativePath) === json(path.join(ROOT, 'docs', 'gstack-2', 'JUDGMENT-PROVENANCE.json')).sections.find((item: any) => item.source_path === section.relativePath)?.blob_sha, `${section.relativePath} blob provenance mismatch`);
    const assignment = SOURCE_ASSIGNMENTS.find((entry) => entry.source === section.source)!;
    const module = fs.readFileSync(path.join(ROOT, 'skills', assignment.tree, 'references', 'legacy', `${assignment.source}.md`), 'utf8');
    const portedSection = renderPortedLegacySection(section);
    const sectionName = path.basename(section.relativePath).replace(/\.tmpl$/, '');
    check(module.includes(`references/sections/${section.source}/${sectionName}`), `${section.relativePath} lacks its package-local lazy reference`);
    check(!module.includes(portedSection.trim()), `${section.relativePath} is still duplicated inline instead of lazy-loaded`);
    const packaged = path.join(ROOT, 'skills', assignment.tree, 'references', 'sections', section.source, sectionName);
    check(fs.existsSync(packaged), `${section.relativePath} is referenced but not packaged`);
    if (fs.existsSync(packaged)) check(normalizeGolden(fs.readFileSync(packaged, 'utf8')) === normalizeGolden(portedSection), `${section.relativePath} packaged content drifted`);
  }

  check(SCENARIOS.length === 19, `Expected 19 scenarios; got ${SCENARIOS.length}`);
  check(files(path.join(ROOT, 'evals', 'parity', 'scenarios'), '.json').length === 19, 'Generated scenario fixture count is not 19');
  for (const scenario of SCENARIOS) {
    const routed = routeStructured(scenario.signals);
    const expectedRoute = {
      tree: scenario.expected.tree,
      mode: scenario.expected.mode,
      depth: scenario.expected.depth,
      mutation: scenario.expected.mutation,
      active_modules: scenario.expected.active_modules,
      skipped_modules: scenario.expected.skipped_modules,
      web_context: scenario.expected.web_context,
    };
    check(JSON.stringify(routed) === JSON.stringify(expectedRoute), `${scenario.id} structured route mismatch`);
    check(scenario.expected.decision_basis.length > 0, `${scenario.id} lacks routing evidence`);
    check(JSON.stringify(json(path.join(ROOT, 'evals', 'parity', 'scenarios', `${scenario.id}.json`))) === JSON.stringify(scenario), `${scenario.id} generated fixture drift`);
  }

  check(BUG_FIX_OVERLAYS.length === 31, `Expected 31 regression definitions; got ${BUG_FIX_OVERLAYS.length}`);
  check(files(path.join(ROOT, 'evals', 'parity', 'regressions'), '.json').length === 31, 'Generated regression fixture count is not 31');
  for (const overlay of BUG_FIX_OVERLAYS) {
    const fixture = json(path.join(ROOT, 'evals', 'parity', 'regressions', `pr-${overlay.pr}.json`));
    check(JSON.stringify(fixture) === JSON.stringify(overlay), `PR #${overlay.pr} regression fixture drift`);
    check(Object.keys(overlay.regression.input).length > 0 && Object.keys(overlay.regression.expected).length > 0, `PR #${overlay.pr} regression is empty`);
    check(
      JSON.stringify(evaluateBugFixRegression(overlay.pr, fixture.regression.input)) === JSON.stringify(fixture.regression.expected),
      `PR #${overlay.pr} executable replacement regression failed`,
    );
  }

  const manifest = json(path.join(ROOT, 'evals', 'parity', 'manifest.json'));
  const provenance = json(path.join(ROOT, 'docs', 'gstack-2', 'JUDGMENT-PROVENANCE.json'));
  check(JSON.stringify(manifest) === JSON.stringify(provenance), 'Eval manifest and judgment provenance differ');
  check(manifest.base_sha === GSTACK2_BASE_SHA, 'Provenance base SHA mismatch');
  const helperClosure = json(path.join(ROOT, 'evals', 'parity', 'runtime-helper-closure.json'));
  check(JSON.stringify(helperClosure.helpers) === JSON.stringify(manifest.runtime_helpers), 'Runtime helper closure and provenance differ');
  for (const helper of helperClosure.helpers) {
    if (helper.delivery === 'managed-runtime-artifact') {
      check(
        helper.name === 'bun'
          && helper.component === 'core'
          && helper.build_step === 'managed-bun'
          && helper.source_path === '.gstack-runtime-tools/bun'
          && helper.stable_path.endsWith('/bin/bun'),
        `Managed runtime helper ${helper.name} lacks core-component provenance`,
      );
    } else {
      const sourcePath = helper.platform_source_paths?.[process.platform === 'win32' ? 'win32' : 'posix']
        ?? helper.source_path;
      check(fs.existsSync(path.join(ROOT, sourcePath)), `Preserved helper ${helper.name} has no source payload at ${sourcePath}`);
    }
    check(Array.isArray(helper.consumer_modules) && helper.consumer_modules.length > 0, `Preserved helper ${helper.name} has no consumer provenance`);
  }
  for (const record of [...manifest.sources, ...manifest.sections]) {
    check(ALLOWED_DISPOSITIONS.has(record.disposition), `${record.source_path} uses invalid disposition ${record.disposition}`);
    for (const key of PROVENANCE_KEYS) check(record[key] !== undefined, `${record.source_path} lacks provenance field ${key}`);
  }
  for (const asset of manifest.assets) {
    const target = path.join(ROOT, asset.target_path);
    check(fs.existsSync(target), `Missing relocated asset ${asset.target_path}`);
    const baseline = Bun.spawnSync({
      cmd: ['git', 'show', `${GSTACK2_BASE_SHA}:${asset.source_path}`],
      cwd: ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    check(baseline.exitCode === 0, `Unable to read pinned asset ${asset.source_path}`);
    if (baseline.exitCode === 0) {
      const expected = renderPortedAssetBytes(asset.source_path, baseline.stdout);
      const expectedDisposition = sha256(expected) === sha256(baseline.stdout) ? 'VERBATIM_PORT' : 'MECHANICAL_PORT';
      check(asset.blob_sha === blobShaForPath(asset.source_path), `Relocated asset blob provenance mismatch: ${asset.target_path}`);
      check(asset.baseline_sha256 === sha256(baseline.stdout), `Relocated asset baseline hash mismatch: ${asset.target_path}`);
      check(asset.sha256 === sha256(expected), `Relocated asset port hash mismatch: ${asset.target_path}`);
      check(asset.disposition === expectedDisposition, `Relocated asset disposition mismatch: ${asset.target_path}`);
      if (fs.existsSync(target)) {
        const installed = fs.readFileSync(target);
        check(sha256(installed) === sha256(expected), `Relocated asset hash mismatch: ${asset.target_path}`);
        if (asset.target_path.endsWith('.md')) {
          check(!/~\/.claude\/skills\/gstack|browse\/bin\/remote-slug/.test(installed.toString()), `Relocated asset retains a host-specific runtime path: ${asset.target_path}`);
          check(!retiredInvocationPattern().test(installed.toString()), `Relocated executable asset recommends a retired public invocation: ${asset.target_path}`);
        }
      }
    }
  }
  for (const sectionCopy of manifest.section_copies ?? []) {
    const target = path.join(ROOT, sectionCopy.target_path);
    check(fs.existsSync(target), `Missing packaged section ${sectionCopy.target_path}`);
    if (fs.existsSync(target)) {
      const content = fs.readFileSync(target);
      check(sha256(content) === sectionCopy.sha256, `Packaged section hash mismatch: ${sectionCopy.target_path}`);
      check(!retiredInvocationPattern().test(content.toString()), `Packaged section recommends a retired public invocation: ${sectionCopy.target_path}`);
    }
  }
  for (const dependency of manifest.dependency_copies ?? []) {
    const target = path.join(ROOT, dependency.target);
    check(fs.existsSync(target), `Missing transitive module copy ${dependency.target}`);
    if (fs.existsSync(target)) check(sha256(fs.readFileSync(target)) === dependency.sha256, `Transitive module copy drift: ${dependency.target}`);
  }

  check(files(path.join(ROOT, 'compat'), '.md').length === 48, 'Compatibility alias file count is not 47 + README');
  const migrationMap = json(path.join(ROOT, 'compat', 'migration-map.json'));
  check(migrationMap.schema_version === 1, 'Compatibility migration map schema mismatch');
  check(migrationMap.aliases.length === 47, 'Compatibility migration map must contain 47 aliases');
  check(migrationMap.policy.default_discoverable === false, 'Compatibility aliases must be opt-in');
  check(
    migrationMap.policy.context_choice_migrated_implicitly === false &&
      migrationMap.policy.context_consent_migrated_implicitly === false,
    'Compatibility migration must not infer Context choice or consent',
  );
  for (const assignment of SOURCE_ASSIGNMENTS) {
    const aliasPath = path.join(ROOT, 'skills', '.compat', assignment.source, 'SKILL.md');
    const needsAlias = !(TREE_NAMES as readonly string[]).includes(assignment.source);
    check(fs.existsSync(aliasPath) === needsAlias, needsAlias
      ? `Missing opt-in compatibility alias for ${assignment.source}`
      : `Redundant compatibility alias collides with canonical ${assignment.source}`);
    if (fs.existsSync(aliasPath)) {
      const alias = fs.readFileSync(aliasPath, 'utf8');
      check(alias.includes(assignment.replacement), `${assignment.source} alias lacks exact replacement invocation`);
      check(alias.includes('internal: true'), `${assignment.source} alias must stay out of default discovery`);
      check(!alias.includes('GSTACK2_LEGACY_BODY_START'), `${assignment.source} alias copied specialist judgment`);
      check(alias.split('\n').length < 30, `${assignment.source} alias is not thin`);
    }
  }
  for (const tree of TREE_NAMES) {
    const compatibility = fs.readFileSync(path.join(ROOT, 'skills', tree, 'references', 'COMPATIBILITY.md'), 'utf8');
    check(!compatibility.includes('../../../') && !compatibility.includes('compat/README.md'), `${tree} compatibility map escapes the selected package`);
    for (const reference of ['SHARED-JUDGMENT.md', 'WEB-CONTEXT.md', 'RUNTIME.md', 'THIRD-PARTY-ACTIONS.md']) {
      const referencePath = path.join(ROOT, 'skills', tree, 'references', reference);
      check(fs.existsSync(referencePath), `${tree} lacks ${reference}`);
      if (fs.existsSync(referencePath)) {
        check(
          /^<!-- GENERATED[^\n]* -->\n# /.test(fs.readFileSync(referencePath, 'utf8')),
          `${tree}/${reference} must separate the generated marker from its Markdown heading`,
        );
      }
    }
    const runtimeContract = fs.readFileSync(path.join(ROOT, 'skills', tree, 'references', 'RUNTIME.md'), 'utf8');
    const packagedBootstrap = fs.readFileSync(path.join(ROOT, 'skills', tree, 'references', 'support', 'runtime-bootstrap.mjs'));
    check(packagedBootstrap.equals(fs.readFileSync(path.join(ROOT, 'runtime', 'runtime-bootstrap.mjs'))), `${tree} packaged runtime bootstrap drifted from its source`);
    check(runtimeContract.includes('preview --capability <name>') && runtimeContract.includes('It never downloads components or mutates runtime state.'), `${tree} runtime contract lacks non-mutating exact-byte preview`);
    check(runtimeContract.includes('matching `install` command with the same capabilities and browser flags plus `--yes`'), `${tree} runtime contract lacks explicit approved install invocation`);
    check(runtimeContract.includes('With managed Chromium, logical `browser` expands to `browser-code + browser-headless`') && runtimeContract.includes('Internal `browser-visible` expands to `browser-code + browser-visible` and is managed-only'), `${tree} runtime contract omits provider-aware component dependency closure`);
    check(runtimeContract.includes('`all` means those two and intentionally excludes visible Chromium'), `${tree} runtime contract lets eager setup install visible Chromium`);
    check(runtimeContract.includes('B=$GSTACK_BIN/browse'), `${tree} runtime contract omits stable launcher bindings`);
    check(runtimeContract.includes('BUN_CMD=$GSTACK_BIN/bun'), `${tree} runtime contract omits the managed Bun binding`);
    check(runtimeContract.includes('discovers Git for Windows Bash') && runtimeContract.includes('Python is not a global GStack prerequisite'), `${tree} runtime contract omits retained shell/Python prerequisite disclosure`);
  }
  for (const required of ['SKILL-MIGRATION.md', 'JUDGMENT-PROVENANCE.json', 'JUDGMENT-PARITY.md', 'SCENARIOS.md']) {
    check(fs.existsSync(path.join(ROOT, 'docs', 'gstack-2', required)), `Missing docs/gstack-2/${required}`);
  }

  // Emitted bash-block lint: 2 checks per fenced block (syntax + portability)
  // plus the fence-closure and plausibility invariants.
  const emittedBash = extractEmittedBashBlocks();
  check(emittedBash.fenceErrors.length === 0, `Unclosed bash fences in the emitted tree: ${emittedBash.fenceErrors.join('; ')}`);
  check(emittedBash.blocks.length > 500, `Emitted bash-block inventory implausibly small (${emittedBash.blocks.length}); extraction is broken`);
  for (const block of emittedBash.blocks) {
    const syntax = Bun.spawnSync({
      cmd: ['bash', '-n'],
      stdin: new TextEncoder().encode(normalizeBashPlaceholders(block.content)),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    check(
      syntax.exitCode === 0,
      `bash -n rejected ${block.file}:${block.line}: ${syntax.stderr.toString().trim().split('\n')[0]}`,
    );
    const portability = bashPortabilityIssues(block.content);
    check(portability.length === 0, `portability lint ${block.file}:${block.line}: ${portability.join(' | ')}`);
  }

  if (checks !== EXPECTED_PARITY_CHECKS) {
    failures.push(`Parity check inventory changed: expected ${EXPECTED_PARITY_CHECKS}, observed ${checks}`);
  }
  if (failures.length) {
    throw new Error(`GStack 2 parity failed (${failures.length}/${checks} checks):\n- ${failures.join('\n- ')}`);
  }
  return {
    checks,
    sources: SOURCE_ASSIGNMENTS.length,
    sections: sections.length,
    scenarios: SCENARIOS.length,
    regressions: BUG_FIX_OVERLAYS.length,
    assets: manifest.assets.length,
    bashBlocks: emittedBash.blocks.length,
  };
}

if (import.meta.main) {
  const result = runParity();
  process.stdout.write(`GStack 2 parity passed: ${result.checks} checks; ${result.sources} sources, ${result.sections} sections, ${result.scenarios} scenarios, ${result.regressions} regressions, ${result.assets} assets, ${result.bashBlocks} linted bash blocks.\n`);
}
