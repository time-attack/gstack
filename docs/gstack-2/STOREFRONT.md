# The public listing on skills.sh

The registry page is the first thing a new user reads. On 2026-08-01 it
described a different product than the one this repository ships. This document
records what the page said, what the installer actually does, which part of the
gap we can close from inside the repository, and the exact request an owner has
to file for the rest.

## Measured, 2026-08-01

`https://skills.sh/time-attack/gstack`, fetched live:

```
Install Command:
$ npx skills add time-attack/gstack

Skills Listed (8 total, 99 installs):
1. debug     17 installs
2. plan      17 installs
3. ship      17 installs
4. qa        16 installs
5. review    16 installs
6. make-pdf   8 installs
7. design     7 installs
8. gstack     1 install
```

The canonical contract is six skills: `plan`, `qa`, `debug`, `review`, `ship`,
and the `make-pdf` tool skill. The page shows eight and a non-canonical install
command.

The installer disagrees with the page. Both commands resolve exactly six:

```bash
DISABLE_TELEMETRY=1 npx --yes skills add <clone> --list         # Found 6 skills
DISABLE_TELEMETRY=1 npx --yes skills add <clone>/skills --list  # Found 6 skills
```

Installing both ways into an empty project produced the same six directories
(`debug make-pdf plan qa review ship`) at the same 2.8 MB. The listing is stale;
the CLI is right.

### Where the two extra entries came from

| Entry | Origin | Removed |
|---|---|---|
| `design` | `skills/design/SKILL.md` | commit `50bb32e8`, 2026-07-23 |
| `gstack` | `.agents/skills/gstack/SKILL.md` and `.factory/skills/gstack/SKILL.md` | commit `66894601`, 2026-03-29 |

Both are telemetry fossils: installs recorded while those paths existed, kept on
the page after the paths went away. `skills/.compat/gstack/SKILL.md` still
exists as a routing alias, but it carries `metadata.internal: true`, which the
CLI honors, so it is not offered for install and is not the reason the entry
shows.

### The install-command line, measured rather than assumed

The bare command is not the canonical one, and our own documentation never uses
it. It is not, however, a larger install of skill content. The skills CLI does a
`--depth=1` clone of the whole repository into a temporary directory for either
form of the command, then copies out only the resolved skills. Measured on the
public repository:

| Stage | Bytes |
|---|---|
| Shallow clone of the repository (both commands) | 61 MB working tree, 10 MB `.git` |
| `skills/` inside that clone | 3.0 MB |
| Installed on disk, either command | 2.8 MB |

So the fetch cost is a property of the CLI, not of the command form, and it is
worth naming honestly instead of blaming the listing for it. What the bare form
does risk is drift: 46 tracked `<name>/SKILL.md` files from the 1.x surface
still sit at the repository root. The CLI's standard container search ignores
them today, so discovery is six, but `--full-depth` or any change to that search
would expose all 46 from a root-scoped install. The `/skills` subpath cannot
drift that way, which is why every install command in our documentation names it.

## How skills.sh builds a listing

- There is no submission flow. A repository appears after someone installs from
  it with the skills CLI, and the page is built from that telemetry, which is
  why removed skills persist.
- `skills.sh.json` at the repository root is the only owner-controlled input.
  Per <https://www.skills.sh/docs/customize>, it groups skills into titled
  sections for display only. It does not hide skills, does not change the
  install command, and does not change any `SKILL.md`. It is picked up after the
  telemetry service next sees the repository, and caching can delay the change.
- `metadata.internal: true` (nested under `metadata`) keeps a skill out of CLI
  discovery. It does not retroactively remove an existing listing entry.
- No documented self-serve delist or re-index path exists. Owners ask in the
  tracker: `vercel-labs/skills#183` was resolved by a maintainer deleting the
  entries, and `#1578` (stale entries) plus `#1602` (stale snapshot) are the
  current open requests of this exact shape.

## What we changed here

`skills.sh.json` at the repository root now groups the listing so the six
canonical skills read as the product and the two fossils are labeled:

- "The judgment surface (five skills)": `plan`, `qa`, `debug`, `review`, `ship`.
- "Tool skill": `make-pdf`.
- "Retired, not installable": `design`, `gstack`, with a description saying the
  CLI does not offer them.

That is the whole of what a repository file can do. It leaves the install command
and the eight-entry count untouched, because no repository file controls either.

## What the owner has to submit

Two actions, both outside the repository.

**1. File one issue at <https://github.com/vercel-labs/skills/issues>.** Payload,
ready to paste:

> **Title:** Delist two stale entries and fix the shown install path for
> time-attack/gstack
>
> **Body:**
>
> `https://skills.sh/time-attack/gstack` lists 8 skills. Two do not exist in the
> repository and cannot be installed:
>
> - `design` (7 installs), removed 2026-07-23 in commit `50bb32e8`.
> - `gstack` (1 install), removed 2026-03-29 in commit `66894601`. A routing
>   alias of that name remains at `skills/.compat/gstack/SKILL.md` with
>   `metadata.internal: true`, so the CLI correctly does not offer it.
>
> The CLI resolves the repository correctly. Both
> `npx skills add time-attack/gstack --list` and
> `npx skills add time-attack/gstack/skills --list` report "Found 6 skills":
> `plan`, `qa`, `debug`, `review`, `ship`, `make-pdf`. Only the page disagrees,
> so these look like telemetry fossils, same class as #1578 and #1602.
>
> Requests:
>
> 1. Drop or hide the `design` and `gstack` entries so the page shows the six
>    skills the repository ships.
> 2. Show `npx skills add time-attack/gstack/skills` as the install command. The
>    repository root also holds 46 legacy `<name>/SKILL.md` directories from the
>    1.x layout that the standard search ignores today; the `/skills` subpath is
>    the stable entry point and the one all of our documentation uses.
> 3. Re-index the page from the current default branch so `skills.sh.json`
>    (just added at the repository root) is picked up.
>
> Happy to provide anything else useful.

**2. Trigger a re-index.** The page refreshes after the telemetry service next
sees the repository, so one real install from the current default branch, run
without `DISABLE_TELEMETRY`, is the low-effort nudge:

```bash
npx skills add time-attack/gstack/skills
```

## Verifying afterwards

```bash
# Page: six entries, grouped headings visible, install command names /skills
curl -s https://skills.sh/time-attack/gstack | grep -c 'design'

# Installer: still exactly six, from the canonical path
DISABLE_TELEMETRY=1 npx --yes skills add time-attack/gstack/skills --list

# Our documentation: no bare-repo install command anywhere
grep -rnE "skills add [a-zA-Z0-9_.-]+/gstack([^/]|$)" --include="*.md" .
```

The last check returns nothing today: every install command in `README.md`,
`AGENTS.md`, `CLAUDE.md`, `setup`, and `docs/gstack-2/` already names the
`/skills` subpath. Delete the "Retired, not installable" group from
`skills.sh.json` once the page drops those two entries.
