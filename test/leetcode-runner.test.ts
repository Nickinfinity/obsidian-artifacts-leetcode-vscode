import * as assert from 'node:assert';
import {
    detectRuntime,
    runSuite,
    suiteTimeout,
} from '../src/services/leetcode-runner.service.js';
import { javascriptFunctionEnv } from '../src/services/test-envs/function/javascript.env.js';
import { defaultPracticeConfig, defaultTestConfig } from '../src/services/leetcode-parser.service.js';
import { LANGUAGES } from '../src/types/languages.js';
import type {
    ParsedLeetCode,
    TestCase,
} from '../src/types/leetcode.types.js';
import type { TestEnv } from '../src/services/test-envs/env.types.js';

/**
 * Integration tests for the batch suite runner.
 *
 * Real `node` subprocesses are used (Node is the runtime executing the suite, so
 * it is always available). Compilation-error paths use a fake runner config with
 * a failing compile step; the timeout path uses an intentional infinite loop.
 */
suite('leetcode-runner', () => {

    /** Minimal ParsedLeetCode shape used by every test. */
    function fixture(overrides: Partial<ParsedLeetCode> = {}): ParsedLeetCode {
        return {
            title:        'Add',
            leetcodeType: 'function',
            difficulty:   'easy',
            functionName: 'add',
            status:       'unsolved',
            params:       [{ name: 'a', type: 'int' }, { name: 'b', type: 'int' }],
            returns:      'int',
            description:  '',
            examples:     [],
            tests:        [],
            finalTests:   [],
            test:         defaultTestConfig(),
            setups:       [],
            practice:     defaultPracticeConfig(),
            solutions:    [],
            attempts:     [],
            tags:         [],
            ...overrides,
        };
    }

    const cases: TestCase[] = [
        { input: { a: 1, b: 2 }, expected: 3 },
        { input: { a: 10, b: 5 }, expected: 15 },
    ];

    const ADD = 'function add(a, b) { return a + b; }';

    // ── detectRuntime ─────────────────────────────────────────────────────────

    suite('detectRuntime', () => {

        test('returns true for an installed runtime', async () => {
            assert.strictEqual(await detectRuntime(LANGUAGES.javascript.detectCmd), true);
        });

        test('returns false for a missing runtime', async () => {
            assert.strictEqual(await detectRuntime('definitely-not-a-real-binary-xyz --version'), false);
        });
    });

    // ── suiteTimeout ──────────────────────────────────────────────────────────

    suite('suiteTimeout', () => {

        test('scales with the case count', () => {
            assert.strictEqual(suiteTimeout(3, 5000), 15_000);
        });

        test('caps at 60 s regardless of case count', () => {
            assert.strictEqual(suiteTimeout(100, 5000), 60_000);
        });

        test('an empty suite still gets one case worth of budget', () => {
            assert.strictEqual(suiteTimeout(0, 5000), 5000);
        });
    });

    // ── runSuite: happy path ──────────────────────────────────────────────────

    suite('runSuite', () => {

        test('an empty suite runs nothing and returns nothing', async () => {
            const results = await runSuite(ADD, [], fixture(), javascriptFunctionEnv);
            assert.deepStrictEqual(results, []);
        });

        test('all cases pass for a correct solution', async () => {
            const results = await runSuite(ADD, cases, fixture(), javascriptFunctionEnv);
            assert.strictEqual(results.length, 2);
            assert.ok(results.every(r => r.passed), JSON.stringify(results));
            assert.deepStrictEqual(results.map(r => r.index), [0, 1]);
        });

        test('a wrong answer fails with the actual value reported', async () => {
            const wrong = 'function add(a, b) { return a - b; }';
            const results = await runSuite(wrong, cases, fixture(), javascriptFunctionEnv);
            assert.strictEqual(results[0].passed, false);
            assert.strictEqual(results[0].actual, '-1');
        });

        test('actual is compared canonically, not by raw stdout', async () => {
            const objCases: TestCase[] = [{ input: { a: 1, b: 2 }, expected: { b: 2, a: 1 } }];
            const obj = 'function add(a, b) { return { a: a, b: b }; }';
            const results = await runSuite(obj, objCases, fixture(), javascriptFunctionEnv);
            assert.strictEqual(results[0].passed, true, results[0].actual);
        });

        test('a throw in one case does not abort the suite', async () => {
            const throws = 'function add(a, b) { if (a === 1) { throw new Error("boom"); } return a + b; }';
            const results = await runSuite(throws, cases, fixture(), javascriptFunctionEnv);
            assert.strictEqual(results.length, 2);
            assert.strictEqual(results[0].error, 'boom');
            assert.strictEqual(results[1].passed, true);
        });

        test("the solver's own stdout noise cannot corrupt the results", async () => {
            const noisy = 'function add(a, b) { console.log("hello"); return a + b; }';
            const results = await runSuite(noisy, cases, fixture(), javascriptFunctionEnv);
            assert.ok(results.every(r => r.passed), JSON.stringify(results));
        });

        test('a failed contract fills every case, and nothing is run', async () => {
            const results = await runSuite('function solve() {}', cases, fixture(), javascriptFunctionEnv);
            assert.strictEqual(results.length, 2);
            assert.ok(results.every(r => !r.passed && r.error?.includes('add')), JSON.stringify(results));
        });

        test('a compile error fills every case with the same message', async () => {
            const failing: TestEnv = {
                ...javascriptFunctionEnv,
                emit: (ctx) => ({ ...javascriptFunctionEnv.emit(ctx), compile: 'exit 1' }),
            };
            const results = await runSuite(ADD, cases, fixture(), failing);
            assert.strictEqual(results.length, 2);
            for (const r of results) {
                assert.ok(r.error?.startsWith('compilation error:'), r.error);
                assert.strictEqual(r.passed, false);
            }
        });

        test('a suite timeout recovers printed cases and marks the rest timeout', async () => {
            // Case 0 returns; case 1 spins forever. The per-case budget is tiny so
            // the suite budget stays well under Mocha's own timeout.
            const parsed = fixture({ test: { type: 'call', timeoutMs: 400 } });
            const spin = 'function add(a, b) { if (a === 10) { while (true) {} } return a + b; }';
            const results = await runSuite(spin, cases, parsed, javascriptFunctionEnv);

            assert.strictEqual(results.length, 2);
            assert.strictEqual(results[0].passed, true, 'printed case must survive the kill');
            assert.strictEqual(results[1].passed, false);
            assert.strictEqual(results[1].error, 'timeout');
        });

        test('a suite producing no output at all reports the failure per case', async () => {
            const silent: TestEnv = {
                ...javascriptFunctionEnv,
                validate: () => null,
                emit: () => ({ files: [{ name: 'runner.js', content: 'process.exit(3);' }], run: 'node runner.js' }),
            };
            const results = await runSuite(ADD, cases, fixture(), silent);
            assert.strictEqual(results.length, 2);
            assert.ok(results.every(r => !r.passed && r.error));
        });
    });
});
