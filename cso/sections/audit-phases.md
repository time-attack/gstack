<!-- AUTO-GENERATED from audit-phases.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->
**Scope gate (read first).** This section holds every scope-dependent phase (2-11) plus the `--fix`-gated Phase 15, but you run ONLY the phases your resolved mode selected back in `## Mode Resolution` (always-loaded in the skeleton). Phases 0, 1, 12, 13, 14 always run; Phases 2-11 are scope-gated. "Execute in full" means work through this section applying that selection, NOT run a phase your mode did not select just because its prose lives here. Example: `--owasp` runs Phase 9 from this section, not Phases 2-8/10/11.

### Phase 2: Secrets Archaeology

Scan git history for leaked credentials, check tracked `.env` files, find CI configs with inline secrets.

**Canonical pattern catalog.** The HIGH-tier credential prefixes the archaeology
greps below target (AKIA, ghp_, sk-ant-, sk_live_, xoxb-, `-----BEGIN ... PRIVATE
KEY-----`, etc.) are the same set `/spec`'s in-flight redaction blocks on. The full
3-tier taxonomy (HIGH credentials, MEDIUM PII/legal/internal, LOW) is generated from
and lives in `lib/redact-patterns.ts` — the single source of truth shared by the
`gstack-redact` engine, `/spec`, `/ship`, and the `/document-*` skills.

**Git history — known secret prefixes:**
```bash
git log -p --all -S "AKIA" --diff-filter=A -- "*.env" "*.yml" "*.yaml" "*.json" "*.toml" 2>/dev/null
git log -p --all -S "sk-" --diff-filter=A -- "*.env" "*.yml" "*.json" "*.ts" "*.js" "*.py" 2>/dev/null
git log -p --all -G "ghp_|gho_|github_pat_" 2>/dev/null
git log -p --all -G "xoxb-|xoxp-|xapp-" 2>/dev/null
git log -p --all -G "password|secret|token|api_key" -- "*.env" "*.yml" "*.json" "*.conf" 2>/dev/null
```

**.env files tracked by git:**
```bash
git ls-files '*.env' '.env.*' 2>/dev/null | grep -v '.example\|.sample\|.template'
grep -q "^\.env$\|^\.env\.\*" .gitignore 2>/dev/null && echo ".env IS gitignored" || echo "WARNING: .env NOT in .gitignore"
```

**CI configs with inline secrets (not using secret stores):**
```bash
for f in $(find .github/workflows -maxdepth 1 \( -name '*.yml' -o -name '*.yaml' \) 2>/dev/null) .gitlab-ci.yml .circleci/config.yml; do
  [ -f "$f" ] && grep -n "password:\|token:\|secret:\|api_key:" "$f" | grep -v '\${{' | grep -v 'secrets\.'
done 2>/dev/null
```

**Severity:** CRITICAL for active secret patterns in git history (AKIA, sk_live_, ghp_, xoxb-). HIGH for .env tracked by git, CI configs with inline credentials. MEDIUM for suspicious .env.example values.

**FP rules:** Placeholders ("your_", "changeme", "TODO") excluded. Test fixtures excluded unless same value in non-test code. Rotated secrets still flagged (they were exposed). `.env.local` in `.gitignore` is expected.

**Diff mode:** Replace `git log -p --all` with `git log -p <base>..HEAD`.

### Phase 3: Dependency Supply Chain

Goes beyond `npm audit`. Checks actual supply chain risk.

**Package manager detection:**
```bash
[ -f package.json ] && echo "DETECTED: npm/yarn/bun"
[ -f Gemfile ] && echo "DETECTED: bundler"
[ -f requirements.txt ] || [ -f pyproject.toml ] && echo "DETECTED: pip"
[ -f Cargo.toml ] && echo "DETECTED: cargo"
[ -f go.mod ] && echo "DETECTED: go"
```

**Standard vulnerability scan:** Run whichever package manager's audit tool is available. Each tool is optional — if not installed, note it in the report as "SKIPPED — tool not installed" with install instructions. This is informational, NOT a finding. The audit continues with whatever tools ARE available.

**Install scripts in production deps (supply chain attack vector):** For Node.js projects with hydrated `node_modules`, check production dependencies for `preinstall`, `postinstall`, or `install` scripts.

**Lockfile integrity:** Check that lockfiles exist AND are tracked by git.

**Severity:** CRITICAL for known CVEs (high/critical) in direct deps. HIGH for install scripts in prod deps / missing lockfile. MEDIUM for abandoned packages / medium CVEs / lockfile not tracked.

**FP rules:** devDependency CVEs are MEDIUM max. `node-gyp`/`cmake` install scripts expected (MEDIUM not HIGH). No-fix-available advisories without known exploits excluded. Missing lockfile for library repos (not apps) is NOT a finding.

### Phase 4: CI/CD Pipeline Security

Check who can modify workflows and what secrets they can access.

**GitHub Actions analysis:** For each workflow file, check for:
- Unpinned third-party actions (not SHA-pinned) — use Grep for `uses:` lines missing `@[sha]`
- `pull_request_target` (dangerous: fork PRs get write access)
- Script injection via `${{ github.event.* }}` in `run:` steps
- Secrets as env vars (could leak in logs)
- CODEOWNERS protection on workflow files

**Severity:** CRITICAL for `pull_request_target` + checkout of PR code / script injection via `${{ github.event.*.body }}` in `run:` steps. HIGH for unpinned third-party actions / secrets as env vars without masking. MEDIUM for missing CODEOWNERS on workflow files.

**FP rules:** First-party `actions/*` unpinned = MEDIUM not HIGH. `pull_request_target` without PR ref checkout is safe (precedent #11). Secrets in `with:` blocks (not `env:`/`run:`) are handled by runtime.

### Phase 5: Infrastructure Shadow Surface

Find shadow infrastructure with excessive access.

**Dockerfiles:** For each Dockerfile, check for missing `USER` directive (runs as root), secrets passed as `ARG`, `.env` files copied into images, exposed ports.

**Config files with prod credentials:** Use Grep to search for database connection strings (postgres://, mysql://, mongodb://, redis://) in config files, excluding localhost/127.0.0.1/example.com. Check for staging/dev configs referencing prod.

**IaC security:** For Terraform files, check for `"*"` in IAM actions/resources, hardcoded secrets in `.tf`/`.tfvars`. For K8s manifests, check for privileged containers, hostNetwork, hostPID.

**Severity:** CRITICAL for prod DB URLs with credentials in committed config / `"*"` IAM on sensitive resources / secrets baked into Docker images. HIGH for root containers in prod / staging with prod DB access / privileged K8s. MEDIUM for missing USER directive / exposed ports without documented purpose.

**FP rules:** `docker-compose.yml` for local dev with localhost = not a finding (precedent #12). Terraform `"*"` in `data` sources (read-only) excluded. K8s manifests in `test/`/`dev/`/`local/` with localhost networking excluded.

### Phase 6: Webhook & Integration Audit

Find inbound endpoints that accept anything.

**Webhook routes:** Use Grep to find files containing webhook/hook/callback route patterns. For each file, check whether it also contains signature verification (signature, hmac, verify, digest, x-hub-signature, stripe-signature, svix). Files with webhook routes but NO signature verification are findings.

**TLS verification disabled:** Use Grep to search for patterns like `verify.*false`, `VERIFY_NONE`, `InsecureSkipVerify`, `NODE_TLS_REJECT_UNAUTHORIZED.*0`.

**OAuth scope analysis:** Use Grep to find OAuth configurations and check for overly broad scopes.

**Verification approach (code-tracing only — NO live requests):** For webhook findings, trace the handler code to determine if signature verification exists anywhere in the middleware chain (parent router, middleware stack, API gateway config). Do NOT make actual HTTP requests to webhook endpoints.

**Severity:** CRITICAL for webhooks without any signature verification. HIGH for TLS verification disabled in prod code / overly broad OAuth scopes. MEDIUM for undocumented outbound data flows to third parties.

**FP rules:** TLS disabled in test code excluded. Internal service-to-service webhooks on private networks = MEDIUM max. Webhook endpoints behind API gateway that handles signature verification upstream are NOT findings — but require evidence.

### Phase 7: LLM & AI Security

Check for AI/LLM-specific vulnerabilities. This is a new attack class.

Use Grep to search for these patterns:
- **Prompt injection vectors:** User input flowing into system prompts or tool schemas — look for string interpolation near system prompt construction
- **Unsanitized LLM output:** `dangerouslySetInnerHTML`, `v-html`, `innerHTML`, `.html()`, `raw()` rendering LLM responses
- **Tool/function calling without validation:** `tool_choice`, `function_call`, `tools=`, `functions=`
- **AI API keys in code (not env vars):** `sk-` patterns, hardcoded API key assignments
- **Eval/exec of LLM output:** `eval()`, `exec()`, `Function()`, `new Function` processing AI responses

**Key checks (beyond grep):**
- Trace user content flow — does it enter system prompts or tool schemas?
- RAG poisoning: can external documents influence AI behavior via retrieval?
- Tool calling permissions: are LLM tool calls validated before execution?
- Output sanitization: is LLM output treated as trusted (rendered as HTML, executed as code)?
- Cost/resource attacks: can a user trigger unbounded LLM calls?

**Severity:** CRITICAL for user input in system prompts / unsanitized LLM output rendered as HTML / eval of LLM output. HIGH for missing tool call validation / exposed AI API keys. MEDIUM for unbounded LLM calls / RAG without input validation.

**FP rules:** User content in the user-message position of an AI conversation is NOT prompt injection (precedent #13). Only flag when user content enters system prompts, tool schemas, or function-calling contexts.

### Phase 8: Skill Supply Chain

Scan installed Claude Code skills for malicious patterns. 36% of published skills have security flaws, 13.4% are outright malicious (Snyk ToxicSkills research).

**Tier 1 — repo-local (automatic):** Scan the repo's local skills directory for suspicious patterns:

```bash
ls -la .claude/skills/ 2>/dev/null
```

Use Grep to search all local skill SKILL.md files for suspicious patterns:
- `curl`, `wget`, `fetch`, `http`, `exfiltrat` (network exfiltration)
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `env.`, `process.env` (credential access)
- `IGNORE PREVIOUS`, `system override`, `disregard`, `forget your instructions` (prompt injection)

**Tier 2 — global skills (requires permission):** Before scanning globally installed skills or user settings, use AskUserQuestion:
"Phase 8 can scan your globally installed AI coding agent skills and hooks for malicious patterns. This reads files outside the repo. Want to include this?"
Options: A) Yes — scan global skills too  B) No — repo-local only

If approved, run the same Grep patterns on globally installed skill files and check hooks in user settings.

**Severity:** CRITICAL for credential exfiltration attempts / prompt injection in skill files. HIGH for suspicious network calls / overly broad tool permissions. MEDIUM for skills from unverified sources without review.

**FP rules:** gstack's own skills are trusted (check if skill path resolves to a known repo). Skills that use `curl` for legitimate purposes (downloading tools, health checks) need context — only flag when the target URL is suspicious or when the command includes credential variables.

**Tier 3 — known-campaign IOCs (comprehensive mode only):** All rules in this tier surface only under `/cso --comprehensive` with TENTATIVE marking — daily mode's 8/10 zero-noise contract is unaffected.

**R1** — Any Claude Code settings file (`.claude/settings.json`, `.claude/settings.local.json`, `$HOME/.claude/settings.json`, or `$HOME/.claude/settings.local.json`) `hooks.*.command` field containing a `/proc/.*/mem` read pattern. Direct process-memory introspection from a Claude Code hook has no legitimate use; it is a known credential-exfiltration technique against runner processes.

**R2** — `.claude/**/*.{js,mjs,ts,cjs}` or `.vscode/**/*.{js,mjs,ts,cjs}` containing **both** the `_0x[0-9a-f]{4,}` variable pattern (≥3 distinct occurrences) **and** at least one of `createDecipheriv`, `gunzip`, `gunzipSync`, `inflateRawSync`, `inflateSync`. Do not alert on ordinary minified bundles or inline sourcemap output unless both halves match.

**R3** — File under `.claude/**` or `.vscode/**` where **all three** hold: (a) referenced from any Claude Code settings file (`.claude/settings.json`, `.claude/settings.local.json`, `$HOME/.claude/settings.json`, or `$HOME/.claude/settings.local.json`) `hooks.*.command` via `node|bun|python3?|bash|sh <path>`, `node --require <path>`, `node -e <inline-require>`, or direct path invocation, **OR** from a `tasks.json` task with `runOptions.runOn: "folderOpen"`; (b) not present in package manifest evidence (`package.json` `files` array, npm tarball, or installed locked-package artifacts); (c) not exempt by the Tier 3 FP guards below. Auto-run persistence bridge in TTP form — renaming the payload file does not evade.

**R4** — Strings `filev2.getsession.org`, `seed1.getsession.org`, `seed2.getsession.org`, or `seed3.getsession.org` appearing inside an executable context: a `hooks.*.command` value, a `tasks.json` `command`/`args` field, or a `fetch`/`http.get`/`axios`/`socket.connect`/`curl`/`nc` call inside a `.{js,mjs,ts,cjs,sh,py}` file under `.claude/**`/`.vscode/**`. Documentation or IOC-note mentions do not fire.

**Tier 3 FP guards:**
- gstack-installed paths trusted: `~/.claude/skills/gstack/`, `~/.claude/skills/gstack-*/`, `$HOME/.claude/hooks/` when content matches distributed checksums (extends the existing "gstack's own skills are trusted" precedent above).
- R3 excluded under `.vscode/extensions/` and inside any directory listed in the root `package.json` `workspaces` field.

### Phase 9: OWASP Top 10 Assessment

For each OWASP category, perform targeted analysis. Use the Grep tool for all searches — scope file extensions to detected stacks from Phase 0.

#### A01: Broken Access Control
- Check for missing auth on controllers/routes (skip_before_action, skip_authorization, public, no_auth)
- Check for direct object reference patterns (params[:id], req.params.id, request.args.get)
- Can user A access user B's resources by changing IDs?
- Is there horizontal/vertical privilege escalation?

#### A02: Cryptographic Failures
- Weak crypto (MD5, SHA1, DES, ECB) or hardcoded secrets
- Is sensitive data encrypted at rest and in transit?
- Are keys/secrets properly managed (env vars, not hardcoded)?

#### A03: Injection
- SQL injection: raw queries, string interpolation in SQL
- Command injection: system(), exec(), spawn(), popen
- Template injection: render with params, eval(), html_safe, raw()
- LLM prompt injection: see Phase 7 for comprehensive coverage

#### A04: Insecure Design
- Rate limits on authentication endpoints?
- Account lockout after failed attempts?
- Business logic validated server-side?

#### A05: Security Misconfiguration
- CORS configuration (wildcard origins in production?)
- CSP headers present?
- Debug mode / verbose errors in production?

#### A06: Vulnerable and Outdated Components
See **Phase 3 (Dependency Supply Chain)** for comprehensive component analysis.

#### A07: Identification and Authentication Failures
- Session management: creation, storage, invalidation
- Password policy: complexity, rotation, breach checking
- MFA: available? enforced for admin?
- Token management: JWT expiration, refresh rotation

#### A08: Software and Data Integrity Failures
See **Phase 4 (CI/CD Pipeline Security)** for pipeline protection analysis.
- Deserialization inputs validated?
- Integrity checking on external data?

#### A09: Security Logging and Monitoring Failures
- Authentication events logged?
- Authorization failures logged?
- Admin actions audit-trailed?
- Logs protected from tampering?

#### A10: Server-Side Request Forgery (SSRF)
- URL construction from user input?
- Internal service reachability from user-controlled URLs?
- Allowlist/blocklist enforcement on outbound requests?

### Phase 10: STRIDE Threat Model

For each major component identified in Phase 0, evaluate:

```
COMPONENT: [Name]
  Spoofing:             Can an attacker impersonate a user/service?
  Tampering:            Can data be modified in transit/at rest?
  Repudiation:          Can actions be denied? Is there an audit trail?
  Information Disclosure: Can sensitive data leak?
  Denial of Service:    Can the component be overwhelmed?
  Elevation of Privilege: Can a user gain unauthorized access?
```

### Phase 11: Data Classification

Classify all data handled by the application:

```
DATA CLASSIFICATION
═══════════════════
RESTRICTED (breach = legal liability):
  - Passwords/credentials: [where stored, how protected]
  - Payment data: [where stored, PCI compliance status]
  - PII: [what types, where stored, retention policy]

CONFIDENTIAL (breach = business damage):
  - API keys: [where stored, rotation policy]
  - Business logic: [trade secrets in code?]
  - User behavior data: [analytics, tracking]

INTERNAL (breach = embarrassment):
  - System logs: [what they contain, who can access]
  - Configuration: [what's exposed in error messages]

PUBLIC:
  - Marketing content, documentation, public APIs
```

### Phase 15: Auto-Fix Engine (only runs with `--fix`)

This phase applies a curated set of provably safe fixes — patterns where the correct change is deterministic, the risk of breakage is near-zero, and the security gain is concrete. No business logic involved. No guessing.

**Fix catalog — 9 patterns:**

**FIX-01: .gitignore secret hardening**
Scan `.gitignore` for missing entries. Add if absent:
```
.env
.env.*
!.env.example
*.pem
*.key
*.p12
*.pfx
```
Safe because: additive only. Never removes existing entries.

**FIX-02: Missing `.gitleaks.toml`**
If no `.gitleaks.toml` exists, create one with a baseline config that extends the default ruleset:
```toml
title = "gitleaks config"

[extend]
useDefault = true

[[allowlists]]
description = "test fixtures"
paths = ['''test''', '''spec''', '''fixtures''', '''__tests__''']
```
Safe because: additive. Does not block any existing workflow unless gitleaks is already running (in which case the file was already needed).

**FIX-03: npm audit fix (non-breaking patches only)**
```bash
npm audit fix
```
Run only if `package-lock.json` exists (npm is the package manager) and there are audit findings. Skip when the repo only has `bun.lock`, `pnpm-lock.yaml`, or `yarn.lock` — running npm there creates a stray, desynced `package-lock.json`. Do NOT run `npm audit fix --force` (that allows major version bumps). Only patches and minor upgrades. Note: `npm audit fix` installs packages, which executes dependency lifecycle scripts — mention that in the fix summary.
Safe because: respects semver constraints in `package.json`. Never changes APIs.

**FIX-04: Node.js TLS bypass (`rejectUnauthorized: false`)**
Find all occurrences with the Grep tool: pattern `rejectUnauthorized\s*:\s*false`.
For each match: read the file, verify it's not in a test file or commented out, then use Edit to flip to `true`.
Safe because: single token flip. A `false` here disables TLS cert verification entirely — this is almost always a copy-paste mistake, never intentional in production code. If it's intentional (self-signed cert in dev), the developer will see the fix in the diff and revert.

**FIX-05: Python requests TLS bypass (`verify=False`)**
Find all occurrences: pattern `requests\.(get|post|put|patch|delete|request)\(.*verify=False`.
For each match: read the file, verify it's production code (not a test), use Edit to change `verify=False` to `verify=True`.
Safe because: same reasoning as FIX-04.

**FIX-06: Go TLS bypass (`InsecureSkipVerify: true`)**
Find all occurrences: pattern `InsecureSkipVerify\s*:\s*true`.
For each match: read the file, verify it's not test infrastructure, use Edit to flip to `false`.
Safe because: same reasoning as FIX-04.

**FIX-07: Insecure cookie `httpOnly: false`**
Find all occurrences: pattern `httpOnly\s*:\s*false` in JS/TS files.
For each match: flip to `true`, UNLESS the cookie name matches `/csrf|xsrf/i` — double-submit CSRF token cookies are intentionally JS-readable, and flipping them breaks CSRF protection. This prevents JavaScript from reading the cookie — the correct default for session cookies.
Safe because: `httpOnly: true` never breaks server-side code for non-CSRF cookies. It only blocks `document.cookie` access, which should never be needed for session/auth cookies.

**FIX-08: Insecure cookie `secure: false`**
Find all occurrences: pattern `secure\s*:\s*false` in cookie configuration contexts (near `httpOnly`, `sameSite`, `maxAge`).
For each match: flip to `true`.
Safe because: if you're in production (the only place this matters), you're on HTTPS. If you're in dev, you likely have `NODE_ENV` checks separating the config already. Single flag flip.

**FIX-09: `DEBUG=true` in production env files**
Search for files named `.env.production`, `.env.prod`, `production.env` containing `DEBUG=true` or `DEBUG=1`.
For each match: flip to `DEBUG=false` or `DEBUG=0`.
Safe because: debug mode in production leaks stack traces and internal state. Flipping this off is never a behavioral regression — it only removes information leakage.

---

**Fix execution protocol:**

For each applicable fix:
1. Show the user what will change (file, line, before/after).
2. Apply the fix using the Edit tool (for file edits) or Bash (for commands like `npm install`).
3. Mark the fix as applied in the summary.

Do NOT ask for confirmation before each individual fix — the user invoked `--fix` knowing fixes would be applied. Do ask via AskUserQuestion if a fix is ambiguous (e.g., multiple Express entry points, unclear which is production config).

**Fix summary table:**

After applying all fixes, print:

```
AUTO-FIX SUMMARY
════════════════
Fix  Applied  Finding
───  ───────  ───────
FIX-01  YES   .gitignore: added .env, *.pem, *.key patterns
FIX-02  NO    .gitleaks.toml already exists
FIX-03  YES   npm audit fix: 3 vulnerabilities patched
FIX-04  YES   api/http-client.ts:47: rejectUnauthorized false → true
FIX-07  YES   lib/session.ts:12: httpOnly false → true
FIX-09  YES   .env.production:3: DEBUG=true → DEBUG=false
```

If no fixes applied: "No safe auto-fixes found for this codebase. Review findings in Phase 13 for manual remediation steps."
