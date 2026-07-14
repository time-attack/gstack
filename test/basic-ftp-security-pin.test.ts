import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

describe("basic-ftp security resolution", () => {
  test("pins every transitive resolution to the patched release", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.overrides?.["basic-ftp"]).toBe("5.3.1");

    const lock = readFileSync(join(root, "bun.lock"), "utf8");
    const versions = [...lock.matchAll(/basic-ftp@(\d+\.\d+\.\d+)/g)].map(
      ([, version]) => version,
    );
    expect(versions.length).toBeGreaterThan(0);
    expect(new Set(versions)).toEqual(new Set(["5.3.1"]));
  });
});
