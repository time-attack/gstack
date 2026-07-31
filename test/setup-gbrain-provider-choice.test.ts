import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const template = readFileSync(
  join(ROOT, "skills", "plan", "references", "legacy", "setup-gbrain.md"),
  "utf8",
);

describe("setup-gbrain indexing provider consent", () => {
  test("asks before setup and keeps GBrain's engine choice separate", () => {
    const providerStep = template.indexOf("## Step 0: Choose the code-indexing provider and grant consent");
    const detectionStep = template.indexOf("## Step 1: Detect current state");
    const engineStep = template.indexOf("## Step 2: Pick a path (AskUserQuestion)");

    expect(providerStep).toBeGreaterThan(-1);
    expect(providerStep).toBeLessThan(detectionStep);
    expect(detectionStep).toBeLessThan(engineStep);
    expect(template).toContain("before installing a provider, granting repository access");
    expect(template).toContain("A) GBrain (recommended)");
    expect(template).toContain("B) Sourcebot (YC F25)");
    expect(template).toContain("C) No code indexing");
    expect(template).toContain("local PGLite,\n>     hosted Supabase, or remote MCP path");
  });

  test("does not authorize or advertise an unsupported indexing path", () => {
    const providerSection = template.slice(
      template.indexOf("## Step 0: Choose the code-indexing provider and grant consent"),
      template.indexOf("## Step 1: Detect current state"),
    );

    expect(providerSection).toContain("do not install Sourcebot");
    expect(providerSection).toContain("explicit cloud-versus-self-hosted");
    expect(providerSection).toContain("Do not add Sourcegraph or a GStack-built local index");
    expect(providerSection).not.toMatch(/^> [A-C]\) Sourcegraph/m);
  });
});
