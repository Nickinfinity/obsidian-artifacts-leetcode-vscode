import * as assert from 'node:assert';
import {
    hasFinalTests,
    publicCount,
    publicSuite,
    submitSuite,
    tagSuiteKinds,
} from '../src/services/leetcode-suite.helpers.js';
import { defaultPracticeConfig, defaultTestConfig } from '../src/services/leetcode-parser.service.js';
import type { ParsedLeetCode, TestCase, TestResult } from '../src/types/leetcode.types.js';

/**
 * Unit tests for the suite-selection helpers — the one place that decides what
 * Run Tests and Submit actually execute.
 */
suite('leetcode-suite helpers', () => {

    const a: TestCase = { input: { x: 1 }, expected: 1 };
    const b: TestCase = { input: { x: 2 }, expected: 4 };
    const c: TestCase = { input: { x: 3 }, expected: 9 };

    function fixture(tests: TestCase[], finalTests: TestCase[]): ParsedLeetCode {
        return {
            title: 'T', difficulty: 'easy', functionName: 'f', status: 'unsolved',
            leetcodeType: 'function',
            params: [], returns: 'int', description: '', examples: [],
            tests, finalTests, test: defaultTestConfig(),
            setups: [], practice: defaultPracticeConfig(), solutions: [], attempts: [], tags: [],
        };
    }

    function result(index: number): TestResult {
        return { index, passed: true, input: {}, expected: 0, actual: '0', duration: 1 };
    }

    // ── publicSuite ───────────────────────────────────────────────────────────

    test('publicSuite is exactly the visible ## Tests list', () => {
        assert.deepStrictEqual(publicSuite(fixture([a, b], [c])), [a, b]);
    });

    // ── submitSuite ───────────────────────────────────────────────────────────

    suite('submitSuite', () => {

        test('concatenates public then final', () => {
            assert.deepStrictEqual(submitSuite(fixture([a, b], [c])), [a, b, c]);
        });

        test('a legacy artifact runs its public list exactly once — no doubling', () => {
            const cases = submitSuite(fixture([a, b], []));
            assert.deepStrictEqual(cases, [a, b]);
            assert.strictEqual(cases.length, 2);
        });

        test('returns a copy, so mutating it cannot corrupt the artifact', () => {
            const parsed = fixture([a], []);
            submitSuite(parsed).push(c);
            assert.strictEqual(parsed.tests.length, 1);
        });

        test('an artifact with only final tests grades just those', () => {
            assert.deepStrictEqual(submitSuite(fixture([], [c])), [c]);
        });

        test('an empty artifact yields an empty suite — the vacuous-pass guard', () => {
            assert.deepStrictEqual(submitSuite(fixture([], [])), []);
        });
    });

    // ── publicCount / hasFinalTests ───────────────────────────────────────────

    test('publicCount counts only the visible cases', () => {
        assert.strictEqual(publicCount(fixture([a, b], [c])), 2);
        assert.strictEqual(publicCount(fixture([], [c])), 0);
    });

    test('hasFinalTests is false for an absent or empty grading suite', () => {
        assert.strictEqual(hasFinalTests(fixture([a], [c])), true);
        assert.strictEqual(hasFinalTests(fixture([a], [])), false);
    });

    // ── tagSuiteKinds ─────────────────────────────────────────────────────────

    suite('tagSuiteKinds', () => {

        test('splits at index === publicCount', () => {
            const kinds = tagSuiteKinds([result(0), result(1), result(2)], 2).map(r => r.kind);
            assert.deepStrictEqual(kinds, ['public', 'public', 'final']);
        });

        test('a publicCount of zero makes every case final', () => {
            const kinds = tagSuiteKinds([result(0), result(1)], 0).map(r => r.kind);
            assert.deepStrictEqual(kinds, ['final', 'final']);
        });

        test('a publicCount covering everything makes every case public', () => {
            const kinds = tagSuiteKinds([result(0), result(1)], 2).map(r => r.kind);
            assert.deepStrictEqual(kinds, ['public', 'public']);
        });

        test('preserves the rest of each result', () => {
            const tagged = tagSuiteKinds([result(0)], 1);
            assert.strictEqual(tagged[0].passed, true);
            assert.strictEqual(tagged[0].duration, 1);
        });

        test('does not mutate the input results', () => {
            const input = [result(0)];
            tagSuiteKinds(input, 0);
            assert.strictEqual(input[0].kind, undefined);
        });

        test('an empty result set stays empty', () => {
            assert.deepStrictEqual(tagSuiteKinds([], 0), []);
        });
    });
});
