import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const skill = readFileSync(join(import.meta.dir, '..', 'autoplan', 'SKILL.md'), 'utf8');

function shippedFilter(): string {
  const match = skill.match(/'(select\(\.branch == \$branch and [^']+\))'/);
  if (!match) throw new Error('autoplan task filter not found');
  return match[1];
}

function filter(record: object, branch: string, commits: string) {
  return spawnSync(
    'jq',
    ['-c', '--arg', 'branch', branch, '--arg', 'commits', commits, shippedFilter()],
    { input: `${JSON.stringify(record)}\n`, encoding: 'utf8' },
  );
}

describe('autoplan task aggregation', () => {
  test('keeps a task from the current branch and recent commit', () => {
    const result = filter(
      { branch: 'feature', commit: 'abc123', phase: 'ceo-review' },
      'feature',
      'abc123|def456',
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ commit: 'abc123' });
  });

  test('excludes unrelated branches and commits without jq errors', () => {
    for (const record of [
      { branch: 'other', commit: 'abc123' },
      { branch: 'feature', commit: 'unrelated' },
      { branch: 'feature' },
    ]) {
      const result = filter(record, 'feature', 'abc123|def456');
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe('');
    }
  });
});
