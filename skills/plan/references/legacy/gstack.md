## Route first

This is the gstack router. Its one job is to send the request to the right skill.

1. If the request is about a browser, QA, dogfooding, screenshots, or inspecting a page
   (open a site, test a deploy, take a screenshot, check a flow visually) → invoke `$qa --mode Report --module browse`.
2. Otherwise, route by the rules below. If nothing matches, answer directly.

Best-effort, record which way you routed (never block on it). Set `ROUTE_OUTCOME` to
`browse` (sent to $qa --mode Report --module browse), `routed` (sent to another skill), or `direct` (answered
directly, no skill matched):
```bash
```

**Routing rules — when you see these patterns, INVOKE the skill via the Skill tool:**
- User describes a new idea, asks "is this worth building", brainstorms, pitches a concept → invoke `$plan --mode Discovery --module office-hours`
- User asks to spec something out, file an issue, write up a ticket, "turn this into a GitHub issue", "backlog item" → invoke `$plan --mode Specification --module spec`
- User asks about strategy, scope, ambition, "think bigger", "what should we build" → invoke `$plan --mode Product --module plan-ceo-review`
- User asks to review architecture, lock in the plan, "does this design make sense" → invoke `$plan --mode Engineering --module plan-eng-review`
- User asks about developer experience of a plan, API/CLI/SDK design → invoke `$plan --mode DX --module plan-devex-review`
- User wants all reviews done automatically, "review everything" → invoke `$plan --mode Full chain --module autoplan`
- User reports a bug, error, broken behavior, "why is this broken", "this doesn't work", "wtf", "something's wrong" → invoke `$debug --mode Diagnose-only --module investigate`
- User asks to test the site, find bugs, QA, "does this work", "check the deploy" → invoke `/qa`
- User asks to just report bugs without fixing → invoke `$qa --mode Report --module qa-only`
- User asks to review code, check the diff, pre-landing review, "look at my changes" → invoke `/review`
- User asks to audit the live developer experience, time-to-hello-world → invoke `$qa --mode Report --module devex-review`
- User asks to ship, deploy, push, create a PR, "let's land this", "send it" → invoke `/ship`
- User asks to merge + deploy + verify as one flow → invoke `$ship --mode Land --module land-and-deploy`
- User asks to configure deployment for the project → invoke `$ship --mode Deploy --module setup-deploy`
- User asks to monitor prod after shipping, post-deploy checks → invoke `$qa --mode Report --module canary`
- User asks to update docs after shipping → invoke `$ship --mode Prepare --module document-release`
- User asks to write docs from scratch, generate documentation, "document this feature/module" → invoke `$ship --mode Prepare --module document-generate`
- User asks for a weekly retro, what did we ship, "how'd we do" → invoke `$plan --mode Discovery --module retro`
- User asks for a second opinion, codex review → invoke `$review --mode Deep --module codex`
- User asks for safety mode, careful mode → invoke `$debug --mode Diagnose-only --module careful` or `$debug --mode Diagnose-only --module guard`
- User asks to restrict edits to a directory → invoke `$debug --mode Diagnose-only --module freeze` or `$debug --mode Diagnose-only --module unfreeze`
- User asks to upgrade gstack → invoke `$ship --mode Prepare --module gstack-upgrade`
- User asks to save progress, checkpoint, "save my work" → invoke `$plan --mode Discovery --module context-save`
- User asks to resume, restore, "where was I" → invoke `$plan --mode Discovery --module context-restore`
- User asks about security, OWASP, vulnerabilities, "is this secure" → invoke `$review --mode Security --module cso`
- User asks to make a PDF, document, publication → invoke `/make-pdf`
- User asks to launch a real browser for QA, "open the browser" → invoke `$qa --mode Report --module open-gstack-browser`
- User asks to import cookies for authenticated testing → invoke `$qa --mode Report --module setup-browser-cookies`
- User asks about page speed, performance regression, benchmarks → invoke `$qa --mode Report --module benchmark`
- User asks what gstack has learned, "show learnings" → invoke `$plan --mode Discovery --module learn`
- User asks to tune question sensitivity, "stop asking me that" → invoke `$plan --mode Discovery --module plan-tune`
- User asks for code quality dashboard, "health check" → invoke `$review --mode Deep --module health`

**When in doubt, invoke the skill.** A false positive (invoking a skill that wasn't
needed) is cheaper than a false negative (answering ad-hoc when a structured workflow
exists). The skill provides multi-step workflows, checklists, and quality gates that
always produce better results than an ad-hoc answer. If no skill matches, answer
directly as usual.

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
