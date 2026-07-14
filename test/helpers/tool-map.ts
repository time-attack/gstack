/**
 * Tool compatibility map across provider CLIs.
 *
 * Not all provider CLIs expose equivalent tools. A benchmark that uses Edit, Glob,
 * or Grep won't run cleanly on CLIs that don't have those. The map answers:
 * "which tools does each provider's CLI expose by default?"
 *
 * Callers use missingTools() to detect when a benchmark is scoped to a tool a
 * provider lacks. The runner does not yet consume this map automatically —
 * wiring an `unsupported_tool` skip into runBenchmark is future work.
 *
 * Source-of-truth references:
 *   - Claude Code: https://code.claude.com/docs/en/tools
 *   - Codex CLI: `codex exec --help` tool listing
 *   - Gemini CLI: `gemini --help` (limited tool surface as of 2026-04)
 */

import type { Family } from './providers/types';

export type ToolName =
  | 'Read'
  | 'Write'
  | 'Edit'
  | 'Bash'
  | 'Agent'
  | 'Glob'
  | 'Grep'
  | 'AskUserQuestion'
  | 'WebSearch'
  | 'WebFetch';

export const TOOL_COMPATIBILITY: Record<Family, Record<ToolName, boolean>> = {
  claude: {
    Read: true,
    Write: true,
    Edit: true,
    Bash: true,
    Agent: true,
    Glob: true,
    Grep: true,
    AskUserQuestion: true,
    WebSearch: true,
    WebFetch: true,
  },
  gpt: {
    // Codex CLI has a narrower tool surface: it uses shell + apply_patch.
    // Read/Glob/Grep-style operations happen via shell pipelines.
    Read: true,
    Write: false,       // apply_patch handles writes; no standalone Write tool
    Edit: false,        // apply_patch handles edits; no standalone Edit tool
    Bash: true,
    Agent: false,
    Glob: false,
    Grep: false,
    AskUserQuestion: false,
    WebSearch: true,    // --enable web_search_cached
    WebFetch: false,
  },
  gemini: {
    // Gemini CLI (as of 2026-04) has a limited tool surface in --yolo mode.
    // Shell access depends on flags; most agentic tools are not exposed.
    Read: true,
    Write: false,
    Edit: false,
    Bash: false,
    Agent: false,
    Glob: false,
    Grep: false,
    AskUserQuestion: false,
    WebSearch: true,
    WebFetch: false,
  },
  ollama: {
    // Ollama's /api/generate is pure text completion — zero agentic surface.
    // /api/chat with tools[] could expose tool-calling but the adapter
    // currently targets /api/generate for simplicity and predictability.
    // NOTE: the runner does not yet auto-skip tool-scoped benchmarks for
    // ollama — callers must check missingTools() themselves.
    // bin/gstack-model-benchmark prints a no-file-access note instead.
    Read: false,
    Write: false,
    Edit: false,
    Bash: false,
    Agent: false,
    Glob: false,
    Grep: false,
    AskUserQuestion: false,
    WebSearch: false,
    WebFetch: false,
  },
};

/**
 * Determine which tools from a required-set are missing for a given provider.
 * Empty array means full compatibility.
 */
export function missingTools(
  provider: Family,
  requiredTools: ToolName[]
): ToolName[] {
  const map = TOOL_COMPATIBILITY[provider];
  return requiredTools.filter(t => !map[t]);
}
