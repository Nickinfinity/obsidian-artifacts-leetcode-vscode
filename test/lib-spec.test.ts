import * as assert from 'node:assert';
import { packageNameOf, validateLibNames } from '../src/services/lib-spec.helpers.js';

/**
 * Unit tests for the library-name allowlist — the trust boundary between
 * untrusted `.md` frontmatter and a downstream `execFile` install (T12).
 * Every hostile shape the plan calls out (flag injection, traversal, shell
 * metacharacters, empty string) must be named in `invalid`, not merely
 * cause a generic rejection.
 */
suite('lib-spec.helpers', () => {

    suite('validateLibNames', () => {

        test('accepts a plain unscoped name', () => {
            assert.deepStrictEqual(validateLibNames(['lodash']), { ok: true });
        });

        test('accepts an unscoped name with a version', () => {
            assert.deepStrictEqual(validateLibNames(['lodash@4']), { ok: true });
        });

        test('accepts a scoped name with a semver-range version', () => {
            assert.deepStrictEqual(
                validateLibNames(['@types/node@^20.1.0']),
                { ok: true },
            );
        });

        test('rejects a --flag-shaped name and names it', () => {
            const result = validateLibNames(['lodash@4', '--target=/etc']);
            assert.deepStrictEqual(result, { ok: false, invalid: ['--target=/etc'] });
        });

        test('rejects a leading-dash name (flag injection)', () => {
            assert.deepStrictEqual(validateLibNames(['-rf']), { ok: false, invalid: ['-rf'] });
        });

        test('rejects a shell-metacharacter payload', () => {
            const hostile = ';rm -rf /';
            assert.deepStrictEqual(
                validateLibNames([hostile]),
                { ok: false, invalid: [hostile] },
            );
        });

        test('rejects a path-traversal payload', () => {
            const hostile = '../../etc/passwd';
            assert.deepStrictEqual(
                validateLibNames([hostile]),
                { ok: false, invalid: [hostile] },
            );
        });

        test('rejects an absolute-path payload', () => {
            const hostile = '/etc/passwd';
            assert.deepStrictEqual(
                validateLibNames([hostile]),
                { ok: false, invalid: [hostile] },
            );
        });

        // Embedded `..` slips a leading-char anchor: `a/../../etc` begins with a
        // valid character, so only an explicit `..` guard rejects it. A pip/npm
        // spec bearing `/` and `..` resolves as a local-path install — the exact
        // escape the leading-traversal guard is meant to close.
        test('rejects embedded path traversal, not just leading', () => {
            const hostile = 'a/../../etc';
            assert.deepStrictEqual(
                validateLibNames([hostile]),
                { ok: false, invalid: [hostile] },
            );
        });

        test('rejects a bare parent-dir segment', () => {
            assert.deepStrictEqual(validateLibNames(['a/..']), { ok: false, invalid: ['a/..'] });
        });

        test('rejects an embedded-newline flag-injection payload', () => {
            const hostile = 'lodash\n--evil';
            assert.deepStrictEqual(
                validateLibNames([hostile]),
                { ok: false, invalid: [hostile] },
            );
        });

        test('rejects a backtick command-substitution payload', () => {
            const hostile = '`whoami`';
            assert.deepStrictEqual(
                validateLibNames([hostile]),
                { ok: false, invalid: [hostile] },
            );
        });

        test('rejects an empty string', () => {
            assert.deepStrictEqual(validateLibNames(['']), { ok: false, invalid: [''] });
        });

        test('names every offender, not just the first', () => {
            const result = validateLibNames(['lodash', '-rf', '../evil', 'ok-pkg']);
            assert.deepStrictEqual(result, { ok: false, invalid: ['-rf', '../evil'] });
        });

        test('an empty list is valid', () => {
            assert.deepStrictEqual(validateLibNames([]), { ok: true });
        });
    });

    suite('packageNameOf', () => {

        // The name is joined onto a cache path to decide whether an install can
        // be skipped, so a wrong answer either reinstalls forever or — worse —
        // reads a swept cache as warm.
        const cases: [string, string][] = [
            ['lodash', 'lodash'],
            ['react@^19.0.0', 'react'],
            ['left-pad@1.0.0', 'left-pad'],
            ['@types/node', '@types/node'],
            ['@types/node@^20.0.0', '@types/node'],
            ['@scope/pkg', '@scope/pkg'],
        ];
        for (const [spec, want] of cases) {
            test(`'${spec}' → '${want}'`, () => {
                assert.strictEqual(packageNameOf(spec), want);
            });
        }
    });
});
