import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const SETUP = readFileSync(join(import.meta.dir, '..', 'setup'), 'utf8');

describe('setup Playwright deadline', () => {
  test('bounds launch and install on every platform', () => {
    expect(SETUP).toContain('run_with_deadline "$probe_timeout" node -e');
    expect(SETUP).toContain('run_with_deadline "$probe_timeout" bun --eval');
    expect(SETUP).toContain('run_with_deadline "$_playwright_install_timeout" bunx playwright install chromium');
  });

  test('marks timeout before terminating the full process tree', () => {
    const marker = SETUP.indexOf(': > "$marker"');
    const terminate = SETUP.indexOf('terminate_process_tree "$pid"', marker);
    expect(marker).toBeGreaterThan(-1);
    expect(terminate).toBeGreaterThan(marker);
    expect(SETUP).toContain('terminate_process_tree "$child"');
  });

  test('guards against PID reuse with process identity', () => {
    expect(SETUP).toContain('identity="$(process_identity "$pid")"');
    expect(SETUP).toContain('[ "$current" = "$identity" ]');
  });

  test('continues registration after browser failure', () => {
    const warning = SETUP.indexOf('Browser-backed skills are unavailable.');
    const registration = SETUP.indexOf('link_claude_skill_dirs "$SOURCE_GSTACK_DIR" "$INSTALL_SKILLS_DIR"');
    expect(warning).toBeGreaterThan(-1);
    expect(registration).toBeGreaterThan(warning);
    expect(SETUP.slice(warning, registration)).not.toMatch(/^\s*exit 1\s*$/m);
  });
});

