# Base-branch and remote detection

Every git comparison in a specialist module needs a base ref, and a remote when one exists. Resolve both from the repository itself. `main`, `master`, and `origin/main` are guesses: a base ref that does not exist turns every later `git diff` and `git log` into a hard failure, which is worse than saying plainly that the repo has no separate base branch. A non-`main` default branch and a repo with no remote at all are normal states, not error states.

## The remote

Resolve the remote before the base — never assume `origin` exists:

```bash
git remote 2>/dev/null | grep -qx origin && echo "origin" || git remote 2>/dev/null | head -1
```

Call that result `<remote>`. Empty output means the repo is local-only: a supported case. When `<remote>` is none, `<remote>/<base>` means the local `<base>` ref, `git fetch` is skipped, and any push or PR/MR creation step has nowhere to go — print one line saying so and finish the local work instead of erroring.

## The base branch

Stop at the first hit that names a ref that actually exists (`git rev-parse --verify <candidate>`):

1. **A base the user named.** An explicit base in the request, or the PR/MR the user pointed at, wins over every probe below. Verify it exists; if it does not, say so and ask — never silently substitute another.
2. **The open PR/MR target.** GitHub: `gh pr view --json baseRefName -q .baseRefName`. GitLab: `glab mr view -F json 2>/dev/null`, `target_branch` field.
3. **The remote's own HEAD** (only when `<remote>` is non-empty): `git symbolic-ref refs/remotes/<remote>/HEAD 2>/dev/null | sed 's|refs/remotes/<remote>/||'`. If that ref is missing, run `git remote set-head <remote> -a 2>/dev/null` once and retry.
4. **The platform CLI's default branch.** GitHub: `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`. GitLab: `glab repo view -F json 2>/dev/null`, `default_branch` field.
5. **The local default branch.** `git config --get init.defaultBranch`, then the repo's own local branches (`git branch --format='%(refname:short)'`) — pick the local branch other than the current one that HEAD actually forks from (`git merge-base --is-ancestor <candidate> HEAD`, nearest merge-base wins).
6. **The current branch's upstream.** `git rev-parse --abbrev-ref --symbolic-full-name @{upstream} 2>/dev/null`. When it names something other than the current branch, compare from `git merge-base HEAD <upstream>`.
7. **Nothing resolved, or the resolved name is the current branch.** Then this repo has no separate base branch — a fresh local-only repo, or a default branch that is also checked out (`trunk`, `develop`, anything). Scope the work to uncommitted changes plus recent history (`git status --porcelain`, `git diff HEAD`, `git log --oneline -20`) and say in one line that there is no base branch to diff against. A module whose entry gate requires a feature branch aborts here instead of guessing.

Print `<remote>` (or "none") and the detected base branch once, then substitute the detected names wherever instructions say "the base branch", `<base>`, `<default>`, or `<remote>`.
