## Host-neutral runtime bindings

These assignments select stable paths only; they do not install anything or grant consent:

```bash
GSTACK_HOME="${GSTACK_HOME:-$HOME/.gstack}"
GSTACK_ROOT="$GSTACK_HOME"
GSTACK_STATE_ROOT="$GSTACK_HOME"
GSTACK_BIN="$GSTACK_HOME/bin"
BUN_CMD="$GSTACK_BIN/bun"
B="$GSTACK_BIN/browse"
P="$GSTACK_BIN/make-pdf"
```
## Step 0: Detect platform and base branch

First resolve the repository's own remote as `<remote>` using
`references/BASE-DETECTION.md` — never assume `origin` exists, and empty means a
local-only repo, which is a supported case. Then detect the git hosting platform
from that remote's URL:

```bash
git remote get-url <remote> 2>/dev/null
```

- If the URL contains "github.com" → platform is **GitHub**
- If the URL contains "gitlab" → platform is **GitLab**
- Otherwise, check CLI availability:
  - `gh auth status 2>/dev/null` succeeds → platform is **GitHub** (covers GitHub Enterprise)
  - `glab auth status 2>/dev/null` succeeds → platform is **GitLab** (covers self-hosted)
  - Neither → **unknown** (use git-native commands only)

Determine which branch this PR/MR targets, or the repo's default branch if no
PR/MR exists. Use the result as "the base branch" in all subsequent steps.

Resolve the remote and the base branch with the order in
`references/BASE-DETECTION.md`: a base the user named, then the open PR/MR
target, the remote's own HEAD, the platform CLI's default branch, the local
default branch, the current branch's upstream, and finally "no separate base
branch" scoped to the working tree. Stop at the first candidate that
`git rev-parse --verify` confirms exists. Never substitute a hardcoded `main`,
`master`, or `origin/main`, and never assume the remote is named `origin`.

Print the detected remote (or "none") and the detected base branch name. In every
subsequent `git diff`, `git log`, `git fetch`, `git merge`, and PR/MR creation
command, substitute the detected branch name wherever the instructions say "the
base branch" or `<default>`, and the detected remote wherever they say
`<remote>`.

---

# Document Generate: Diataxis Documentation Writer

You are running the `$ship --mode Prepare --module document-generate` workflow. Your job: produce **high-quality,
structured documentation** for features, modules, or an entire project. You research
the code thoroughly before writing a single line of documentation.

This skill can be invoked two ways:
1. **Standalone** — the user points you at a feature, module, or project and says "document this"
2. **From $ship --mode Prepare --module document-release** — the coverage map identified gaps; you fill them

You follow the **Diataxis framework** — four quadrants of documentation, each serving a
different reader need:
- **Tutorial** — learning-oriented, walks a newcomer through a working example step-by-step
- **How-to** — task-oriented, shows how to accomplish a specific goal (assumes basic familiarity)
- **Reference** — information-oriented, complete and accurate technical description
- **Explanation** — understanding-oriented, explains why things work the way they do

**Philosophy: research the whole, then write the parts.** Like an architect who surveys the
entire site before drawing a single room, you read the full codebase surface before writing
any documentation. This prevents the "documentation that describes half the feature" failure mode.

---

## Step 0: Scope & Intent

1. Determine what to document:
   - **If invoked with a specific target** (feature, module, file, skill): scope is that target
   - **If invoked for an entire project**: scope is the full project
   - **If called from $ship --mode Prepare --module document-release with gaps**: scope is the specific entities from the coverage map

2. Use AskUserQuestion to confirm scope and ask about documentation target:

   - A) Write documentation inline in existing files (README, ARCHITECTURE, etc.)
   - B) Create standalone documentation files (e.g., `docs/` directory)
   - C) Both — inline summaries in existing files + deep docs in standalone files

   RECOMMENDATION: Choose C because it maximizes both discoverability and depth.

3. Determine the output format:
   - If the project already has a `docs/` directory, follow its conventions
   - If the project uses a doc framework (Nextra, Docusaurus, MkDocs, VitePress), follow its format
   - Otherwise, use plain Markdown files in `docs/`

---

## Step 1: Codebase Archaeology (Research Phase)

**This is the most important step.** Do not skip or rush it. The quality of your documentation
is directly proportional to how well you understand the code.

1. **Map the project structure:**

```bash
find . -type f -not -path "./.git/*" -not -path "./node_modules/*" -not -path "./.gstack/*" -not -path "./dist/*" -not -path "./build/*" -not -path "./.next/*" | head -200
```

2. **Read the entry points.** Identify and read:
   - README.md, ARCHITECTURE.md, CONTRIBUTING.md, CLAUDE.md / AGENTS.md
   - package.json / Cargo.toml / pyproject.toml / go.mod (understand the project type)
   - Main entry files (index.ts, main.rs, app.py, cmd/main.go)
   - Configuration files and examples

3. **Read the source code for each target entity.** For each feature/module you're documenting:
   - Read the implementation files end-to-end (not just signatures)
   - Read the tests — they reveal intended behavior, edge cases, and usage patterns
   - Read related modules that the target depends on or is depended upon by
   - Read any existing inline comments, especially `// NOTE:`, `// DESIGN:`, `// WHY:`

4. **Build a concept map.** Before writing, produce an internal outline:

```
Target: [feature/module name]
Purpose: [one sentence — what problem does it solve?]
Key concepts: [list the 3-5 concepts a reader must understand]
Public surface: [commands, functions, config options, API endpoints]
Dependencies: [what it needs from other modules]
Dependents: [what relies on it]
Edge cases: [from reading tests and code]
Design decisions: [any non-obvious "why" choices]
```

5. Output: "Researched N files, identified K public surface items, M concepts, and J design decisions."

---

## Step 2: Diataxis Partitioning

For each target entity, decide which Diataxis quadrants to produce. Not every entity needs all four.

**Decision matrix:**

| Entity type | Tutorial? | How-to? | Reference? | Explanation? |
|---|---|---|---|---|
| New feature a user interacts with | ✅ | ✅ | ✅ | Maybe |
| CLI command or flag | Maybe | ✅ | ✅ | No |
| Internal module/architecture | No | No | ✅ | ✅ |
| Config option | No | ✅ | ✅ | No |
| Design pattern / philosophy | No | No | No | ✅ |
| API endpoint | Maybe | ✅ | ✅ | No |
| Workflow (multi-step process) | ✅ | ✅ | No | Maybe |

Output the partition plan:

```
Documentation plan:
  [entity]              [tutorial] [how-to] [reference] [explanation]
  Widget system         ✅ new     ✅ new   ✅ new      ✅ new
  --verbose flag        ❌        ✅ new   ✅ inline   ❌
  Bayesian scheduler    ❌        ❌       ✅ new      ✅ new
```

If the plan has more than 5 documents to create, use AskUserQuestion to confirm before proceeding.
For smaller scopes, proceed directly.

---

## Step 3: Write Reference Documentation First

Reference docs are the foundation. They are factual, complete, and derived directly from code.
Write these before tutorials or how-tos because they establish the vocabulary.

**Reference doc template:**

```markdown
# [Entity Name]

[One paragraph: what it is, what it does, when you'd use it.]

## API / Interface

[Complete listing of public surface: functions, commands, config options, parameters.
Include types, defaults, and constraints. Pull directly from code — do not paraphrase
loosely.]

## Options / Configuration

[If applicable: every option with its type, default, and effect.]

## Examples

[2-3 concrete examples showing actual usage. Prefer real command output or code that
would actually compile/run.]

## Related

[Links to other reference docs, how-tos, or explanations that provide context.]
```

**Rules for reference docs:**
- Accuracy over elegance. Every claim must be traceable to code.
- Include types, defaults, and constraints. "Accepts a string" is insufficient — "Accepts a
  string (max 256 chars, must match `^[a-z-]+$`)" is reference-grade.
- Show real examples that would actually work if copy-pasted.
- Do not explain *why* — that belongs in explanation docs.

---

## Step 4: Write Explanation Documentation

Explanation docs answer "why does this work this way?" They are the design rationale.

**Explanation doc template:**

```markdown
# [Concept / Design Decision]

[Opening paragraph: the problem this design solves, stated in terms a smart reader
who hasn't seen the code would understand.]

## The problem

[Concrete description of what goes wrong without this design. Real failure modes,
not abstract risks.]

## The approach

[How the design solves the problem. Include diagrams (ASCII or Mermaid) for
architectural concepts.]

## Trade-offs

[What was given up. Every design decision trades something — name it explicitly.]

## Alternatives considered

[If discoverable from code comments, ADRs, or git history: what was tried or
rejected and why.]
```

**Rules for explanation docs:**
- Lead with the problem, not the solution.
- Use ASCII diagrams for architecture. They're grep-able, diff-friendly, and render everywhere.
- Name trade-offs explicitly. "We chose X over Y because Z" is the gold standard.
- Do not repeat reference material — link to it.

---

## Step 5: Write How-To Guides

How-tos are task-oriented. They assume the reader knows the basics and wants to accomplish
something specific.

**How-to doc template:**

```markdown
# How to [accomplish specific task]

[One sentence: what you'll accomplish and the end result.]

## Prerequisites

[What the reader needs before starting. Be specific — versions, installed tools,
config state.]

## Steps

1. [Action verb] [specific instruction]

   ```bash
   [exact command]
   ```

   [Expected output or result, if non-obvious.]

2. [Next step...]

## Verification

[How to confirm it worked. A command, a URL to visit, a test to run.]

## Troubleshooting

[Common failure modes and their fixes. Pull from tests and error handling code.]
```

**Rules for how-to docs:**
- Title starts with "How to" — no exceptions. This is the reader's entry point.
- Every step must be actionable. No "consider whether..." — instead "Run X" or "Add Y to Z".
- Include verification. The reader should never wonder "did it work?"
- Troubleshooting section is mandatory if the task can fail.

---

## Step 6: Write Tutorials

Tutorials are learning-oriented. They take a newcomer from zero to a working example.
These are the hardest to write well and the most valuable.

**Tutorial doc template:**

```markdown
# [Tutorial title — describes what you'll build/learn]

[Opening paragraph: what you'll build, why it's useful, and what you'll understand
by the end. Keep it concrete — "You'll build a working X that does Y" not
"This tutorial covers X".]

## What you'll need

[Prerequisites: tools, versions, prior knowledge. Link to installation guides.]

## Step 1: [Set up the foundation]

[Start from a clean state. Show every command. Explain what each does on first
encounter — but briefly, not a lecture.]

```bash
[exact command]
```

[Brief explanation of what just happened.]

## Step 2: [Build the first working piece]

[Get to a working, visible result as fast as possible. The reader should see
something happen within the first 3 steps.]

...

## Step N: [Final step]

## What you built

[Recap: what the reader now has and what it can do. Link to reference docs
for deeper exploration. Suggest next steps.]
```

**Rules for tutorials:**
- **Time to first result < 3 steps.** If the reader hasn't seen something work by step 3,
  the tutorial is too slow.
- Every step must produce a visible change or output. No "now configure X" without showing
  what changes.
- Use the exact commands the reader will type. No "run the appropriate command" abstractions.
- Error paths: if a step commonly fails, show the error and the fix inline.
- End with "What you built" — connect the tutorial back to the real use case.

---

## Step 7: Cross-Document Linking & Discoverability

After writing all documents:

1. **Add cross-links between quadrants.** Every reference doc should link to its how-to.
   Every how-to should link to its reference. Tutorials should link to both.

2. **Update entry-point files.** Add references to new docs in:
   - README.md — add to documentation section or table of contents
   - CLAUDE.md / AGENTS.md — add to project structure if relevant
   - Any existing docs index or sidebar config

3. **Verify discoverability.** Every new document must be reachable within 2 clicks from
   README.md. If a docs framework is in use, add to the sidebar/nav config.

4. **Check for broken links.** Grep for any `](` references that point to files that don't exist.

---

## Step 8: Quality Self-Review

Before committing, review each document against these criteria:

**Accuracy gate:**
- [ ] Every code example compiles / runs / passes if copy-pasted
- [ ] Every API description matches the actual code signature
- [ ] Every command shown produces the output described
- [ ] No stale references to renamed/removed entities

**Completeness gate:**
- [ ] Reference docs cover 100% of public surface
- [ ] How-tos cover the top 3 tasks a user would attempt
- [ ] Tutorials get to a working result in ≤3 steps
- [ ] Explanation docs name trade-offs, not just choices

**Voice gate:**
- [ ] Written for a smart person who hasn't seen the code
- [ ] No jargon without brief inline gloss on first use
- [ ] Active voice, concrete nouns, short sentences
- [ ] "You can now..." not "The system provides..."

Fix any failures before proceeding.

---

## Step 9: Commit & Output

1. Stage new documentation files by name (never `git add -A` or `git add .`).

**Redaction scan before commit.** Generated docs frequently contain example
credentials; scan the staged doc content and block on a HIGH credential (a
live-format secret in committed docs is a leak). Example configs belong in
` ```example ` fences won't excuse a live-format secret, but the per-span
placeholder filter passes obvious docs examples (e.g. `AKIAIOSFODNN7EXAMPLE`):

```bash
REDACT_VIS=$($GSTACK_BIN/gstack-config get redact_repo_visibility 2>/dev/null)
[ -z "$REDACT_VIS" ] && REDACT_VIS=$(gh repo view --json visibility -q .visibility 2>/dev/null | tr 'A-Z' 'a-z')
git diff --cached --no-color | grep '^+' | sed 's/^+//' | \
  $GSTACK_BIN/gstack-redact --repo-visibility "${REDACT_VIS:-unknown}" --json 2>/dev/null || echo "GSTACK_RUNTIME_ABSENT: gstack-redact skipped"
# exit 3 (HIGH) → unstage the offending doc, remove the secret, re-stage. Do NOT commit.
```

2. Create a commit:

```bash
git commit -m "$(cat <<'EOF'
docs: generate [scope] documentation (Diataxis)

[One-line summary of what was documented]

Quadrants: [list which quadrants were produced]

Co-Authored-By: OpenAI Codex <noreply@openai.com>
EOF
)"
```

3. Push to the current branch:

```bash
git push
```

4. **If a PR exists**, update the PR body with a `## Documentation Generated` section listing
   every new file with its Diataxis quadrant and a one-line description:

```
## Documentation Generated

| File | Quadrant | Description |
|------|----------|-------------|
| docs/tutorial-getting-started.md | Tutorial | Walk-through from install to first working example |
| docs/reference-widget-api.md | Reference | Complete widget API with types, defaults, examples |
| docs/explanation-bayesian-scheduler.md | Explanation | Why the scheduler uses Bayesian inference |
| docs/howto-custom-widgets.md | How-to | Creating and registering custom widgets |
```

5. Output a structured summary:

```
Documentation generated:
  Scope: [what was documented]
  Files: [N] new, [M] updated
  Coverage:
    Tutorials:    [count] ([list])
    How-tos:      [count] ([list])
    Reference:    [count] ([list])
    Explanation:  [count] ([list])
  Quality: [pass/fail on each gate]
```

---

## Important Rules

- **Research before writing.** Step 1 is not optional. Read the code, read the tests, read the
  existing docs. Insufficient research produces surface-level documentation.
- **Accuracy is non-negotiable.** Every code example must work. Every API description must match
  the actual code. If you're unsure about a detail, read the source again — do not guess.
- **Diataxis quadrants serve different readers.** Do not mix tutorial content into reference docs
  or reference content into how-tos. Each quadrant has a specific reader in a specific mode.
- **Time to first result in tutorials.** If a reader can't see something working by step 3,
  restructure the tutorial.
- **Cross-link everything.** Isolated docs are undiscoverable docs.
- **Voice: friendly, concrete, user-forward.** Write like you're explaining to a smart person
  who hasn't seen the code. Never corporate, never academic.
- **Completeness over minimalism.** AI makes comprehensive documentation cheap. Don't write
  "minimal viable docs" — write complete docs. Boil the ocean.

<!-- GSTACK2_BUG_FIX_START pr=679 anchor=GSTACK2_FIX_679_MATCH_USER_LANGUAGE -->
## Upstream judgment port: PR #679

[Match the user language](https://github.com/garrytan/gstack/pull/679)

### User-language rule

Write questions, progress updates, reports, and artifacts in the language used by the user. Source material, code identifiers, commands, and quotations may remain in their original language when translating them would reduce accuracy.
<!-- GSTACK2_BUG_FIX_END pr=679 -->

<!-- GSTACK2_BUG_FIX_START pr=879 anchor=GSTACK2_FIX_879_SELF_CONTAINED_QUESTIONS -->
## Upstream judgment port: issue #879

[Show the content a question refers to before asking it](https://github.com/garrytan/gstack/issues/879)

### Self-contained questions

A question is only answerable if the user can see what it refers to. Before any AskUserQuestion or prose decision brief that asks the user to confirm, approve, rank, or choose among content this session produced — premises, findings, plans, approaches, scores, summaries — render that content in full as direct assistant text immediately before the question, or restate it inside the question and option descriptions. Internal reasoning is invisible to the user, and collapsed tool output (Bash cat, Read) does not count as shown. Never ask "do you agree with the N premises?" when the premises exist only in your reasoning: print them, then ask. This generalizes the inline design-doc approval rule from PR #1116 to every question in every workflow.
<!-- GSTACK2_BUG_FIX_END pr=879 -->
