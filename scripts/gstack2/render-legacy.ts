import * as fs from 'fs';
import * as path from 'path';
import { getHostConfig } from '../../hosts/index';
import { extractHookSafetyProse, extractNameAndDescription } from '../resolvers/codex-helpers';
import { RESOLVERS } from '../resolvers/index';
import { HOST_PATHS, unwrapResolver, type TemplateContext } from '../resolvers/types';
import { SOURCE_ASSIGNMENTS } from './assignments';
import { GSTACK2_BASE_SHA } from './types';

export const ROOT = path.resolve(import.meta.dir, '..', '..');

/** Convert a filesystem-relative path into Git's repository path format. */
export function normalizeRepositoryPath(relativePath: string): string {
  return relativePath.replaceAll(path.win32.sep, path.posix.sep);
}

export function repositoryRelativePath(absolutePath: string): string {
  return normalizeRepositoryPath(path.relative(ROOT, absolutePath));
}

// Working-tree sources renamed after the pinned base was cut still port their
// immutable pinned bytes. Map the current path back to the pinned path so both
// `pinnedText` and `blobShaForPath` resolve. The office-hours Phase 5/6 section
// dropped its `design-` filename prefix (it produces a "design doc", not a
// design REVIEW) so no ported path carries a `/design-` fragment.
const PINNED_PATH_RENAMES: Readonly<Record<string, string>> = {
  'office-hours/sections/doc-and-handoff.md.tmpl': 'office-hours/sections/design-and-handoff.md.tmpl',
};

export function pinnedRevisionPath(relativePath: string): string {
  const normalized = normalizeRepositoryPath(relativePath);
  return `${GSTACK2_BASE_SHA}:${PINNED_PATH_RENAMES[normalized] ?? normalized}`;
}

export function legacyTemplatePath(source: string): string {
  return source === 'gstack'
    ? path.join(ROOT, 'SKILL.md.tmpl')
    : path.join(ROOT, source, 'SKILL.md.tmpl');
}

export function legacyRelativePath(source: string): string {
  return repositoryRelativePath(legacyTemplatePath(source));
}

let pinnedBaseFetchAttempted = false;

function pinnedText(relativePath: string): string {
  const show = () => Bun.spawnSync({
    cmd: ['git', 'show', pinnedRevisionPath(relativePath)],
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let result = show();
  if (result.exitCode !== 0 && !pinnedBaseFetchAttempted) {
    // CI and shallow checkouts only fetch the PR refs; GSTACK2_BASE_SHA is
    // reachable from codex/* branches only, so its objects may be absent.
    // A depth-1 fetch of the pinned sha restores git show for every caller.
    pinnedBaseFetchAttempted = true;
    Bun.spawnSync({
      cmd: ['git', 'fetch', '--no-tags', '--depth=1', 'origin', GSTACK2_BASE_SHA],
      cwd: ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    result = show();
  }
  if (result.exitCode !== 0) throw new Error(`Unable to read ${relativePath} at ${GSTACK2_BASE_SHA}: ${result.stderr.toString()}`);
  return result.stdout.toString();
}

export function stripFrontmatter(content: string): string {
  if (!content.startsWith('---\n')) return content.trim();
  const end = content.indexOf('\n---', 4);
  if (end === -1) throw new Error('Unclosed template frontmatter');
  return content.slice(end + 4).trim();
}

function buildContext(tmplContent: string, tmplPath: string): TemplateContext {
  const { name } = extractNameAndDescription(tmplContent);
  const benefitsMatch = tmplContent.match(/^benefits-from:\s*\[([^\]]*)\]/m);
  const benefitsFrom = benefitsMatch
    ? benefitsMatch[1].split(',').map((value) => value.trim()).filter(Boolean)
    : undefined;
  const tierMatch = tmplContent.match(/^preamble-tier:\s*(\d+)$/m);
  const interactiveMatch = tmplContent.match(/^interactive:\s*(true|false)\s*$/m);
  return {
    skillName: name || path.basename(path.dirname(tmplPath)),
    tmplPath,
    benefitsFrom,
    host: 'codex',
    paths: HOST_PATHS.codex,
    preambleTier: tierMatch ? Number.parseInt(tierMatch[1], 10) : undefined,
    model: 'claude',
    interactive: interactiveMatch ? interactiveMatch[1] === 'true' : undefined,
    explainLevel: 'default',
  };
}

type ResolverOverrides = Readonly<Record<string, string>>;

function resolvePlaceholders(
  template: string,
  context: TemplateContext,
  relativePath: string,
  overrides: ResolverOverrides = {},
): string {
  const config = getHostConfig('codex');
  const suppressed = new Set(config.suppressedResolvers ?? []);
  const onePass = (input: string): string => input.replace(
    /\{\{(\w+(?::[^}]+)?)\}\}/g,
    (_match, fullKey: string) => {
      const [resolverName, ...args] = fullKey.split(':');
      if (Object.hasOwn(overrides, resolverName)) return overrides[resolverName];
      if (suppressed.has(resolverName)) return '';
      const entry = RESOLVERS[resolverName];
      if (!entry) throw new Error(`Unknown placeholder {{${resolverName}}} in ${relativePath}`);
      const { resolve, appliesTo } = unwrapResolver(entry);
      if (appliesTo && !appliesTo(context)) return '';
      return args.length ? resolve(context, args) : resolve(context);
    },
  );

  let content = template;
  for (let pass = 0; pass < 6; pass += 1) {
    const next = onePass(content);
    if (next === content) break;
    content = next;
  }
  const remaining = content.match(/\{\{(\w+(?::[^}]+)?)\}\}/g);
  if (remaining) throw new Error(`Unresolved placeholders in ${relativePath}: ${remaining.join(', ')}`);
  return content;
}

/**
 * The 1.x PREAMBLE resolver is host installation and engagement machinery, not
 * specialist judgment. It performs first-run writes, telemetry/proactive
 * prompts, update checks, model overlays, checkpoint promotion, artifact-sync
 * enrollment, and CLAUDE.md mutation. GStack 2 keeps that immutable expansion
 * as the parity oracle while deliberately excluding it from normal canonical
 * execution. Runtime and authority are owned once by package-local contracts.
 */
export const CANONICAL_EXCLUDED_RESOLVERS = ['PREAMBLE'] as const;

const RETIRED_ASSIGNMENTS = [...SOURCE_ASSIGNMENTS]
  .filter((entry) => !['plan', 'design', 'qa', 'debug', 'review', 'ship'].includes(entry.source))
  .sort((a, b) => b.source.length - a.source.length);

export function retiredInvocationPattern(): RegExp {
  const sources = RETIRED_ASSIGNMENTS
    .map((entry) => entry.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return new RegExp(`(?<![A-Za-z0-9_.-])/(?:${sources})(?=$|[\\s\\x60'\"),.;:*_|\\]}>])`);
}

export function replaceRetiredInvocations(value: string): string {
  let rewritten = value;
  for (const assignment of RETIRED_ASSIGNMENTS) {
    // A preceding word/path character means this slash is part of a file path
    // or URL, not an invocation. The trailing set includes Markdown emphasis,
    // table, and link punctuation in addition to prose punctuation.
    rewritten = rewritten.replace(
      new RegExp(`(?<![A-Za-z0-9_.-])/${assignment.source}(?=$|[\\s\\x60'\"),.;:*_|\\]}>])`, 'g'),
      assignment.replacement,
    );
  }
  return rewritten;
}

function renderCanonicalSpecialistBody(source: string): string {
  const templatePath = legacyTemplatePath(source);
  const relativePath = repositoryRelativePath(templatePath);
  const template = stripRetiredDesignPlaceholders(pinnedText(relativePath));
  const context = buildContext(template, templatePath);
  const overrides = Object.fromEntries(CANONICAL_EXCLUDED_RESOLVERS.map((name) => [name, '']));
  // Hook advisories are part of the host-specific 1.x wrapper. Canonical
  // authority/safety policy is generated once beside every public dispatcher.
  const body = stripFrontmatter(resolvePlaceholders(template, context, relativePath, overrides));
  return `${applyCodexRewrites(body).trim()}\n`;
}

function applyCodexRewrites(content: string): string {
  const config = getHostConfig('codex');
  let rewritten = content;
  for (const entry of config.pathRewrites) rewritten = rewritten.replaceAll(entry.from, entry.to);
  for (const [from, to] of Object.entries(config.toolRewrites ?? {})) rewritten = rewritten.replaceAll(from, to);
  return rewritten;
}

/**
 * Render a legacy template exactly as the canonical Codex host would render
 * its body: resolver expansion, non-Claude section inlining, safety prose, and
 * host rewrites. The legacy frontmatter and generated header are intentionally
 * excluded because GStack 2 owns the five public skill manifests.
 */
export function renderLegacyBody(source: string): string {
  const templatePath = legacyTemplatePath(source);
  const relativePath = repositoryRelativePath(templatePath);
  const template = stripRetiredDesignPlaceholders(pinnedText(relativePath));
  const context = buildContext(template, templatePath);
  let body = stripFrontmatter(resolvePlaceholders(template, context, relativePath));
  const safety = extractHookSafetyProse(template);
  // The pinned external-host generator inserts one newline after the advisory
  // in addition to the body's existing two-newline separation. Preserve that
  // exact byte shape so hook-bearing templates share the same immutable oracle.
  if (safety) body = `${safety}\n\n\n${body}`;
  return `${applyCodexRewrites(body).trim()}\n`;
}

/**
 * Apply only GStack 2 packaging/runtime mechanics to the immutable 1.x Codex
 * render. `renderLegacyBody()` remains the raw parity oracle; this function is
 * the installable port and every rewrite is separately asserted in parity.
 */
// Pinned-source -> current-tree rewrites that remove the plan-flow design-REVIEW
// offers. Search text is the pinned (pre-strip) form; replacement matches what the
// working-tree section templates now carry, so applying this to either the pinned
// section (ported) or the already-edited inlined section (parent body) converges.
const DESIGN_REVIEW_OFFER_REWRITES: Array<[string, string]> = [
  // office-hours/sections/design-and-handoff
  ['\n- visual/UX-heavy → "Next: `/plan-design-review` for a visual/UX pass."', ''],
  ['Completeness: A=10/10, B=9/10, C=8/10, D=3/10', 'Completeness: A=10/10, B=9/10, C=3/10'],
  ['C) Run /plan-design-review now\n  ✅ Catches visual/UX problems while they are still cheap plan-stage changes\n  ❌ Little value for backend-only or non-visual features\nD) Not now — I\'ll run a review later', 'C) Not now — I\'ll run a review later'],
  ["On the user's SELECTION of A/B/C (not on invocation success)", "On the user's SELECTION of A/B (not on invocation success)"],
  ['On D, log declined and stop:', 'On C, log declined and stop:'],
  // plan-ceo-review/sections/review-sections
  ["The CEO calling in the designer. Not a pixel-level audit — that's /plan-design-review and /design-review. This is ensuring the plan has design intentionality.", 'The CEO calling in the designer. Not a pixel-level audit. This is ensuring the plan has design intentionality.'],
  ['\nIf this plan has significant UI scope, recommend: "Consider running /plan-design-review for a deep design review of this plan before implementation."', ''],
  ['## Post-Implementation Design Audit (if UI scope detected)\nAfter implementation, run `/design-review` on the live site to catch visual issues that can only be evaluated with rendered output.\n\n', ''],
  ['**Recommend /plan-design-review if UI scope was detected** — specifically if Section 11 (Design & UX Review) was NOT skipped, or if accepted scope expansions included UI-facing features. If an existing design review is stale (commit hash drift), note that. In SCOPE REDUCTION mode, skip this recommendation — design review is unlikely relevant for scope cuts.\n\n**If both are needed, recommend eng review first** (required gate), then design review.\n\n', ''],
  ['- **A)** Run /plan-eng-review next (required gate)\n- **B)** Run /plan-design-review next (only if UI scope detected)\n- **C)** Skip — I\'ll handle reviews manually', '- **A)** Run /plan-eng-review next (required gate)\n- **B)** Skip — I\'ll handle reviews manually'],
  // plan-eng-review/sections/review-sections
  ["**Suggest /plan-design-review if UI changes exist and no design review has been run** — detect from the test diagram, architecture review, or any section that touched frontend components, CSS, views, or user-facing interaction flows. If an existing design review's commit hash shows it predates significant changes found in this eng review, note that it may be stale.\n\n", ''],
  ['**Note staleness** of existing CEO or design reviews if this eng review found assumptions that contradict them, or if the commit hash shows significant drift.', '**Note staleness** of an existing CEO review if this eng review found assumptions that contradict it, or if the commit hash shows significant drift.'],
  ['- **A)** Run /plan-design-review (only if UI scope detected and no design review exists)\n- **B)** Run /plan-ceo-review (only if significant product change and no CEO review exists)\n- **C)** Ready to implement — run /ship when done', '- **A)** Run /plan-ceo-review (only if significant product change and no CEO review exists)\n- **B)** Ready to implement — run /ship when done'],
  // plan-devex-review/sections/review-sections
  ['**Suggest /plan-design-review if user-facing UI exists** — DX review focuses on\ndeveloper-facing surfaces; design review covers end-user-facing UI.\n\n', ''],
  ['- **A)** Run /plan-eng-review next (required gate)\n- **B)** Run /plan-design-review (only if UI scope detected)\n- **C)** Ready to implement, run /devex-review after shipping\n- **D)** Skip, I\'ll handle next steps manually', '- **A)** Run /plan-eng-review next (required gate)\n- **B)** Ready to implement, run /devex-review after shipping\n- **C)** Skip, I\'ll handle next steps manually'],
  // plan-devex-review parent body: no-scope fallback line
  ['/plan-eng-review or /plan-design-review instead."', '/plan-eng-review instead."'],
  // gstack meta-skill routing table (root SKILL.md.tmpl): drop the design-REVIEW routes
  ['\n- User asks to review design of a plan → invoke `/plan-design-review`', ''],
  ['\n- User asks about visual polish, design audit of a live site, "this looks off" → invoke `/design-review`', ''],
  // ship/SKILL.md.tmpl parent body: drop the retired diff-scoped design-review-lite
  // mention. stripDesignReviewOfferings runs before portLegacyText rewrites
  // $GSTACK_ROOT/bin -> $GSTACK_BIN, so the search text carries the $GSTACK_ROOT form.
  ['\n\nFor Design Review: run `source <($GSTACK_ROOT/bin/gstack-diff-scope <base> 2>/dev/null)`. If `SCOPE_FRONTEND=true` and no design review (plan-design-review or design-review-lite) exists in the dashboard, mention: "Design Review not run — this PR changes frontend code. The lite design check will run automatically in Step 9, but consider running /design-review for a full visual audit post-implementation." Still never block.', ''],
  // land-and-deploy review-log parse list: drop the retired plan-design-review +
  // design-review-lite sources (both gone from the five-skill surface).
  ['plan-design-review, design-review-lite, codex-review, review, adversarial-review,', 'codex-review, review, adversarial-review,'],
  // land-and-deploy readiness dashboard box: drop the retired Design Review row.
  ['\n║  ├─ Design Review: CURRENT / — (optional)                ║', ''],
  // ship/sections/pr-body: drop the retired Design Review PR-body section.
  ['## Design Review\n<If design review ran: "Design Review (lite): N findings — M auto-fixed, K skipped. AI Slop: clean/N issues.">\n<If no frontend files changed: "No frontend files changed — design review skipped.">\n\n', ''],
  // open-gstack-browser: drop the retired /design-review from the headed-mode examples.
  ['`/qa`, `/design-review`, `/benchmark`', '`/qa`, `/benchmark`'],
  ['\n> - `/design-review` takes screenshots in the real browser — same pixels you see', ''],
  // gstack meta-skill routing (root SKILL.md.tmpl): drop the retired design-consultation route.
  ['\n- User asks about design system, brand, visual identity, "how should this look" → invoke `/design-consultation`', ''],
  // office-hours: the design-consultation specialist is retired; drop the pointer.
  [' (that\'s /design-consultation\'s job)', ''],
];

// The retired design-review-lite specialist is gone, so its `{{DESIGN_REVIEW_LITE}}`
// placeholder and the "include design findings" prose must be stripped from the
// pinned section template BEFORE placeholder resolution (an unregistered resolver
// throws). This converges the ported pinned section with the working-tree section.
export function stripRetiredDesignPlaceholders(template: string): string {
  return template
    // office-hours Phase 5/6 section lost its `design-` filename prefix (see
    // PINNED_PATH_RENAMES). The pinned parent still names it `design-and-handoff`
    // in its {{SECTION:...}} placeholder and prose pointer; converge both onto
    // the renamed section so nothing generated carries a `/design-` path.
    .replaceAll('design-and-handoff', 'doc-and-handoff')
    .replace(
      '{{DESIGN_REVIEW_LITE}}\n\n   Include any design findings alongside the code review findings. They follow the same Fix-First flow below.\n\n',
      '',
    )
    // office-hours: drop the design-binary visual-mockup path; the binary-free
    // {{DESIGN_SKETCH}} wireframe fallback below it is retained as the only
    // visual-exploration surface.
    .replace('{{DESIGN_MOCKUP}}\n\n', '');
}

function stripDesignReviewOfferings(value: string, source: string): string {
  let out = value;
  for (const [from, to] of DESIGN_REVIEW_OFFER_REWRITES) out = out.split(from).join(to);
  if (source === 'autoplan') out = stripAutoplanDesignPhase(out);
  return out;
}

// autoplan is a parent module (no carved sections), ported straight from the
// pinned source. The design REVIEW phase (CEO -> Design -> Eng -> DX) is retired;
// collapse the chain to CEO -> Eng -> DX and drop the design phase, its checklists,
// its review-log entries, and its consensus wiring so the ported plan module never
// runs or references a review that no longer exists. The in-review design-scope
// prose inside the surviving CEO section is untouched.
function stripAutoplanDesignPhase(value: string): string {
  return value
    .split('reads the full CEO, design, eng, and DX review skill files from disk').join('reads the full CEO, eng, and DX review skill files from disk')
    .split('Phases MUST execute in strict order: CEO → Design → Eng → DX.').join('Phases MUST execute in strict order: CEO → Eng → DX.')
    .split('- **Sequential order.** CEO → Design → Eng → DX. Each phase builds on the last.').join('- **Sequential order.** CEO → Eng → DX. Each phase builds on the last.')
    .replace('\n- **Design phase:** P5 (explicit) + P1 (completeness) dominate.', '')
    .replace('- Detect UI scope: grep the plan for view/rendering terms (component, screen, form,\n  button, modal, layout, dashboard, sidebar, nav, dialog). Require 2+ matches. Exclude\n  false positives ("page" alone, "UI" in acronyms).\n', '')
    .replace('\n- `~/.claude/skills/gstack/plan-design-review/SKILL.md` (only if UI scope detected)', '')
    .replace('\n- Design Outside Voices (parallel)', '')
    .replace('. UI scope: [yes/no]. DX scope:', '. DX scope:')
    .replace('- Section 11 (Design): run only if UI scope was detected in Phase 0', "- Section 11 (Design & UX): run per the CEO skill's own UI-scope skip condition")
    .replace('> Passing to Phase 2.', '> Passing to Phase 3 (Eng Review).')
    .replace('Do NOT begin Phase 2 until all Phase 1 outputs are written to the plan file', 'Do NOT begin Phase 3 until all Phase 1 outputs are written to the plan file')
    .replace('**Pre-Phase 2 checklist (verify before starting):**', '**Pre-Phase 3 checklist (verify before starting):**')
    .replace(/\n## Phase 2: Design Review \(conditional[\s\S]*?(?=\n## Phase 3: Eng Review \+ Dual Voices)/, '\n')
    .replace("\n  Design: <insert Design consensus table summary, or 'skipped, no UI scope'>", '')
    .replace(/\n\*\*Phase 2 \(Design\) outputs — only if UI scope detected:\*\*\n[\s\S]*?(?=\n\*\*Phase 3 \(Eng\) outputs)/, '')
    .replace('\n- Design: [summary or "skipped, no UI scope"]\n- Design Voices: Codex [summary], Claude subagent [summary], Consensus [X/7 confirmed] (or "skipped")', '')
    .replace('On approval, write 3 separate review log entries so /ship\'s dashboard recognizes them.', 'On approval, write a review log entry per phase that ran so /ship\'s dashboard recognizes them.')
    .replace(/\nIf Phase 2 ran \(UI scope\):\n```bash\n[^\n]*"skill":"plan-design-review"[^\n]*\n```\n/, '')
    .replace(/\nIf Phase 2 ran \(UI scope\), also log:\n```bash\n[^\n]*"phase":"design"[^\n]*\n```\n/, '');
}

function portLegacyText(value: string, source: string): string {
  if (source === 'gstack-upgrade') {
    return `# Legacy upgrade compatibility\n\nThe 1.x host-directory detector, vendored-copy synchronizer, and destructive Git replacement blocks were duplicated installation infrastructure. GStack 2 delegates skill placement and updates to the standard Agent Skills installer and manages the optional shared runtime atomically.\n\n- Update selected skills with \`npx skills add time-attack/gstack/skills\` using the user's existing project/global choice. Never infer or enroll a host.\n- Upgrade a complete local runtime package with \`gstack upgrade --source <complete-gstack-package> --version <version>\`.\n- Roll back the runtime with \`gstack upgrade --rollback\`.\n- Run \`gstack doctor\` after either operation.\n- Do not reset, delete, move, or rewrite a host skill directory. Do not infer Context.dev choice or consent.\n\nThis compatibility module contains no specialist judgment; release readiness and rollback judgment remain in the preserved ship modules.\n`;
  }
  let body = value;

  // Design REVIEW offerings are retired from the five-skill surface (the /design
  // public skill and its plan-design-review / design-review specialists are gone;
  // autoplan orchestrates CEO -> engineering -> DX only). Strip the plan-flow
  // "run a design review" offers here, before the retired-invocation and host-path
  // rewrites, so the ported plan modules never recommend a review that no longer
  // exists. Each rewrite maps the pinned source text to the same text the working
  // tree now carries, so the carve of the inlined (already-edited) section and the
  // ported pinned section converge on an identical, offer-free body. The preserved
  // in-review design intentionality prose (office-hours handoff, CEO Section 11) is
  // intentionally left as historical judgment; only the review OFFER is removed.
  body = stripDesignReviewOfferings(body, source);

  // Retired names remain valid only as opt-in compatibility aliases. Normal
  // canonical execution must recommend one of the five public routes, with the
  // exact internal refinement retained for deterministic dispatch.
  body = replaceRetiredInvocations(body);

  // The /design public skill and its plan-design-review specialist are retired
  // in the five-skill surface. Autoplan orchestrates CEO -> engineering -> DX
  // only. De-reference the removed design-review module so the canonical carve
  // never packages or instructs a module that no longer exists; the surrounding
  // preserved design-scope prose is left as historical context. This runs
  // before the generic host-path -> references/legacy rewrite below so the
  // dangling module pointer is neutralized rather than repackaged.
  body = body
    .replaceAll(
      '$GSTACK_ROOT/plan-design-review/SKILL.md',
      'the retired plan design phase (removed from the five public skills; skip it)',
    )
    .replaceAll(
      'Follow plan-design-review/SKILL.md — all 7 dimensions, full depth.',
      'The plan design phase is retired from the five public skills; skip it and continue with the CEO, engineering, and DX reviews.',
    );
  // Every state read/write follows the canonical override. Quote the root so
  // custom homes containing spaces remain valid. Compatibility pointer files
  // such as ~/.gstack-artifacts-remote.txt are outside this state root and are
  // intentionally not matched by the slash/exact-path boundaries.
  body = body
    .replace(/"\$\{HOME\}\/\.gstack(?=\/|")/g, '"${GSTACK_HOME:-$HOME/.gstack}')
    .replace(/"\$HOME\/\.gstack(?=\/|")/g, '"${GSTACK_HOME:-$HOME/.gstack}')
    .replace(/\$\{HOME\}\/\.gstack(?=\/|[\s`'"),.;:\]}])/g, '"${GSTACK_HOME:-$HOME/.gstack}"')
    .replace(/(?<![-"{])\$HOME\/\.gstack(?=\/|[\s`'"),.;:\]}])/g, '"${GSTACK_HOME:-$HOME/.gstack}"')
    .replace(/~\/\.gstack(?=\/|[\s`'"),.;:\]}])/g, '"${GSTACK_HOME:-$HOME/.gstack}"');

  // SLUG remains a human-facing/repository namespace for remote GBrain data,
  // but it is not a safe local state key: linked worktrees share the same
  // remote slug. Mechanically port only paths rooted in the canonical local
  // state directory to the worktree-safe PROJECT_ID emitted by gstack-slug.
  body = body.replace(
    /((?:"\$\{GSTACK_HOME:-\$HOME\/\.gstack\}"|\$\{GSTACK_HOME:-\$HOME\/\.gstack\}|\$GSTACK_STATE_ROOT|\$\{GSTACK_STATE_ROOT\}|\$GSTACK_HOME)\/projects\/)(\$\{SLUG:-unknown\}|\$SLUG\b|\$_PLAN_SLUG\b|<slug>|\{slug\})/g,
    (_match, prefix: string, key: string) => `${prefix}${key === '<slug>' || key === '{slug}' ? '<stable-project-id>' : '${PROJECT_ID:-unknown}'}`,
  );
  for (const section of legacySections().filter((entry) => entry.source === source)) {
    const filename = path.basename(section.relativePath).replace(/\.tmpl$/, '');
    const localSection = `references/sections/${source}/${filename}`;
    const marker = `__GSTACK2_SECTION_${source}_${filename}__`;
    body = body
      .replaceAll(`~/.claude/skills/gstack/${source}/sections/${filename}`, marker)
      .replaceAll(`$GSTACK_ROOT/${source}/sections/${filename}`, marker)
      .replaceAll(`\${CLAUDE_SKILL_DIR}/sections/${filename}`, marker)
      .replaceAll(`sections/${filename}`, marker)
      .replaceAll(marker, localSection);
  }

  // Skill-to-skill reads must resolve inside a selected canonical package,
  // never through a retired host-specific installation root.
  body = body
    .replace(/~\/\.claude\/skills\/gstack\/([a-z0-9-]+)\/SKILL\.md/g, 'references/legacy/$1.md')
    .replace(/\$GSTACK_ROOT\/([a-z0-9-]+)\/SKILL\.md/g, 'references/legacy/$1.md')
    .replace(/\$\{CLAUDE_SKILL_DIR\}\/\.\.\/([a-z0-9-]+)\/SKILL\.md/g, 'references/legacy/$1.md')
    .replace(/\$CLAUDE_SKILL_DIR\/\.\.\/([a-z0-9-]+)\/SKILL\.md/g, 'references/legacy/$1.md');

  // Small read-on-demand policy artifacts are part of every selected skill.
  // Keeping them package-local prevents a standards-native install from
  // reaching back into a source checkout or another host's skill directory.
  body = body
    .replaceAll('$GSTACK_ROOT/ETHOS.md', 'references/support/ETHOS.md')
    .replaceAll('docs/askuserquestion-split.md', 'references/support/docs/askuserquestion-split.md')
    .replaceAll('docs/askuserquestion-cjk.md', 'references/support/docs/askuserquestion-cjk.md')
    .replaceAll('$GSTACK_ROOT/scripts/jargon-list.json', '__GSTACK2_JARGON_LIST__')
    .replaceAll('scripts/jargon-list.json', '__GSTACK2_JARGON_LIST__')
    .replaceAll('__GSTACK2_JARGON_LIST__', 'references/support/scripts/jargon-list.json');
  body = body
    .replaceAll('scripts/question-registry.ts', 'references/support/scripts/question-registry.ts')
    .replaceAll('lib/redact-patterns.ts', 'references/support/lib/redact-patterns.ts');

  // Specialist-linked assets keep their pinned bytes but move under the
  // selected package. Executable runtime helpers remain under GSTACK_HOME.
  body = body
    .replaceAll('$GSTACK_ROOT/plan-devex-review/dx-hall-of-fame.md', 'references/artifacts/plan-devex-review/dx-hall-of-fame.md')
    .replaceAll('$GSTACK_ROOT/review/checklist.md', 'references/artifacts/review/checklist.md')
    .replaceAll('$GSTACK_ROOT/ios-qa/templates/', 'references/artifacts/ios-qa/templates/')
    .replaceAll('ios-qa/docs/tailscale-acl-example.md', 'references/artifacts/ios-qa/docs/tailscale-acl-example.md');

  // The optional runtime is installed once per user and is independent from
  // standards-native skill placement. Preserve helper behavior while removing
  // every Claude/Codex/project-specific runtime-root assumption.
  body = body
    .replaceAll('$GSTACK_ROOT/bin/', '$GSTACK_BIN/')
    .replaceAll(
      'GSTACK_ROOT="$HOME/.codex/skills/gstack"',
      'GSTACK_HOME="${GSTACK_HOME:-$HOME/.gstack}"\nGSTACK_ROOT="$GSTACK_HOME"',
    )
    .replaceAll(
      '[ -n "$_ROOT" ] && [ -d "$_ROOT/.agents/skills/gstack" ] && GSTACK_ROOT="$_ROOT/.agents/skills/gstack"',
      ': "GStack 2 runtime is user-scoped; Agent Skills placement is installer-owned"',
    )
    .replaceAll('.agents/skills/gstack/bin/gstack-update-check', '$GSTACK_BIN/gstack-update-check')
    .replaceAll('$GSTACK_ROOT/browse/bin/remote-slug', '$GSTACK_BIN/remote-slug')
    .replaceAll('$GSTACK_ROOT/browse/dist/browse', '$GSTACK_BIN/browse')
    .replaceAll('$GSTACK_ROOT/browse/dist', '$GSTACK_BIN')
    .replaceAll('$GSTACK_ROOT/lib/redact-audit-log.ts', '$GSTACK_BIN/gstack-redact-audit-log')
    .replaceAll('bun $GSTACK_BIN/gstack-redact-audit-log', '$GSTACK_BIN/gstack-redact-audit-log')
    .replaceAll('Disk paths stay `$GSTACK_ROOT/[skill-name]/SKILL.md`.', 'Resolve retired names through `references/COMPATIBILITY.md`; skill placement is installer-owned.')
    .replaceAll('Tell the user: "Done. Each developer now runs: `cd $GSTACK_ROOT && ./setup --team`"', 'Tell the user: "Done. Each developer installs the selected canonical skills with `npx skills add time-attack/gstack/skills`; the optional runtime remains user-scoped."');

  body = body
    .replace(/_VENDORED="no"\nif \[ -d "\.agents\/skills\/gstack" \][\s\S]*?echo "VENDORED_GSTACK: \$_VENDORED"/g, '_VENDORED="managed-by-standard-installer"\necho "VENDORED_GSTACK: $_VENDORED"')
    .replace(/If `VENDORED_GSTACK` is `yes`, warn once[\s\S]*?If marker exists, skip\./g, 'GStack 2 delegates skill placement, updates, and removal to the standard Agent Skills installer. Never inspect, delete, commit, or migrate a host-specific skill directory from a judgment workflow.')
    .replaceAll('"$_ROOT/.agents/skills/gstack/browse/dist/browse"', '"$GSTACK_BIN/browse"')
    .replaceAll('"$HOME/.agents/skills/gstack/browse/dist/browse"', '"$GSTACK_BIN/browse"')
    .replaceAll('`$_ROOT/.agents/skills/gstack/browse/dist/browse` or `$GSTACK_BIN/browse`', '`$GSTACK_BIN/browse`')
    .replaceAll('BIN="$HOME/.agents/skills/gstack/bin/gstack-model-benchmark"', 'BIN="$GSTACK_BIN/gstack-model-benchmark"')
    .replaceAll('[ -x "$BIN" ] || BIN=".agents/skills/gstack/bin/gstack-model-benchmark"', ': "model benchmark helper resolves from the managed runtime"')
    .replaceAll('ERROR: gstack-model-benchmark not found. Run ./setup in the gstack install dir.', 'ERROR: gstack-model-benchmark not found. Install the optional runtime, then run gstack doctor.')
    .replaceAll('[ -z "$DISCOVER_BIN" ] && [ -x .agents/skills/gstack/bin/gstack-global-discover ] && DISCOVER_BIN=.agents/skills/gstack/bin/gstack-global-discover', '[ -z "$DISCOVER_BIN" ] && [ -x "$GSTACK_BIN/gstack-global-discover" ] && DISCOVER_BIN="$GSTACK_BIN/gstack-global-discover"')
    .replaceAll('~/.codex/skills/gstack/browse-remote.json', '${GSTACK_HOME:-$HOME/.gstack}/browse-remote.json')
    .replaceAll('${HOME}/.agents/skills/gstack/document-release/SKILL.md', 'references/legacy/document-release.md');

  // The managed runtime owns a pinned Bun executable. Remove the old
  // per-skill curl installer and route GStack-owned helpers through their
  // stable launchers. Project-owned commands such as a repository's `bun
  // test` are intentionally untouched.
  body = body
    .replace(
      /3\. If `bun` is not installed:\n\s+```bash\n[\s\S]*?\n\s+```/g,
      '3. The approved managed runtime includes its own pinned Bun at `$GSTACK_BIN/bun`; never download or install another Bun from a skill workflow.',
    )
    .replaceAll('bun run $GSTACK_BIN/gstack-gbrain-sync.ts', '$GSTACK_BIN/gstack-gbrain-sync')
    .replaceAll('bun run $GSTACK_BIN/gstack-next-version', '$GSTACK_BIN/gstack-next-version')
    .replaceAll('bun run $GSTACK_BIN/gstack-version-bump', '$GSTACK_BIN/gstack-version-bump')
    .replaceAll('DISCOVER_BIN="bun run $GSTACK_BIN/gstack-global-discover"', 'DISCOVER_BIN="$GSTACK_BIN/gstack-global-discover"')
    .replaceAll('Tell the user: "gstack browse needs a one-time build (~10 seconds). OK to proceed?" Then STOP and wait.', 'Tell the user: "The browser-backed capability is not ready. Do you want to see the local setup options—GStack-managed Chromium or a detected installed Chromium executable—with no network access or changes?" Then STOP and wait.')
    .replaceAll('Tell the user: "The optional managed headless browser capability is missing. Do you want to preview its exact dependency-closed component plan and compressed bytes now?" Then STOP and wait.', 'Tell the user: "The browser-backed capability is not ready. Do you want to see the local setup options—GStack-managed Chromium or a detected installed Chromium executable—with no network access or changes?" Then STOP and wait.')
    .replace(/^command -v bun >\/dev\/null 2>&1 \|\| echo "redaction scan skipped — bun not on PATH"\n/gm, '');

  body = body
    .replaceAll(
      'Run: `cd <SKILL_DIR> && ./setup`',
      'Read `references/RUNTIME.md` and follow its explicit capability bootstrap. Never assume a standard-installed skill directory contains `./setup`.',
    )
    .replaceAll(
      'run `cd <SKILL_DIR> && ./setup`',
      'read `references/RUNTIME.md` and follow its explicit capability bootstrap; never assume a standard-installed skill directory contains `./setup`',
    )
    .replaceAll(
      'Run `cd <SKILL_DIR> && ./setup`',
      'Read `references/RUNTIME.md` and follow its explicit capability bootstrap. Never assume a standard-installed skill directory contains `./setup`.',
    );

  for (const helper of [
    'gstack-codex-probe',
    'gstack-global-discover.ts',
    'gstack-next-version',
    'gstack-paths',
    'gstack-pr-title-rewrite.sh',
    'gstack-question-log',
    'gstack-question-preference',
  ]) {
    const stableName = helper === 'gstack-global-discover.ts' ? 'gstack-global-discover' : helper;
    body = body.replaceAll(`bin/${helper}`, `$GSTACK_BIN/${stableName}`);
  }
  body = body
    .replaceAll('bun run $GSTACK_BIN/gstack-gbrain-sync.ts', '$GSTACK_BIN/gstack-gbrain-sync')
    .replaceAll('bun run $GSTACK_BIN/gstack-gbrain-sync', '$GSTACK_BIN/gstack-gbrain-sync')
    .replaceAll('bun run $GSTACK_BIN/gstack-next-version', '$GSTACK_BIN/gstack-next-version')
    .replaceAll('bun run $GSTACK_BIN/gstack-version-bump', '$GSTACK_BIN/gstack-version-bump')
    .replaceAll('DISCOVER_BIN="bun run $GSTACK_BIN/gstack-global-discover"', 'DISCOVER_BIN="$GSTACK_BIN/gstack-global-discover"');

  body = body.replace(
    /_EXT_PATH=""\n_ROOT=\$\(git rev-parse --show-toplevel 2>\/dev\/null\)\n\[ -n "\$_ROOT" \][\s\S]*?echo "EXTENSION_PATH: \$\{_EXT_PATH:-NOT FOUND\}"/,
    '_EXT_PATH=$($GSTACK_BIN/gstack runtime path extension 2>/dev/null || true)\necho "EXTENSION_PATH: ${_EXT_PATH:-NOT FOUND}"',
  );
  body = body
    .replaceAll('--package-path "$GSTACK_HOME/ios-qa/scripts/gen-accessors-tool"', '--package-path "$($GSTACK_BIN/gstack runtime path ios-qa/scripts/gen-accessors-tool)"')
    .replaceAll('--package-path $GSTACK_HOME/ios-qa/scripts/gen-accessors-tool', '--package-path "$($GSTACK_BIN/gstack runtime path ios-qa/scripts/gen-accessors-tool)"')
    .replaceAll('`$GSTACK_HOME/ios-qa/.gstack-version` (or the\n   value baked into the installed gstack binary)', 'the version reported by `$GSTACK_BIN/gstack --version`')
    .replaceAll('`$GSTACK_HOME/ios-qa/templates/<Name>.swift.template`', '`references/artifacts/ios-qa/templates/<Name>.swift.template`')
    .replaceAll('Use the helper at `browse/src/browser-skill-write.ts`.', 'Resolve the managed helper first with `GSTACK_BROWSER_SKILL_WRITE=$($GSTACK_BIN/gstack runtime path browse/src/browser-skill-write.ts)` and use that exact path.')
    .replaceAll('<gstack-install>/browse/src/browser-skill-write', '<resolved GSTACK_BROWSER_SKILL_WRITE path>');

  for (const filename of ['TODOS-format.md', 'checklist.md', 'greptile-triage.md']) {
    const marker = `__GSTACK2_REVIEW_ASSET_${filename}__`;
    body = body
      .replaceAll(`.agents/skills/gstack/review/${filename}`, marker)
      .replace(new RegExp(`(?<!references/artifacts/)review/${filename.replace('.', '\\.')}`, 'g'), marker)
      .replaceAll(marker, `references/artifacts/review/${filename}`);
  }

  // The managed runtime installs stable launchers in one canonical user bin.
  body = body
    .replaceAll('$HOME$GSTACK_BROWSE/browse', '${GSTACK_HOME:-$HOME/.gstack}/bin/browse');

  if (source === 'careful') {
    body = body.replace(
      'Every Bash command is automatically checked against destructive patterns. When a dangerous command is detected, you MUST use AskUserQuestion to warn the user and get confirmation before proceeding.',
      'Treat destructive-command checking as inline advisory policy unless the active host explicitly confirms that the GStack hook is installed. You MUST use AskUserQuestion to warn the user and get confirmation before proceeding, and never claim that every Bash command was intercepted when no hook is active.',
    );
  }

  // Canonical skills do not run engagement instrumentation. Remove the few
  // source-local remnants that are outside {{PREAMBLE}} while leaving actual
  // specialist reports, requested context saves, and explicit setup modules
  // intact.
  body = body.replace(/```bash\n([\s\S]*?)```/g, (block, commands: string) => {
    const writesAnalytics = /(?:mkdir\s+-p|>>)[^\n]*\/(?:analytics|skill-usage\.jsonl)/.test(commands);
    return writesAnalytics
      ? 'Canonical execution does not write engagement analytics or telemetry.'
      : block;
  });
  body = body
    .replace(/^.*gstack-telemetry-log.*\n?/gm, '')
    .replace(/^\s*_gstack_codex_log_event\s+.*\n?/gm, '')
    .replace(/^_TEL=\$\([^\n]*\)$/gm, '_TEL=off # Canonical execution does not emit GStack telemetry.')
    .replace(/Best-effort, record which way you routed[\s\S]*?directly, no skill matched\):\nCanonical execution does not write engagement analytics or telemetry\.\n*/g, '')
    .replace(/If `PROACTIVE` is `false`:[\s\S]*?Use the Skill tool to invoke it\. The skill has specialized workflows, checklists, and\nquality gates that produce better results than answering inline\.\n\n/g, '')
    .replace(/\nIf the user opts out of suggestions,[\s\S]*?gstack-config set proactive true`\.\n?/g, '\n')
    .replace(/#### TTHW telemetry \(DX11\/F7\)[\s\S]*?\n---\n/g, '---\n')
    .replace(/\n3\. Append metrics:\nCanonical execution does not write engagement analytics or telemetry\.\nReplace ITERATIONS,[\s\S]*?actual values from the review\.\n/g, '\n3. Report the iteration counts and quality score in the user-facing result; do not persist engagement analytics.\n');

  return `${body.trim()}\n`;
}

export function renderPortedLegacyBody(source: string): string {
  let body = portLegacyText(renderCanonicalSpecialistBody(source), source);
  if (source === 'make-pdf') {
    body = [
      '## Optional runtime binding',
      '',
      'This workflow requires the `pdf` capability. Read `references/RUNTIME.md` before attempting installation. Pure planning or document review can continue without it.',
      'If unavailable, follow the consent-first `pdf` capability handoff in `references/RUNTIME.md`. It expands to `pdf`, `diagram`, and `browser`; do not guess a checkout-relative setup command.',
      '',
      body,
    ].join('\n');
  }
  body = body.replace(
    '`./setup` auto-installs `fonts-noto-color-emoji` on Linux',
    'the explicitly approved `pdf` runtime capability attempts to install `fonts-noto-color-emoji` on Linux',
  );
  if (['open-gstack-browser', 'pair-agent', 'setup-browser-cookies'].includes(source)) {
    body = [
      '## Visible-browser point-of-use gate',
      '',
      'This workflow may require internal `browser-visible` because it reaches a headed browser, extension, interactive cookie picker, or browser handoff. Do not offer visible Chromium during ordinary headless QA.',
      '',
      'At the first actual visible-browser step, run the local-only `node references/support/runtime-bootstrap.mjs options --capability browser-visible`, explain that this extension-bearing flow requires managed Chromium because installed Chrome-family builds can block automation extension loading, and ask whether the user wants to check exact official sizes. Disclose that an uncached preview makes one public GitHub signed-manifest request and sends no repository/private data, then STOP. Only after approval run `node references/support/runtime-bootstrap.mjs preview --capability browser-visible --browser managed`. It expands to `core + browser-code + browser-visible` for a first install, but an existing verified headless runtime downloads only missing `browser-visible`; it never requires `browser-headless`. Show the exact missing components and summed incremental compressed bytes, then STOP again for separate install approval. Only after install approval run `node references/support/runtime-bootstrap.mjs install --capability browser-visible --browser managed --yes`, recheck readiness, and resume the interrupted step.',
      '',
      body,
    ].join('\n');
  }
  if (/\$(?:GSTACK_BIN|GSTACK_ROOT|GSTACK_STATE_ROOT)\b|\$B\b/.test(body)) {
    const bindings = [
      '## Host-neutral runtime bindings',
      '',
      'These assignments select stable paths only; they do not install anything or grant consent:',
      '',
      '```bash',
      'GSTACK_HOME="${GSTACK_HOME:-$HOME/.gstack}"',
      'GSTACK_ROOT="$GSTACK_HOME"',
      'GSTACK_STATE_ROOT="$GSTACK_HOME"',
      'GSTACK_BIN="$GSTACK_HOME/bin"',
      'BUN_CMD="$GSTACK_BIN/bun"',
      'B="$GSTACK_BIN/browse"',
      'P="$GSTACK_BIN/make-pdf"',
      '```',
      '',
    ].join('\n');
    body = `${bindings}${body}`;
  }
  // Large specialist phases remain byte-derived from the pinned source, but
  // are packaged as lazy references instead of duplicated inline. The active
  // workflow loads one only when it reaches that phase.
  for (const section of legacySections().filter((entry) => entry.source === source)) {
    const ported = portLegacyText(section.rendered, section.source).trim();
    const filename = path.basename(section.relativePath).replace(/\.tmpl$/, '');
    const reference = `references/sections/${source}/${filename}`;
    const directive = [
      `## Lazy specialist phase: ${filename.replace(/\.md$/, '')}`,
      '',
      `When the workflow reaches this phase, read \`${reference}\` completely and execute it before continuing. Do not summarize or skip its questions, pressure, gates, evidence, artifacts, mutation boundary, or exit behavior.`,
    ].join('\n');
    if (!body.includes(ported)) throw new Error(`Unable to carve canonical section ${section.relativePath} from ${source}`);
    body = body.replace(ported, directive);
  }
  return `${body.trim()}\n`;
}

export function renderPortedLegacySection(section: LegacySection): string {
  return portLegacyText(section.rendered, section.source);
}

/** Apply host-neutral runtime-path mechanics to linked text assets. */
export function renderPortedAssetBytes(relativePath: string, input: Uint8Array): Uint8Array {
  // The question registry ports as-is except for the retired /plan-design-review
  // entries: that skill is gone from the five-skill surface, so its question ids
  // can never fire. Drop them (and the header mention) so the ported metadata does
  // not reference a removed skill.
  if (relativePath === 'scripts/question-registry.ts') {
    const text = Buffer.from(input).toString('utf8')
      .replace(' * ship, review, office-hours, plan-ceo-review, plan-eng-review, plan-design-review,\n * plan-devex-review', ' * ship, review, office-hours, plan-ceo-review, plan-eng-review,\n * plan-devex-review')
      .replace(`  // -----------------------------------------------------------------------\n  // /plan-design-review — UI/UX plan audit\n  // -----------------------------------------------------------------------\n  'plan-design-review-mode': {\n    id: 'plan-design-review-mode',\n    skill: 'plan-design-review',\n    category: 'routing',\n    door_type: 'two-way',\n    options: ['expand', 'polish', 'triage'],\n    signal_key: 'design-care',\n    description: "Design review depth: expand for competitive edge, polish every touchpoint, or triage critical gaps?",\n  },\n  'plan-design-review-fix': {\n    id: 'plan-design-review-fix',\n    skill: 'plan-design-review',\n    category: 'approval',\n    door_type: 'two-way',\n    options: ['fix-now', 'defer', 'skip'],\n    signal_key: 'design-care',\n    description: "Design issue flagged — fix now, defer to TODOs, or skip?",\n  },\n\n`, '');
    return Buffer.from(text, 'utf8');
  }
  if (!relativePath.endsWith('.md')) return input;
  const ported = replaceRetiredInvocations(Buffer.from(input).toString('utf8')
    .replaceAll(
      '~/.claude/skills/gstack/bin/gstack-diff-scope',
      '${GSTACK_HOME:-$HOME/.gstack}/bin/gstack-diff-scope',
    )
    .replaceAll(
      'browse/bin/remote-slug 2>/dev/null || ~/.claude/skills/gstack/browse/bin/remote-slug',
      '${GSTACK_HOME:-$HOME/.gstack}/bin/remote-slug',
    ));
  return Buffer.from(ported, 'utf8');
}

export interface LegacySection {
  source: string;
  absolutePath: string;
  relativePath: string;
  rendered: string;
}

let cachedLegacySections: LegacySection[] | undefined;

export function legacySections(): LegacySection[] {
  if (cachedLegacySections) return cachedLegacySections;
  const sections: LegacySection[] = [];
  for (const sourceDir of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!sourceDir.isDirectory()) continue;
    const sectionDir = path.join(ROOT, sourceDir.name, 'sections');
    if (!fs.existsSync(sectionDir)) continue;
    const parentPath = legacyTemplatePath(sourceDir.name);
    if (!fs.existsSync(parentPath)) continue;
    const parent = pinnedText(repositoryRelativePath(parentPath));
    const context = buildContext(parent, parentPath);
    for (const file of fs.readdirSync(sectionDir).filter((name) => name.endsWith('.md.tmpl')).sort()) {
      const absolutePath = path.join(sectionDir, file);
      const relativePath = repositoryRelativePath(absolutePath);
      const template = stripRetiredDesignPlaceholders(pinnedText(relativePath));
      const rendered = `${applyCodexRewrites(resolvePlaceholders(template, context, relativePath)).trim()}\n`;
      sections.push({ source: sourceDir.name, absolutePath, relativePath, rendered });
    }
  }
  cachedLegacySections = sections.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return cachedLegacySections;
}

export function sourceBlobSha(source: string): string {
  return blobShaForPath(legacyRelativePath(source));
}

export function blobShaForPath(relativePath: string): string {
  const result = Bun.spawnSync({
    cmd: ['git', 'rev-parse', pinnedRevisionPath(relativePath)],
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(`Unable to resolve ${relativePath} at ${GSTACK2_BASE_SHA}: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}
