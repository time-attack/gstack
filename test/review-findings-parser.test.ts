/**
 * Free static pins for the canonical review-finding parser and the
 * report-artifact hard requirement (test/helpers/e2e-helpers.ts). These two
 * helpers carry the judgment.review.precision-contract assertions — if the
 * parser silently stops matching the canonical format, the E2E would pass
 * vacuously, so pin it here for free.
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Import directly from the module. e2e-helpers is import-safe without EVALS.
import { parseReviewFindings, requireReportArtifact } from './helpers/e2e-helpers';

describe('parseReviewFindings', () => {
  test('parses the canonical examples from review.md verbatim', () => {
    const report = [
      '[P1] (confidence: 9/10) app/models/user.rb:42 — SQL injection via string interpolation in where clause',
      '[P2] (confidence: 5/10) app/controllers/api/v1/users_controller.rb:18 — Possible N+1 query, verify with production logs',
    ].join('\n');
    const findings = parseReviewFindings(report);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      severity: 'P1', confidence: 9, file: 'app/models/user.rb', line: 42,
    });
    expect(findings[0].description).toContain('SQL injection');
    expect(findings[1]).toMatchObject({
      severity: 'P2', confidence: 5, file: 'app/controllers/api/v1/users_controller.rb', line: 18,
    });
  });

  test('tolerates severity words, backticks, hyphen dashes, and line ranges', () => {
    const report = [
      '- [CRITICAL] (confidence: 10/10) `rentals/views.py:11` - f-string SQL interpolation',
      '* [P3] (confidence: 7/10) rentals/deposits.py:7-12 -- read-modify-write race',
    ].join('\n');
    const findings = parseReviewFindings(report);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({ severity: 'CRITICAL', confidence: 10, file: 'rentals/views.py', line: 11 });
    expect(findings[1]).toMatchObject({ severity: 'P3', confidence: 7, file: 'rentals/deposits.py', line: 7 });
  });

  test('does NOT parse findings missing confidence or file:line (the contract)', () => {
    const report = [
      '[P1] SQL injection somewhere in the views',                      // no confidence, no line
      '[P1] (confidence: 9/10) the search view — SQL injection',        // no file:line
      'confidence: 9/10 rentals/views.py:11 — orphan without severity', // no [SEVERITY]
    ].join('\n');
    expect(parseReviewFindings(report)).toHaveLength(0);
  });
});

describe('requireReportArtifact', () => {
  test('returns content for a real report and throws for a missing one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-artifact-'));
    try {
      const p = path.join(dir, 'review-output.md');
      fs.writeFileSync(p, '# Review\n\n[P1] (confidence: 9/10) a.py:1 — finding body long enough to pass.');
      expect(requireReportArtifact(p)).toContain('[P1]');
      expect(() => requireReportArtifact(path.join(dir, 'missing.md'))).toThrow();
      fs.writeFileSync(path.join(dir, 'empty.md'), '\n\n');
      expect(() => requireReportArtifact(path.join(dir, 'empty.md'))).toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
