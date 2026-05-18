import * as assert from 'node:assert';
import { parseLeetCode } from '../src/services/leetcode-parser.service.js';

/**
 * Unit tests for parseLeetCode(content): ParsedLeetCode.
 *
 * Covers frontmatter, description, ## Examples, ## Tests (JSON), and the
 * # Solutions tree (## Language → ### Label + fenced code + meta comment).
 *
 * Tests are intentionally written before the implementation — they all fail
 * against the throwing stub and turn green once the parser is built.
 */
suite('parseLeetCode', () => {

    const FENCE = '```';

    // Convenience builder so individual tests stay concise.
    function build(frontmatter: string, body: string): string {
        return ['---', frontmatter, '---', '', body].join('\n');
    }

    // ── Frontmatter ───────────────────────────────────────────────────────────

    test('parses title, difficulty, function, algorithm, status', () => {
        const fm = [
            'type: leetcode',
            'title: Two Sum',
            'difficulty: medium',
            'function: twoSum',
            'algorithm: hash-map',
            'status: attempted',
            'params:',
            '  - name: nums',
            '    type: int[]',
            'returns: int[]',
        ].join('\n');
        const parsed = parseLeetCode(build(fm, ''));
        assert.strictEqual(parsed.title, 'Two Sum');
        assert.strictEqual(parsed.difficulty, 'medium');
        assert.strictEqual(parsed.functionName, 'twoSum');
        assert.strictEqual(parsed.algorithm, 'hash-map');
        assert.strictEqual(parsed.status, 'attempted');
    });

    test('parses params array with name and type per entry', () => {
        const fm = [
            'type: leetcode',
            'title: Demo',
            'function: demo',
            'params:',
            '  - name: nums',
            '    type: int[]',
            '  - name: target',
            '    type: int',
            'returns: int[]',
        ].join('\n');
        const parsed = parseLeetCode(build(fm, ''));
        assert.deepStrictEqual(parsed.params, [
            { name: 'nums', type: 'int[]' },
            { name: 'target', type: 'int' },
        ]);
    });

    test('parses returns type', () => {
        const fm = [
            'type: leetcode',
            'title: Demo',
            'function: demo',
            'params: []',
            'returns: bool',
        ].join('\n');
        const parsed = parseLeetCode(build(fm, ''));
        assert.strictEqual(parsed.returns, 'bool');
    });

    test('missing status defaults to "unsolved"', () => {
        const fm = [
            'type: leetcode',
            'title: Demo',
            'function: demo',
            'params: []',
            'returns: int',
        ].join('\n');
        const parsed = parseLeetCode(build(fm, ''));
        assert.strictEqual(parsed.status, 'unsolved');
    });

    test('missing difficulty defaults to "easy"', () => {
        const fm = [
            'type: leetcode',
            'title: Demo',
            'function: demo',
            'params: []',
            'returns: int',
        ].join('\n');
        const parsed = parseLeetCode(build(fm, ''));
        assert.strictEqual(parsed.difficulty, 'easy');
    });

    test('invalid difficulty value falls back to "easy"', () => {
        const fm = [
            'type: leetcode',
            'title: Demo',
            'difficulty: impossible',
            'function: demo',
            'params: []',
            'returns: int',
        ].join('\n');
        const parsed = parseLeetCode(build(fm, ''));
        assert.strictEqual(parsed.difficulty, 'easy');
    });

    // ── Description ───────────────────────────────────────────────────────────

    test('extracts prose between closing --- and first heading', () => {
        const fm = [
            'type: leetcode',
            'title: Demo',
            'function: demo',
            'params: []',
            'returns: int',
        ].join('\n');
        const body = [
            'Given an array of integers, return whatever.',
            '',
            'Multi-line prose.',
            '',
            '## Examples',
        ].join('\n');
        const parsed = parseLeetCode(build(fm, body));
        assert.strictEqual(
            parsed.description,
            'Given an array of integers, return whatever.\n\nMulti-line prose.',
        );
    });

    test('description is trimmed of surrounding whitespace', () => {
        const fm = [
            'type: leetcode',
            'title: Demo',
            'function: demo',
            'params: []',
            'returns: int',
        ].join('\n');
        const body = ['', '', '   prose   ', '', '', '## Examples'].join('\n');
        const parsed = parseLeetCode(build(fm, body));
        assert.strictEqual(parsed.description, 'prose');
    });

    test('no prose before first heading → empty description', () => {
        const fm = [
            'type: leetcode',
            'title: Demo',
            'function: demo',
            'params: []',
            'returns: int',
        ].join('\n');
        const body = '## Examples';
        const parsed = parseLeetCode(build(fm, body));
        assert.strictEqual(parsed.description, '');
    });

    // ── Examples ──────────────────────────────────────────────────────────────

    test('parses multiple ```example fences under ## Examples', () => {
        const fm = [
            'type: leetcode',
            'title: Demo',
            'function: demo',
            'params: []',
            'returns: int',
        ].join('\n');
        const body = [
            '## Examples',
            FENCE + 'example',
            'input: nums = [2,7], target = 9',
            'output: [0,1]',
            FENCE,
            '',
            FENCE + 'example',
            'input: nums = [3,2,4], target = 6',
            'output: [1,2]',
            FENCE,
        ].join('\n');
        const parsed = parseLeetCode(build(fm, body));
        assert.deepStrictEqual(parsed.examples, [
            { input: 'nums = [2,7], target = 9', output: '[0,1]' },
            { input: 'nums = [3,2,4], target = 6', output: '[1,2]' },
        ]);
    });

    test('no examples section → empty array', () => {
        const fm = [
            'type: leetcode',
            'title: Demo',
            'function: demo',
            'params: []',
            'returns: int',
        ].join('\n');
        const parsed = parseLeetCode(build(fm, '## Tests'));
        assert.deepStrictEqual(parsed.examples, []);
    });

    // ── Tests block ───────────────────────────────────────────────────────────

    test('parses ```json block under ## Tests via JSON.parse', () => {
        const fm = [
            'type: leetcode',
            'title: Demo',
            'function: demo',
            'params:',
            '  - name: nums',
            '    type: int[]',
            '  - name: target',
            '    type: int',
            'returns: int[]',
        ].join('\n');
        const body = [
            '## Tests',
            FENCE + 'json',
            '[',
            '  { "input": { "nums": [2,7], "target": 9 }, "expected": [0,1] },',
            '  { "input": { "nums": [3,2,4], "target": 6 }, "expected": [1,2] }',
            ']',
            FENCE,
        ].join('\n');
        const parsed = parseLeetCode(build(fm, body));
        assert.strictEqual(parsed.tests.length, 2);
        assert.deepStrictEqual(parsed.tests[0].input, { nums: [2, 7], target: 9 });
        assert.deepStrictEqual(parsed.tests[0].expected, [0, 1]);
    });

    test('test input keys match params names (validate at least one test)', () => {
        const fm = [
            'type: leetcode',
            'title: Demo',
            'function: demo',
            'params:',
            '  - name: nums',
            '    type: int[]',
            '  - name: target',
            '    type: int',
            'returns: int[]',
        ].join('\n');
        const body = [
            '## Tests',
            FENCE + 'json',
            '[{ "input": { "nums": [1], "target": 1 }, "expected": [0] }]',
            FENCE,
        ].join('\n');
        const parsed = parseLeetCode(build(fm, body));
        const paramNames = parsed.params.map(p => p.name).sort();
        const inputKeys = Object.keys(parsed.tests[0].input).sort();
        assert.deepStrictEqual(inputKeys, paramNames);
    });

    test('malformed JSON in tests block → empty array, no crash', () => {
        const fm = [
            'type: leetcode',
            'title: Demo',
            'function: demo',
            'params: []',
            'returns: int',
        ].join('\n');
        const body = [
            '## Tests',
            FENCE + 'json',
            '[not, valid, json',
            FENCE,
        ].join('\n');
        const parsed = parseLeetCode(build(fm, body));
        assert.deepStrictEqual(parsed.tests, []);
    });

    test('no tests section → empty array', () => {
        const fm = [
            'type: leetcode',
            'title: Demo',
            'function: demo',
            'params: []',
            'returns: int',
        ].join('\n');
        const parsed = parseLeetCode(build(fm, ''));
        assert.deepStrictEqual(parsed.tests, []);
    });

    // ── Solutions ─────────────────────────────────────────────────────────────

    test('# Solutions → ## Java → ### Brute Force → labelled solution', () => {
        const fm = [
            'type: leetcode',
            'title: Demo',
            'function: demo',
            'params: []',
            'returns: int',
        ].join('\n');
        const body = [
            '# Solutions',
            '',
            '## Java',
            '### Brute Force',
            FENCE + 'java',
            'public static int demo() { return 0; }',
            FENCE,
        ].join('\n');
        const parsed = parseLeetCode(build(fm, body));
        assert.strictEqual(parsed.solutions.length, 1);
        assert.strictEqual(parsed.solutions[0].language, 'java');
        assert.strictEqual(parsed.solutions[0].label, 'Brute Force');
        assert.ok(parsed.solutions[0].code.includes('public static int demo()'));
    });

    test('## Python + fence directly (no ###) → label undefined', () => {
        const fm = [
            'type: leetcode',
            'title: Demo',
            'function: demo',
            'params: []',
            'returns: int',
        ].join('\n');
        const body = [
            '# Solutions',
            '',
            '## Python',
            FENCE + 'python',
            'def demo(): return 0',
            FENCE,
        ].join('\n');
        const parsed = parseLeetCode(build(fm, body));
        assert.strictEqual(parsed.solutions.length, 1);
        assert.strictEqual(parsed.solutions[0].language, 'python');
        assert.strictEqual(parsed.solutions[0].label, undefined);
        assert.ok(parsed.solutions[0].code.includes('def demo()'));
    });

    test('multiple ### under same ## → multiple solutions for that language', () => {
        const fm = [
            'type: leetcode',
            'title: Demo',
            'function: demo',
            'params: []',
            'returns: int',
        ].join('\n');
        const body = [
            '# Solutions',
            '',
            '## Java',
            '### Brute Force',
            FENCE + 'java',
            'int a;',
            FENCE,
            '',
            '### Hash Map',
            FENCE + 'java',
            'int b;',
            FENCE,
        ].join('\n');
        const parsed = parseLeetCode(build(fm, body));
        assert.strictEqual(parsed.solutions.length, 2);
        assert.deepStrictEqual(
            parsed.solutions.map(s => ({ language: s.language, label: s.label })),
            [
                { language: 'java', label: 'Brute Force' },
                { language: 'java', label: 'Hash Map' },
            ],
        );
    });

    test('multiple unlabeled fences under same ## → auto-labeled Solution #1, #2', () => {
        const fm = [
            'type: leetcode',
            'title: Demo',
            'function: demo',
            'params: []',
            'returns: int',
        ].join('\n');
        const body = [
            '# Solutions',
            '',
            '## Python',
            FENCE + 'python',
            'pass # first',
            FENCE,
            '',
            FENCE + 'python',
            'pass # second',
            FENCE,
        ].join('\n');
        const parsed = parseLeetCode(build(fm, body));
        assert.strictEqual(parsed.solutions.length, 2);
        assert.strictEqual(parsed.solutions[0].label, 'Solution #1');
        assert.strictEqual(parsed.solutions[1].label, 'Solution #2');
    });

    test('no # Solutions → empty array', () => {
        const fm = [
            'type: leetcode',
            'title: Demo',
            'function: demo',
            'params: []',
            'returns: int',
        ].join('\n');
        const parsed = parseLeetCode(build(fm, ''));
        assert.deepStrictEqual(parsed.solutions, []);
    });

    test('<!-- meta: { ... } --> before fence → solvedAt and duration parsed', () => {
        const fm = [
            'type: leetcode',
            'title: Demo',
            'function: demo',
            'params: []',
            'returns: int',
        ].join('\n');
        const body = [
            '# Solutions',
            '',
            '## Java',
            '### Hash Map',
            '<!-- meta: { "solved_at": "2025-05-12T14:30:00", "duration": "8m22s" } -->',
            FENCE + 'java',
            'int x = 0;',
            FENCE,
        ].join('\n');
        const parsed = parseLeetCode(build(fm, body));
        assert.strictEqual(parsed.solutions[0].solvedAt, '2025-05-12T14:30:00');
        assert.strictEqual(parsed.solutions[0].duration, '8m22s');
    });

    test('missing meta comment → solvedAt and duration undefined', () => {
        const fm = [
            'type: leetcode',
            'title: Demo',
            'function: demo',
            'params: []',
            'returns: int',
        ].join('\n');
        const body = [
            '# Solutions',
            '',
            '## Java',
            '### Hash Map',
            FENCE + 'java',
            'int x = 0;',
            FENCE,
        ].join('\n');
        const parsed = parseLeetCode(build(fm, body));
        assert.strictEqual(parsed.solutions[0].solvedAt, undefined);
        assert.strictEqual(parsed.solutions[0].duration, undefined);
    });

});
