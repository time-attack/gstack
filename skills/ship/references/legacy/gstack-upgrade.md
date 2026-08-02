# Legacy upgrade compatibility

The 1.x host-directory detector, vendored-copy synchronizer, and destructive Git replacement blocks were duplicated installation infrastructure. GStack 2 delegates skill placement and updates to the standard Agent Skills installer and manages the optional shared runtime atomically.

- Update selected skills with `npx skills add time-attack/gstack/skills` using the user's existing project/global choice. Never infer or enroll a host.
- Upgrade a complete local runtime package with `gstack upgrade --source <complete-gstack-package> --version <version>`.
- Roll back the runtime with `gstack upgrade --rollback`.
- Run `gstack doctor` after either operation.
- Do not reset, delete, move, or rewrite a host skill directory. Do not infer Context.dev choice or consent.

This compatibility module contains no specialist judgment; release readiness and rollback judgment remain in the preserved ship modules.

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
