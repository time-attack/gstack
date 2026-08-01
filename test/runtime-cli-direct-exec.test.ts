/**
 * `node runtime/cli.js <cmd>` must actually run the command.
 *
 * The file exported main() without ever calling it, so every direct invocation
 * was a silent no-op that exited 0: documented commands printed nothing,
 * `gstack egress list --json` produced an empty string instead of `[]`, and
 * .github/workflows/windows-setup-e2e.yml wrote an empty doctor.json without
 * failing. Importers (bin/gstack, the tests above) must still get the export
 * without the module running itself.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CLI = path.join(import.meta.dir, "..", "runtime", "cli.js");

function runDirect(args: string[], env: Record<string, string> = {}) {
  return spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

describe("runtime/cli.js direct execution", () => {
  test("running the file directly parses argv and produces output", () => {
    const result = runDirect(["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("gstack runtime");
  });

  test("every --json path emits parseable JSON, including the empty ledger", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "gstack-direct-exec-"));
    try {
      for (const args of [["egress", "list", "--json"], ["egress", "grants", "--json"], ["egress", "verify", "--json"]]) {
        const result = runDirect(args, { GSTACK_HOME: home });
        expect(result.status).toBe(0);
        expect(() => JSON.parse(result.stdout)).not.toThrow();
      }
      expect(JSON.parse(runDirect(["egress", "list", "--json"], { GSTACK_HOME: home }).stdout)).toEqual([]);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test("exit codes propagate instead of the no-op's blanket 0", () => {
    expect(runDirect(["definitely-not-a-command"]).status).toBe(2);
  });

  test("direct execution resolves through a symlink to the CLI", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gstack-direct-link-"));
    try {
      const link = path.join(dir, "gstack-link.js");
      fs.symlinkSync(CLI, link);
      const result = spawnSync("node", [link, "--version"], { encoding: "utf8" });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("gstack runtime");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("importing the module does not run it", async () => {
    const module = await import("../runtime/cli.js");
    expect(typeof module.main).toBe("function");
  });
});
