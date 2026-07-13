import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";

const ROOT = join(import.meta.dir, "..");
const UPDATE_CHECK = join(ROOT, "bin", "gstack-update-check");

const cleanupDirs: string[] = [];

function sh(args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd,
    env: {
      ...env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}

function makeInstallPair() {
  const tmp = mkdtempSync(join(tmpdir(), "gstack-update-check-"));
  cleanupDirs.push(tmp);

  const origin = join(tmp, "origin");
  const install = join(tmp, "install");
  const state = join(tmp, "state");
  mkdirSync(origin, { recursive: true });
  mkdirSync(join(origin, "bin"), { recursive: true });
  mkdirSync(state, { recursive: true });

  writeFileSync(join(origin, "VERSION"), "1.0.0\n");
  writeFileSync(join(origin, "bin", "gstack-config"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(origin, "bin", "gstack-config"), 0o755);

  sh(["git", "init", "-q", "-b", "main"], origin);
  sh(["git", "add", "VERSION", "bin/gstack-config"], origin);
  sh(["git", "commit", "-q", "-m", "initial"], origin);
  sh(["git", "clone", "-q", origin, install], tmp);

  writeFileSync(join(origin, "VERSION"), "1.0.1\n");
  sh(["git", "add", "VERSION"], origin);
  sh(["git", "commit", "-q", "-m", "release 1.0.1"], origin);

  return { tmp, origin, install, state };
}

function runUpdateCheck(repo: ReturnType<typeof makeInstallPair>, args: string[]) {
  return spawnSync("bash", [UPDATE_CHECK, ...args], {
    cwd: repo.install,
    encoding: "utf-8",
    timeout: 10_000,
    env: {
      ...process.env,
      GSTACK_DIR: repo.install,
      GSTACK_STATE_DIR: repo.state,
      GSTACK_REMOTE_URL: `file://${join(repo.origin, "VERSION")}`,
    },
  });
}

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("gstack-update-check --apply", () => {
  test("report-only check leaves the install unchanged", () => {
    const repo = makeInstallPair();
    const result = runUpdateCheck(repo, ["--force"]);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("UPGRADE_AVAILABLE 1.0.0 1.0.1");
    expect(readFileSync(join(repo.install, "VERSION"), "utf-8").trim()).toBe("1.0.0");
  });

  test("fast-forwards the install and writes the just-upgraded marker", () => {
    const repo = makeInstallPair();
    const result = runUpdateCheck(repo, ["--force", "--apply"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("UPGRADED 1.0.0 1.0.1");
    expect(readFileSync(join(repo.install, "VERSION"), "utf-8").trim()).toBe("1.0.1");
    expect(readFileSync(join(repo.state, "just-upgraded-from"), "utf-8").trim()).toBe("1.0.0");
    expect(existsSync(join(repo.state, "last-update-check"))).toBe(false);
  });

  test("bare --apply busts a fresh UP_TO_DATE cache instead of silently no-oping", () => {
    const repo = makeInstallPair();
    writeFileSync(join(repo.state, "last-update-check"), "UP_TO_DATE 1.0.0\n");
    const result = runUpdateCheck(repo, ["--apply"]);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("UPGRADED 1.0.0 1.0.1");
    expect(readFileSync(join(repo.install, "VERSION"), "utf-8").trim()).toBe("1.0.1");
  });

  test("a hanging ./setup cannot wedge --apply (watchdog kills it)", () => {
    const repo = makeInstallPair();
    // A setup script that would hang forever — models the observed wedged
    // first-run browser download. The watchdog must reap it and move on.
    writeFileSync(join(repo.install, "setup"), "#!/bin/sh\nsleep 300\n");
    chmodSync(join(repo.install, "setup"), 0o755);

    const start = Date.now();
    const result = spawnSync("bash", [UPDATE_CHECK, "--force", "--apply"], {
      cwd: repo.install,
      encoding: "utf-8",
      timeout: 30_000,
      env: {
        ...process.env,
        GSTACK_DIR: repo.install,
        GSTACK_STATE_DIR: repo.state,
        GSTACK_REMOTE_URL: `file://${join(repo.origin, "VERSION")}`,
        GSTACK_APPLY_SETUP_TIMEOUT: "2",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("UPGRADED 1.0.0 1.0.1");
    expect(result.stderr).toContain("did not finish");
    expect(Date.now() - start).toBeLessThan(20_000);
    expect(readFileSync(join(repo.install, "VERSION"), "utf-8").trim()).toBe("1.0.1");
  });

  test("refuses to --apply a vendored install nested inside another repo", () => {
    const repo = makeInstallPair();
    const parent = join(repo.tmp, "parent");
    const vendored = join(parent, "gstack");
    mkdirSync(join(vendored, "bin"), { recursive: true });
    writeFileSync(join(vendored, "VERSION"), "1.0.0\n");
    sh(["git", "init", "-q", "-b", "main"], parent);

    const result = spawnSync("bash", [UPDATE_CHECK, "--force", "--apply"], {
      cwd: vendored,
      encoding: "utf-8",
      timeout: 10_000,
      env: {
        ...process.env,
        GSTACK_DIR: vendored,
        GSTACK_STATE_DIR: repo.state,
        GSTACK_REMOTE_URL: `file://${join(repo.origin, "VERSION")}`,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("vendored install");
    expect(readFileSync(join(vendored, "VERSION"), "utf-8").trim()).toBe("1.0.0");
  });
});
