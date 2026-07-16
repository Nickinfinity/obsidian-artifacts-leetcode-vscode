import * as assert from 'node:assert';
import { appendAttempt } from '../src/services/attempts-writer.service.js';
import { extractAttempts, extractSolutions } from '../src/services/leetcode-sections.helpers.js';

/**
 * Unit tests for `appendAttempt` — the pure writer half of attempt history.
 *
 * Every case round-trips through `extractAttempts` (P6-1) rather than
 * asserting on the raw string shape, except where the exact on-disk format
 * itself is the thing under test (section placement, heading dedup).
 */
suite('appendAttempt', () => {

    const FENCE = '```';

    /** Count `## ` sub-headings in `text` without relying on `String.match`. */
    function countSubHeadings(text: string): number {
        let count = 0;
        const re = /^## /gm;
        for (let m = re.exec(text); m !== null; m = re.exec(text)) { count++; }
        return count;
    }

    test('creates a # Attempts section after # Solutions when absent', () => {
        const raw = [
            '---',
            'title: Demo',
            '---',
            '',
            '# Solutions',
            '',
            '## Java',
            FENCE + 'java',
            'int old;',
            FENCE,
            '',
        ].join('\n');
        const next = appendAttempt(raw, 'java', {
            at: '2026-07-10T14:32:00Z', duration: '8m22s', passed: true,
            bigO: 'O(n)', confidence: 'medium', code: 'int x = 1;',
        });

        assert.ok(next.includes('# Attempts'));
        const attempts = extractAttempts(next);
        assert.strictEqual(attempts.length, 1);
        assert.deepStrictEqual(attempts[0], {
            language: 'java', at: '2026-07-10T14:32:00Z', duration: '8m22s',
            passed: true, bigO: 'O(n)', confidence: 'medium', code: 'int x = 1;',
        });
        // Solutions section untouched.
        assert.strictEqual(extractSolutions(next).length, 1);
        assert.strictEqual(extractSolutions(next)[0].code, 'int old;');
    });

    test('appends at EOF when there is no # Solutions section', () => {
        const raw = ['---', 'title: Demo', '---', '', 'Body prose.'].join('\n');
        const next = appendAttempt(raw, 'python', {
            at: '2026-07-10T00:00:00Z', duration: '1m0s', passed: false, code: 'pass',
        });

        const attempts = extractAttempts(next);
        assert.strictEqual(attempts.length, 1);
        assert.strictEqual(attempts[0].language, 'python');
        assert.strictEqual(attempts[0].passed, false);
        assert.ok(next.startsWith('---\ntitle: Demo\n---\n\nBody prose.'));
    });

    test('omits bigO / confidence from the comment when not supplied', () => {
        const raw = ['---', 'title: Demo', '---', ''].join('\n');
        const next = appendAttempt(raw, 'python', {
            at: '2026-07-10T00:00:00Z', duration: '1m0s', passed: true, code: 'pass',
        });
        const attempts = extractAttempts(next);
        assert.strictEqual(attempts[0].bigO, undefined);
        assert.strictEqual(attempts[0].confidence, undefined);
    });

    test('prepends a new entry ahead of existing entries for the same language', () => {
        const raw = [
            '# Attempts',
            '',
            '## Python',
            '<!-- attempt: { "at": "2026-07-09T00:00:00Z", "duration": "5m0s", "passed": false } -->',
            FENCE + 'python',
            'old code',
            FENCE,
        ].join('\n');
        const next = appendAttempt(raw, 'python', {
            at: '2026-07-10T00:00:00Z', duration: '2m0s', passed: true, code: 'new code',
        });

        const attempts = extractAttempts(next);
        assert.strictEqual(attempts.length, 2);
        assert.strictEqual(attempts[0].at, '2026-07-10T00:00:00Z');
        assert.strictEqual(attempts[0].code, 'new code');
        assert.strictEqual(attempts[1].at, '2026-07-09T00:00:00Z');
        assert.strictEqual(attempts[1].code, 'old code');
    });

    test('creates a new ## Language heading alongside an existing one', () => {
        const raw = [
            '# Attempts',
            '',
            '## Java',
            '<!-- attempt: { "at": "2026-07-09T00:00:00Z", "duration": "5m0s", "passed": false } -->',
            FENCE + 'java',
            'int x;',
            FENCE,
        ].join('\n');
        const next = appendAttempt(raw, 'python', {
            at: '2026-07-10T00:00:00Z', duration: '2m0s', passed: true, code: 'pass',
        });

        const attempts = extractAttempts(next);
        assert.strictEqual(attempts.length, 2);
        assert.deepStrictEqual(attempts.map(a => a.language).sort(), ['java', 'python']);
        // Java's own entry must be untouched.
        const java = attempts.find(a => a.language === 'java');
        assert.strictEqual(java?.code, 'int x;');
    });

    test('an aliased existing heading groups with a canonical langId (no duplicate heading)', () => {
        const raw = [
            '# Attempts',
            '',
            '## JS',
            '<!-- attempt: { "at": "2026-07-09T00:00:00Z", "duration": "5m0s", "passed": false } -->',
            FENCE + 'javascript',
            'var x;',
            FENCE,
        ].join('\n');
        const next = appendAttempt(raw, 'javascript', {
            at: '2026-07-10T00:00:00Z', duration: '2m0s', passed: true, code: 'let x;',
        });

        assert.strictEqual(countSubHeadings(next), 1);
        const attempts = extractAttempts(next);
        assert.strictEqual(attempts.length, 2);
        assert.ok(attempts.every(a => a.language === 'js'));
    });

    test('multiple Submits accumulate — three appends yield three entries, newest first', () => {
        let raw = ['---', 'title: Demo', '---', ''].join('\n');
        raw = appendAttempt(raw, 'python', { at: 't1', duration: '1m', passed: false, code: 'v1' });
        raw = appendAttempt(raw, 'python', { at: 't2', duration: '1m', passed: false, code: 'v2' });
        raw = appendAttempt(raw, 'python', { at: 't3', duration: '1m', passed: true,  code: 'v3' });

        const attempts = extractAttempts(raw);
        assert.deepStrictEqual(attempts.map(a => a.at), ['t3', 't2', 't1']);
    });

    test('never touches # Setup / # Solutions / ## Tests content', () => {
        const solutionsBlock = [
            '# Solutions',
            '',
            '## Java',
            FENCE + 'java',
            'int old;',
            FENCE,
        ].join('\n');
        const testsBlock = [
            '## Tests',
            FENCE + 'json',
            '[{ "input": {}, "expected": 1 }]',
            FENCE,
        ].join('\n');
        const raw = [
            '---',
            'title: Demo',
            '---',
            '',
            testsBlock,
            '',
            solutionsBlock,
            '',
        ].join('\n');

        const next = appendAttempt(raw, 'java', {
            at: '2026-07-10T00:00:00Z', duration: '1m0s', passed: true, code: 'int x;',
        });

        assert.ok(next.includes(testsBlock));
        assert.ok(next.includes(solutionsBlock));
        assert.strictEqual(extractSolutions(next).length, 1);
    });

});
