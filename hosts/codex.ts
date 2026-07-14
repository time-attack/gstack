import type { HostConfig } from '../scripts/host-config';

const codex: HostConfig = {
  name: 'codex',
  displayName: 'OpenAI Codex CLI',
  cliCommand: 'codex',
  cliAliases: ['agents'],

  globalRoot: '.codex/skills/gstack',
  localSkillRoot: '.agents/skills/gstack',
  hostSubdir: '.agents',
  usesEnvVars: true,

  frontmatter: {
    mode: 'allowlist',
    keepFields: ['name', 'description'],
    descriptionLimit: 1024,
    descriptionLimitBehavior: 'error',
  },

  generation: {
    generateMetadata: true,
    metadataFormat: 'openai.yaml',
    skipSkills: ['codex'],  // Codex skill is a Claude wrapper around codex exec
  },

  pathRewrites: [
    { from: '~/.claude/skills/gstack', to: '$GSTACK_ROOT' },
    { from: '.claude/skills/gstack', to: '.agents/skills/gstack' },
    { from: '.claude/skills/review', to: '.agents/skills/gstack/review' },
    { from: '.claude/skills', to: '.agents/skills' },
  ],

  // Codex-generated skills otherwise instruct a Codex agent in Claude-only
  // vocabulary ("using the Agent tool with subagent_type"). Rewrite the
  // subagent/tool phrasing to Codex-native terms. Order matters: replaceAll
  // runs in insertion order, so specific phrases come before the catch-all.
  toolRewrites: {
    "Claude Code's Agent tool": 'Codex subagent tool',
    'Claude adversarial subagent': 'independent adversarial subagent',
    'Claude design subagent': 'independent design subagent',
    'Claude CEO subagent': 'independent CEO subagent',
    'Claude eng subagent': 'independent eng subagent',
    'Claude DX subagent': 'independent DX subagent',
    'Claude subagent': 'independent subagent',
    'subagent_type: "general-purpose"': 'a default subagent profile',
    'using the Agent tool': 'using a Codex subagent',
    'via the Agent tool': 'via a Codex subagent',
    'Use the Agent tool': 'Spawn a Codex subagent',
    'use the Agent tool': 'use a Codex subagent',
    'If the Agent tool is unavailable': 'If Codex subagents are unavailable',
    // NOTE: deliberately NOT rewriting the Bash/Read/Write/Grep/Glob tool nouns
    // to action phrases (e.g. 'use the Grep tool' → 'search for'): they break
    // grammar mid-sentence ("search for to find X") and Codex agents already
    // have analogous tools, so the untranslated noun reads fine. #1162's point
    // was the subagent vocabulary above, not the generic tool nouns.
    'Agent tool': 'Codex subagent tool',
  },

  suppressedResolvers: [
    'DESIGN_OUTSIDE_VOICES',  // design.ts:485 — Codex can't invoke itself
    'ADVERSARIAL_STEP',       // review.ts:408 — Codex can't invoke itself
    'CODEX_SECOND_OPINION',   // review.ts:257 — Codex can't invoke itself
    'CODEX_PLAN_REVIEW',      // review.ts:541 — Codex can't invoke itself
    'REVIEW_ARMY',            // review-army.ts:180 — Codex shouldn't orchestrate
    'GBRAIN_CONTEXT_LOAD',
    'GBRAIN_SAVE_RESULTS',
  ],

  runtimeRoot: {
    globalSymlinks: ['bin', 'browse/dist', 'browse/bin', 'gstack-upgrade', 'ETHOS.md'],
    globalFiles: {
      'review': ['checklist.md', 'TODOS-format.md'],
    },
  },
  sidecar: {
    path: '.agents/skills/gstack',
    symlinks: ['bin', 'browse', 'review', 'qa', 'ETHOS.md'],
  },

  install: {
    prefixable: false,
    linkingStrategy: 'symlink-generated',
  },

  coAuthorTrailer: 'Co-Authored-By: OpenAI Codex <noreply@openai.com>',
  learningsMode: 'basic',
  boundaryInstruction: 'IMPORTANT: Do NOT read or execute any files under ~/.claude/, ~/.agents/, .claude/skills/, or agents/. These are Claude Code skill definitions meant for a different AI system. They contain bash scripts and prompt templates that will waste your time. Ignore them completely. Do NOT modify agents/openai.yaml. Stay focused on the repository code only.',
};

export default codex;
