import * as assert from 'node:assert';
import {
    detectRuntime,
    runAllTests,
    runSingleTest,
} from '../src/services/leetcode-runner.service.js';
import { jsRunner } from '../src/services/lang-runners/javascript.runner.js';
import type {
    LangRunner,
    ParsedLeetCode,
    TestCase,
} from '../src/types/leetcode.types.js';

/**
 * Integration tests for the LeetCode test runner.
 *
 * Real `node` subprocesses are used (Node is the runtime executing the suite,
 * so it is always available). Compilation-error paths use a fake runner config
 * with a failing compile step; the timeout path uses an intentional infinite
 * loop and relies on the 5 s internal timeout.
 */
suite('leetcode-runner', () => {

    /** Minimal ParsedLeetCode shape used by every test. */
    function fixture(): ParsedLeetCode {
        return {
            title:        'Add',
            difficulty:   'easy',
            functionName: 'add',
            status:       'unsolved',
            params:       [{ name: 'a', type: 'int' }, { name: 'b', type: 'int' }],
            returns:      'int',
            description:  '',
            examples:     [],
            tests:        [],
            solutions:    [],
        };
    }

    // ── detectRuntime ─────────────────────────────────────────────────────────

    suite('detectRuntime', () => {
        test('returns true when runtime command exits 0', async () => {
            const r: LangRunner = { ...jsRunner, detectCmd: 'echo ok' };
            assert.strictEqual(await detectRuntime(r), true);
        });

        test('returns false when runtime command is missing / non-zero exit', async () => {
            const r: LangRunner = { ...jsRunner, detectCmd: 'nonexistent_xyz_999_runtime' };
            assert.strictEqual(await detectRuntime(r), false);
        });
    });

    // ── runSingleTest ─────────────────────────────────────────────────────────

    suite('runSingleTest', () => {
        const okCode = 'return a + b;';

        test('passing test → passed:true, actual matches expected, duration ≥ 0', async () => {
            const tc: TestCase = { input: { a: 1, b: 2 }, expected: 3 };
            const r = await runSingleTest(okCode, tc, jsRunner, fixture());
            assert.strictEqual(r.passed, true);
            assert.strictEqual(r.actual, '3');
            assert.ok(r.duration >= 0);
        });

        test('failing test → passed:false, actual differs from expected', async () => {
            const tc: TestCase = { input: { a: 1, b: 2 }, expected: 99 };
            const r = await runSingleTest(okCode, tc, jsRunner, fixture());
            assert.strictEqual(r.passed, false);
            assert.notStrictEqual(r.actual, JSON.stringify(99));
        });

        test('runtime error → passed:false, error contains message', async () => {
            const throwCode = 'throw new Error("boom");';
            const tc: TestCase = { input: { a: 1, b: 2 }, expected: 3 };
            const r = await runSingleTest(throwCode, tc, jsRunner, fixture());
            assert.strictEqual(r.passed, false);
            assert.ok(r.error && r.error.length > 0);
            assert.ok(r.error.toLowerCase().includes('boom'));
        });

        test('compile failure (fake compile) → error mentions compilation', async () => {
            const fakeFail: LangRunner = { ...jsRunner, compile: () => 'false' };
            const tc: TestCase = { input: { a: 1, b: 2 }, expected: 3 };
            const r = await runSingleTest(okCode, tc, fakeFail, fixture());
            assert.strictEqual(r.passed, false);
            assert.ok(r.error?.toLowerCase().includes('compil'));
        });

        test('infinite loop → timeout error within 15 s', async function () {
            (this as { timeout: (n: number) => void }).timeout?.(15_000);
            const spin = 'while (true) {}';
            const tc: TestCase = { input: { a: 1, b: 2 }, expected: 3 };
            const r = await runSingleTest(spin, tc, jsRunner, fixture());
            assert.strictEqual(r.passed, false);
            assert.strictEqual(r.error, 'timeout');
        });
    });

    // ── runAllTests ───────────────────────────────────────────────────────────

    suite('runAllTests', () => {
        const okCode = 'return a + b;';

        test('returns one TestResult per case in order', async () => {
            const cases: TestCase[] = [
                { input: { a: 1, b: 1 }, expected: 2 },
                { input: { a: 2, b: 3 }, expected: 5 },
            ];
            const results = await runAllTests(okCode, cases, jsRunner, fixture());
            assert.strictEqual(results.length, 2);
            assert.strictEqual(results[0].index, 0);
            assert.strictEqual(results[1].index, 1);
        });

        test('does NOT stop on individual test failure', async () => {
            const cases: TestCase[] = [
                { input: { a: 1, b: 1 }, expected: 99 }, // fail
                { input: { a: 2, b: 3 }, expected: 5  }, // pass
            ];
            const results = await runAllTests(okCode, cases, jsRunner, fixture());
            assert.strictEqual(results[0].passed, false);
            assert.strictEqual(results[1].passed, true);
        });

        test('compile failure → every result tagged with compilation error', async () => {
            const fakeFail: LangRunner = { ...jsRunner, compile: () => 'false' };
            const cases: TestCase[] = [
                { input: { a: 1, b: 1 }, expected: 2 },
                { input: { a: 2, b: 3 }, expected: 5 },
            ];
            const results = await runAllTests(okCode, cases, fakeFail, fixture());
            assert.strictEqual(results.length, 2);
            assert.ok(results.every(r => !r.passed && (r.error ?? '').toLowerCase().includes('compil')));
        });
    });

});
