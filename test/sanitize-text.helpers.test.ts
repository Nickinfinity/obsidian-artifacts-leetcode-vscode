import * as assert from 'node:assert';
import { MAX_UNTRUSTED_TEXT_LEN, sanitizeUntrustedText } from '../src/utils/sanitize-text.helpers.js';

/**
 * Unit tests for the shared sanitizer used before an untrusted (artifact-
 * authored) string is interpolated into a verify-reason message —
 * `frontmatter.rules.ts` Rule 3 is the first caller (VSX-122 C12).
 */
suite('sanitize-text.helpers', () => {

    suite('sanitizeUntrustedText', () => {

        test('a plain printable string is left unchanged', () => {
            assert.strictEqual(sanitizeUntrustedText('recipe'), 'recipe');
        });

        test('empty string sanitizes to empty string', () => {
            assert.strictEqual(sanitizeUntrustedText(''), '');
        });

        // ── SEC: hostile inputs ─────────────────────────────────────────

        test('SEC: strips the ESC byte that opens an ANSI escape sequence', () => {
            const esc = String.fromCharCode(0x1b);
            const hostile = `${esc}[31mFAKE PASS${esc}[0m`;
            const clean = sanitizeUntrustedText(hostile);
            assert.ok(!clean.includes(esc), clean);
            // the ESC byte is gone; the rest is inert printable text
            assert.strictEqual(clean, '[31mFAKE PASS[0m');
        });

        test('SEC: strips every C0 control byte (0x00-0x1F)', () => {
            const bel = String.fromCharCode(0x07);
            const backspace = String.fromCharCode(0x08);
            const nul = String.fromCharCode(0x00);
            const hostile = `a${nul}b${bel}c${backspace}d`;
            assert.strictEqual(sanitizeUntrustedText(hostile), 'abcd');
        });

        test('SEC: strips DEL and the C1 control range (0x7F-0x9F)', () => {
            const del = String.fromCharCode(0x7f);
            const c1Mid = String.fromCharCode(0x9b); // CSI in the C1 range
            const hostile = `x${del}y${c1Mid}z`;
            assert.strictEqual(sanitizeUntrustedText(hostile), 'xyz');
        });

        test('SEC: a value at or under the cap is not marked truncated', () => {
            const exact = 'a'.repeat(MAX_UNTRUSTED_TEXT_LEN);
            assert.strictEqual(sanitizeUntrustedText(exact), exact);
            assert.ok(!sanitizeUntrustedText(exact).includes('truncated'));
        });

        test('SEC: a value over the cap is truncated with a visible marker', () => {
            const long = 'a'.repeat(MAX_UNTRUSTED_TEXT_LEN * 10);
            const clean = sanitizeUntrustedText(long);
            assert.ok(clean.length < long.length, `expected shorter than ${long.length}, got ${clean.length}`);
            assert.ok(/truncated/i.test(clean), clean);
            assert.ok(!clean.includes(long), 'the full untruncated run must not appear');
        });

        test('SEC: a custom maxLen is honoured', () => {
            const clean = sanitizeUntrustedText('abcdefghij', 5);
            assert.ok(clean.startsWith('abcde'), clean);
            assert.ok(/truncated/i.test(clean), clean);
        });

        test('SEC: a very long hostile string does not hang', () => {
            const esc = String.fromCharCode(0x1b);
            const huge = `${esc}[31m${'x'.repeat(100_000)}`;
            const start = Date.now();
            sanitizeUntrustedText(huge);
            assert.ok(Date.now() - start < 1000, 'must stay linear on a large adversarial string');
        });
    });
});
