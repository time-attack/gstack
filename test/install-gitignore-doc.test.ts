/**
 * `npx skills add time-attack/gstack/skills` writes `.agents/` (2.9 MB, 244
 * files), `.claude/skills/` (six relative symlinks into `../../.agents/skills`)
 * and `skills-lock.json` into the repository root, gitignores none of it, and
 * closes with "Done!" without mentioning the write. The next `git add -A`
 * commits the lot and the symlinks dangle on checkout.
 *
 * The installer is upstream and unowned (skills CLI 1.5.21 has no gitignore
 * handling and no postinstall hook), so the fix lives in GStack's install docs:
 * name the three entries and give the one-line ignore command. This pins that
 * they stay there.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

// The exact bytes a reader is meant to paste. Keep in sync with the docs.
const IGNORE_COMMAND =
  "printf '.agents/\\n.claude/skills/\\nskills-lock.json\\n' >> .gitignore";

const IGNORE_ENTRIES = [".agents/", ".claude/skills/", "skills-lock.json"];

const DOCS = ["README.md", "docs/gstack-2/INSTALL.md"];

describe("install docs cover the repo-root write", () => {
  for (const rel of DOCS) {
    const text = readFileSync(join(ROOT, rel), "utf-8");

    it(`${rel} names every entry the installer leaves untracked`, () => {
      for (const entry of IGNORE_ENTRIES) {
        expect(text).toContain(entry);
      }
    });

    it(`${rel} gives the copy-pasteable ignore command`, () => {
      expect(text).toContain(IGNORE_COMMAND);
    });

    it(`${rel} keeps the ignore guidance with the install command`, () => {
      const install = text.indexOf("npx skills add time-attack/gstack/skills");
      const ignore = text.indexOf(IGNORE_COMMAND);
      expect(install).toBeGreaterThanOrEqual(0);
      expect(ignore).toBeGreaterThan(install);
      // Same section, not buried in an appendix a reader never reaches.
      expect(text.slice(install, ignore).split("\n").length).toBeLessThan(40);
    });
  }

  it("ignores .claude/skills/ rather than all of .claude/", () => {
    // A blanket `.claude/` line would untrack a project's own committed
    // `.claude/` configuration, so the docs must not recommend it.
    for (const rel of DOCS) {
      const text = readFileSync(join(ROOT, rel), "utf-8");
      expect(text).not.toContain("'.agents/\\n.claude/\\n");
    }
  });
});
