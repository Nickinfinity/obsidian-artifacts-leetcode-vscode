import * as assert from 'node:assert';
import { buildExecutable, declaresFunction } from '../src/services/leetcode-candidate.helpers.js';
import { defaultPracticeConfig, defaultTestConfig } from '../src/services/leetcode-parser.service.js';
import type { ParsedLeetCode } from '../src/types/leetcode.types.js';

/**
 * Unit tests for candidate normalisation — what a test environment is handed.
 *
 * The load-bearing property: the result must never be a program that reads
 * stdin. An env supplies arguments as literals, so a stdin-reading wrapper
 * would block on input that never arrives.
 */
suite('leetcode-candidate', () => {

    function fixture(overrides: Partial<ParsedLeetCode> = {}): ParsedLeetCode {
        return {
            title: 'Add', difficulty: 'easy', functionName: 'add', status: 'unsolved',
            params: [{ name: 'a', type: 'int' }, { name: 'b', type: 'int' }],
            returns: 'int', description: '', examples: [],
            tests: [], finalTests: [], test: defaultTestConfig(),
            setups: [], practice: defaultPracticeConfig(), solutions: [],
            ...overrides,
        };
    }

    // ── declaresFunction ──────────────────────────────────────────────────────

    suite('declaresFunction', () => {

        test('detects a declaration in each language', () => {
            assert.ok(declaresFunction('function add(a, b) {}', 'add'));
            assert.ok(declaresFunction('def add(a, b):', 'add'));
            assert.ok(declaresFunction('public static int add(int a, int b) {}', 'add'));
        });

        test('is not fooled by a substring of a longer name', () => {
            assert.ok(!declaresFunction('function addTwo(a) {}', 'add'));
        });

        test('a bare body declares nothing', () => {
            assert.ok(!declaresFunction('return a + b;', 'add'));
        });

        test('an empty function name never matches', () => {
            assert.ok(!declaresFunction('anything()', ''));
        });
    });

    // ── buildExecutable ───────────────────────────────────────────────────────

    suite('buildExecutable', () => {

        test('source that already declares the function is used verbatim', () => {
            const code = 'function add(a, b) { return a + b; }';
            assert.strictEqual(buildExecutable(fixture(), 'javascript', code), code);
        });

        test('a <<SOLUTION>> marker is consumed rather than passed through', () => {
            const out = buildExecutable(fixture(), 'javascript', 'function add() { <<SOLUTION>> }');
            assert.ok(!out.includes('<<SOLUTION>>'));
        });

        test('a bare JavaScript body is wrapped in a plain declaration', () => {
            const out = buildExecutable(fixture(), 'javascript', 'return a + b;');
            assert.strictEqual(out, 'function add(a, b) {\n\treturn a + b;\n}');
        });

        test('a bare Python body is wrapped and indented', () => {
            const out = buildExecutable(fixture(), 'python', 'return a + b');
            assert.strictEqual(out, 'def add(a, b):\n\treturn a + b');
        });

        test('a bare Java body is wrapped in a static method with mapped types', () => {
            const out = buildExecutable(fixture(), 'java', 'return a + b;');
            assert.ok(out.includes('public static int add(int a, int b) {'));
        });

        test('the wrapper never reads stdin — an env supplies literals', () => {
            for (const lang of ['javascript', 'python', 'java']) {
                const out = buildExecutable(fixture(), lang, 'return a + b;');
                assert.ok(!out.includes('readline'), lang);
                assert.ok(!out.includes('input()'), lang);
                assert.ok(!out.includes('Scanner'), lang);
                assert.ok(!out.includes('main('), lang);
            }
        });

        test('an unknown language passes the body through untouched', () => {
            assert.strictEqual(buildExecutable(fixture(), 'rust', 'a + b'), 'a + b');
        });
    });
});
