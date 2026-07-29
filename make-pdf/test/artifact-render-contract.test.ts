/**
 * runtime.artifact-render-contract — the executable implementation.
 *
 * This suite is the contract named in docs/gstack-2/BACKLOG-MAP.json: a
 * hostile-markdown corpus run through the full render() pipeline, asserting
 * the structural invariants behind the mapped bug classes:
 *
 *   - Sentinel integrity (#2084/#2108/#2280): no U+0000 placeholder sentinel
 *     survives to output; anchor tags stay balanced (the swallow bug ate
 *     closing </a> tags, bleeding link-blue over following prose).
 *   - First-page structure (#1904/#1913): pre-H1 content never becomes its
 *     own chapter; the first chapter contains the document's first H1, so
 *     .chapter:first-of-type (the only chapter without break-before: page)
 *     is always the first visible chapter. Frontmatter never renders.
 *   - TOC resolution (#1689/#1690): every TOC href="#X" and
 *     data-toc-target="X" resolves to a heading id="X" in the body.
 *   - CJK script coverage (#2012): the CJK stack is script-aware, SC-priority
 *     for Han-only content.
 *
 * Lives in make-pdf/test/, which is in FREE_TEST_ROOTS
 * (scripts/test-free-shards.ts), so it runs in the default free `bun test`.
 */

import { describe, expect, test } from "bun:test";

import { render } from "../src/render";

const NUL = String.fromCharCode(0); // U+0000 — the smartypants sentinel char

// ─── hostile corpus ───────────────────────────────────────────────────

function deeplyNested(): string {
  let md = "# Deep Nesting\n\n";
  for (let depth = 1; depth <= 8; depth++) {
    md += `${"> ".repeat(depth)}level ${depth} with "quotes" and https://example.com/${depth}\n`;
  }
  md += "\n";
  for (let depth = 0; depth < 8; depth++) {
    md += `${"  ".repeat(depth)}- item ${depth} -- it's nested\n`;
  }
  md += "\n```\ncode fence with \"straight quotes\" and " + NUL + " a raw NUL\n```\n";
  md += "\n## Sub\n\n| a | b |\n|---|---|\n| \"q\" | https://example.com/t |\n";
  return md;
}

const CORPUS: Record<string, string> = {
  "sentinel chars in source": `# T\n\nbefore ${NUL}SMARTPANTS_PRESERVED_0${NUL} after, plus a bare ${NUL} char.`,
  "autolinked URL adjacent to carved tags": `# T\n\nSee <https://example.com> and "quotes" -- dash.`,
  "linked URL, link text = URL (the #2108 repro shape)": `# T\n\nSee [https://example.com](https://example.com) for "details".`,
  "bold URL with query string": `# T\n\n**https://example.com/path?a=1&b=2** then 'single quotes'.`,
  "many URLs adjacent to placeholders": `# T\n\n[a](https://x.test/a)[b](https://x.test/b)<https://x.test/c>**https://x.test/d** "q" -- e...`,
  "yaml frontmatter": `---\ntitle: Meta Junk\nauthor: Ghost Writer\ntags: [a, b]\n---\n\n# Real\n\nBody "text".`,
  "pre-H1 preamble prose": `Intro paragraph before any heading, with "quotes".\n\n# First\n\nBody.\n\n# Second\n\nMore.`,
  "pre-H1 raw style block": `<style>p{color:red}</style>\n\n# First\n\nBody.`,
  "CJK mixed script": `# 混合スクリプト文書\n\n简体中文段落，包含标点。日本語の文もある。"quoted" -- dash and https://example.com/cjk.`,
  "CJK Han-only (Simplified Chinese)": `# 报告标题\n\n这是简体中文内容。第二段带有链接 https://example.com/zh 与"引号"。\n\n## 小节\n\n更多内容。`,
  "deeply nested structures": deeplyNested(),
};

// Render configurations the invariants must hold under.
const CONFIGS: Array<{ name: string; opts: { toc?: boolean; cover?: boolean; pageSize?: "letter" | "a4" } }> = [
  { name: "default", opts: {} },
  { name: "toc+cover, a4", opts: { toc: true, cover: true, pageSize: "a4" } },
];

// ─── invariants ───────────────────────────────────────────────────────

describe("runtime.artifact-render-contract: hostile corpus invariants", () => {
  for (const [docName, markdown] of Object.entries(CORPUS)) {
    for (const { name: cfgName, opts } of CONFIGS) {
      test(`[${docName}] [${cfgName}] sentinel integrity: no U+0000 or leaked placeholder in output`, () => {
        const r = render({ markdown, ...opts });
        expect(r.html).not.toContain(NUL);
        // A leaked placeholder always carries its NUL delimiters, but assert
        // the readable token too for a clearer failure message — the corpus
        // doc that legitimately CONTAINS the token text as prose is excluded.
        if (!markdown.includes("SMARTPANTS_PRESERVED")) {
          expect(r.html).not.toContain("SMARTPANTS_PRESERVED");
        }
      });

      test(`[${docName}] [${cfgName}] anchor tags stay balanced (no swallowed </a>)`, () => {
        const r = render({ markdown, ...opts });
        const open = (r.html.match(/<a[\s>]/g) ?? []).length;
        const close = (r.html.match(/<\/a>/g) ?? []).length;
        expect(open).toBe(close);
      });

      test(`[${docName}] [${cfgName}] first chapter contains the first H1 (no preamble-only chapter, #1904)`, () => {
        const r = render({ markdown, ...opts });
        const chapters = r.html.match(/<section class="chapter">[\s\S]*?<\/section>/g) ?? [];
        expect(chapters.length).toBeGreaterThan(0);
        // Every corpus doc has an H1: the FIRST chapter must hold one, so
        // .chapter:first-of-type is never a contentless page-break donor.
        expect(chapters[0]).toContain("<h1");
      });
    }
  }

  test("frontmatter never renders into the document", () => {
    const r = render({ markdown: CORPUS["yaml frontmatter"], toc: true, cover: true });
    expect(r.meta.title).toBe("Real");
    expect(r.html).not.toContain("Meta Junk");
    expect(r.html).not.toContain("Ghost Writer");
  });

  test("TOC resolution: every href/data-toc-target resolves to a real heading id", () => {
    for (const [docName, markdown] of Object.entries(CORPUS)) {
      const r = render({ markdown, toc: true });
      const toc = r.html.match(/<section class="toc">[\s\S]*?<\/section>/)?.[0] ?? "";
      const targets = [
        ...[...toc.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]),
        ...[...toc.matchAll(/data-toc-target="([^"]+)"/g)].map((m) => m[1]),
      ];
      const body = r.html.slice(r.html.indexOf("</section>", r.html.indexOf('<section class="toc">')));
      for (const id of targets) {
        expect(body).toContain(`id="${id}"`);
      }
    }
  });

  test("pre-existing heading ids are preserved and the TOC links to them", () => {
    const md = `# One\n\n<h2 id="custom-anchor">Custom</h2>\n\ntext\n\n## Auto\n\nmore`;
    const r = render({ markdown: md, toc: true });
    expect(r.html).toContain(`href="#custom-anchor"`);
    expect(r.html).toContain(`id="custom-anchor"`);
  });

  test("CJK script coverage: SC families precede JP for Han-only content (#2012)", () => {
    const css = render({ markdown: CORPUS["CJK Han-only (Simplified Chinese)"] }).printCss;
    expect(css.indexOf("PingFang SC")).toBeGreaterThan(-1);
    expect(css.indexOf("PingFang SC")).toBeLessThan(css.indexOf("Hiragino Kaku Gothic ProN"));
    expect(css.indexOf("Noto Sans CJK SC")).toBeLessThan(css.indexOf("Noto Sans CJK JP"));
  });

  test("CJK script coverage: kana promotes JP families (#2012)", () => {
    const css = render({ markdown: CORPUS["CJK mixed script"] }).printCss;
    expect(css.indexOf("Hiragino Kaku Gothic ProN")).toBeLessThan(css.indexOf("PingFang SC"));
  });
});
