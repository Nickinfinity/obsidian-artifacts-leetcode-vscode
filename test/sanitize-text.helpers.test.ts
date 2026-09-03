import * as assert from 'node:assert';
import {
    MAX_CHILD_OUTPUT_LEN, MAX_UNTRUSTED_TEXT_LEN, sanitizeChildOutput, sanitizeUntrustedText,
} from '../src/utils/sanitize-text.helpers.js';

/**
 * Unit tests for the shared sanitizers used before untrusted text is
 * interpolated into a verify-reason message or printed by the CLI.
 *
 * `sanitizeUntrustedText` — single-line artifact-authored scalars (a check
 * name, a `test.type` value) — `frontmatter.rules.ts` Rule 3 was the first
 * caller (VSX-122 C12). `sanitizeChildOutput` is its sibling for multi-line
 * child process output (a check's `detail`, a case's `error`/`actual`) —
 * `package.rules.ts` / `function.rules.ts` / `scripts/verify-exercise.mjs`
 * are its callers (VSX-231 follow-up).
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

        test('SEC: a very long hostile string does not hang', () => {
            const esc = String.fromCharCode(0x1b);
            const huge = `${esc}[31m${'x'.repeat(100_000)}`;
            const start = Date.now();
            sanitizeUntrustedText(huge);
            assert.ok(Date.now() - start < 1000, 'must stay linear on a large adversarial string');
        });

        // ── SEC: bidi-control code points (opus-reviewer follow-up on 76c7b75) ──
        //
        // A C0/C1 sweep alone lets an artifact reorder rendered text without any
        // control byte at all: U+202E (RLO) reorders everything after it in the
        // bidi paragraph, including text the tool itself appended. Authored with
        // `\u{...}` (braced) — the bare 4-hex `\uXXXX` form is the one this
        // pipeline silently decodes into a real control byte at file-write time.

        test('SEC: strips U+202E (RLO), the Trojan Source reordering trigger', () => {
            const rlo = '\u{202E}';
            const hostile = `${rlo}edoctdeel`;
            const clean = sanitizeUntrustedText(hostile);
            assert.ok(!clean.includes(rlo), clean);
            assert.strictEqual(clean, 'edoctdeel');
        });

        test('SEC: strips U+202E even mid-string, before trailing tool-authored text', () => {
            // The exact shape the reviewer measured: an artifact value embedded in
            // a larger tool-authored reason string.
            const rlo = '\u{202E}';
            const pdi = '\u{2069}';
            const value = `${rlo}edoctdeel${pdi}`;
            const reason = `discriminator: 'artifactType' is '${sanitizeUntrustedText(value)}', expected 'leetcode'`;
            assert.ok(!reason.includes(rlo) && !reason.includes(pdi), reason);
            assert.strictEqual(
                reason, "discriminator: 'artifactType' is 'edoctdeel', expected 'leetcode'",
            );
        });

        test('SEC: strips the LRM/RLM marks and the LRE/RLE/PDF/LRO isolate/embedding range', () => {
            const lrm = '\u{200E}';
            const rlm = '\u{200F}';
            const lre = '\u{202A}';
            const pdf = '\u{202C}';
            const lri = '\u{2066}';
            const pdi = '\u{2069}';
            const hostile = `a${lrm}b${rlm}c${lre}d${pdf}e${lri}f${pdi}g`;
            assert.strictEqual(sanitizeUntrustedText(hostile), 'abcdefg');
        });

        test('a Unicode string with no bidi-control code points is left unchanged', () => {
            assert.strictEqual(sanitizeUntrustedText('café — naïve résumé 中文'), 'café — naïve résumé 中文');
        });

        // SEC-4 (independent-review follow-up on 16453e7): U+061C ARABIC LETTER
        // MARK carries Bidi_Control=Yes exactly like LRM/RLM, but the original
        // class only listed the two — measured: `('a' + ALM + 'b').replace(re, '')`
        // left the ALM in place.
        test('SEC: strips U+061C (ALM), the third Bidi_Control mark alongside LRM/RLM', () => {
            const alm = '\u{061C}';
            const hostile = `a${alm}b`;
            const clean = sanitizeUntrustedText(hostile);
            assert.ok(!clean.includes(alm), clean);
            assert.strictEqual(clean, 'ab');
        });
    });

    suite('sanitizeChildOutput', () => {

        test('a plain printable string is left unchanged', () => {
            assert.strictEqual(sanitizeChildOutput('build succeeded'), 'build succeeded');
        });

        test('empty string sanitizes to empty string', () => {
            assert.strictEqual(sanitizeChildOutput(''), '');
        });

        // ── SEC: hostile inputs ─────────────────────────────────────────

        test('SEC: strips the ESC byte that opens an ANSI escape sequence', () => {
            const esc = String.fromCharCode(0x1b);
            const hostile = `${esc}[31mFAKE PASS${esc}[0m`;
            const clean = sanitizeChildOutput(hostile);
            assert.ok(!clean.includes(esc), clean);
            assert.strictEqual(clean, '[31mFAKE PASS[0m');
        });

        test('SEC: strips a C0 control byte (NUL) that is not \\n or \\t', () => {
            const nul = String.fromCharCode(0x00);
            const bel = String.fromCharCode(0x07);
            assert.strictEqual(sanitizeChildOutput(`a${nul}b${bel}c`), 'abc');
        });

        test('SEC: strips DEL and the C1 control range (0x7F-0x9F)', () => {
            const del = String.fromCharCode(0x7f);
            const c1Mid = String.fromCharCode(0x9b); // CSI in the C1 range
            assert.strictEqual(sanitizeChildOutput(`x${del}y${c1Mid}z`), 'xyz');
        });

        test('SEC: strips a bare carriage return (line-overwrite spoofing vector)', () => {
            const cr = String.fromCharCode(0x0d);
            assert.strictEqual(sanitizeChildOutput(`REAL${cr}FAKE`), 'REALFAKE');
        });

        test('SEC: strips U+202E (RLO) too — the shared bidi sweep, not just CONTROL_CHARS_RE', () => {
            const rlo = '\u{202E}';
            const hostile = `line one\n${rlo}deltroffed\nline three`;
            const clean = sanitizeChildOutput(hostile);
            assert.ok(!clean.includes(rlo), clean);
            assert.strictEqual(clean, 'line one\ndeltroffed\nline three');
        });

        // SEC-4: same shared regex as sanitizeUntrustedText — one fixture here
        // proves the sibling sanitizer inherits the fix, not a second copy of it.
        test('SEC: strips U+061C (ALM), the third Bidi_Control mark alongside LRM/RLM', () => {
            const alm = '\u{061C}';
            const hostile = `line one\n${alm}line two`;
            const clean = sanitizeChildOutput(hostile);
            assert.ok(!clean.includes(alm), clean);
            assert.strictEqual(clean, 'line one\nline two');
        });

        // ── the whole point of this sibling: multi-line stderr survives ──

        test('a multi-line stderr-shaped string keeps every newline and tab', () => {
            const stderr = 'error TS2554: Expected 1 arguments, but got 2.\n'
                + '\tat Object.compile (compiler.js:42:11)\n'
                + '\tat main (index.js:7:3)\n';
            assert.strictEqual(sanitizeChildOutput(stderr), stderr);
        });

        test('a multi-line string keeps its newlines even after an embedded ESC is stripped', () => {
            const esc = String.fromCharCode(0x1b);
            const hostile = `line one\n${esc}[31mline two${esc}[0m\nline three`;
            const clean = sanitizeChildOutput(hostile);
            assert.strictEqual(clean, 'line one\n[31mline two[0m\nline three');
            assert.strictEqual(clean.split('\n').length, 3, 'all three lines must survive');
        });

        // ── bound ──────────────────────────────────────────────────────

        test('SEC: a value at or under the cap is not marked truncated', () => {
            const exact = 'a'.repeat(MAX_CHILD_OUTPUT_LEN);
            assert.strictEqual(sanitizeChildOutput(exact), exact);
            assert.ok(!sanitizeChildOutput(exact).includes('truncated'));
        });

        test('SEC: a value over the cap is truncated with a visible marker', () => {
            const long = 'a'.repeat(MAX_CHILD_OUTPUT_LEN * 5);
            const clean = sanitizeChildOutput(long);
            assert.ok(clean.length < long.length, `expected shorter than ${long.length}, got ${clean.length}`);
            assert.ok(/truncated/i.test(clean), clean);
        });

        test('SEC: the child-output cap is far more generous than the scalar cap', () => {
            // The whole reason this sibling exists: a compiler diagnostic must not
            // be flattened to 200 characters the way an artifact scalar is.
            assert.ok(MAX_CHILD_OUTPUT_LEN > MAX_UNTRUSTED_TEXT_LEN * 10, 'must be a much larger bound');
        });

        test('SEC: a very long hostile multi-line string does not hang', () => {
            const esc = String.fromCharCode(0x1b);
            const huge = `${esc}[31m${'x\n'.repeat(100_000)}`;
            const start = Date.now();
            sanitizeChildOutput(huge);
            assert.ok(Date.now() - start < 1000, 'must stay linear on a large adversarial string');
        });
    });
});
