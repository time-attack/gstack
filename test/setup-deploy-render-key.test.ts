import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const skill = readFileSync(join(import.meta.dir, '..', 'setup-deploy', 'SKILL.md'), 'utf8');

function renderKeyCheck(): string {
  const section = skill.match(/Check for Render API key[^\n]*\n```bash\n([\s\S]*?)\n```/);
  if (!section) throw new Error('Render API key check not found');
  return section[1];
}

describe('setup-deploy Render credential check', () => {
  test('reports presence without printing secret bytes', () => {
    const result = spawnSync('bash', ['-c', renderKeyCheck()], {
      encoding: 'utf8',
      env: { ...process.env, RENDER_API_KEY: 's3cr3t-value' },
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('RENDER_API_KEY: set');
    expect(result.stdout).not.toContain('s3cr');
  });

  test('reports an absent key', () => {
    const env = { ...process.env };
    delete env.RENDER_API_KEY;
    const result = spawnSync('bash', ['-c', renderKeyCheck()], { encoding: 'utf8', env });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('RENDER_API_KEY: not set');
  });
});
