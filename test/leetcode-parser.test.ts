import * as assert from 'node:assert';
import {
    defaultPracticeConfig,
    defaultTestConfig,
    functionNameFor,
    parseFrontmatterOnly,
    parseLeetCode,
} from '../src/services/leetcode-parser.service.js';
import { extractAttempts } from '../src/services/leetcode-sections.helpers.js';
import type { ParsedLeetCode } from '../src/types/leetcode.types.js';

/**
 * Unit tests for parseLeetCode(content): ParsedLeetCode.
 *
 * Covers frontmatter, description, ## Examples, ## Tests (JSON), and the
 * # Solutions tree (## Language → ### Label + fenced code + meta comment).
 *
 * v2 format (ARTIFACT_LEETCODE_FILE_FORMAT.md §1/§2.5): frontmatter keeps
 * only `type`/`title`/`difficulty`/`status`/`algorithm`/`tags`. Execution
 * config — `function`/`functions`/`params`/`returns`/`test`/`practice` —
 * lives in ```yaml leetcode``` body fences instead.
 */
suite('parseLeetCode', () => {

    const FENCE = '```';

    // Convenience builder so individual tests stay concise.
    function build(frontmatter: string, body: string): string {
        return ['---', frontmatter, '---', '', body].join('\n');
    }

    // A ```yaml leetcode``` config fence wrapping the given YAML body.
    function cfg(yaml: string): string {
        return [FENCE + 'yaml leetcode', yaml, FENCE].join('\n');
    }

    // Six-key frontmatter + the one signature nearly every fixture below
    // shares — `function: demo`, no params, `returns: int`.
    const BASE_FM = ['type: leetcode', 'title: Demo'].join('\n');
    const BASE_SIG = 'function: demo\nparams: []\nreturns: int';

    // build() + BASE_FM + BASE_SIG, with `bodyRest` appended after the
    // config fence (blank-line separated). Covers every fixture whose only
    // requirement is "some valid function artifact".
    function baseDoc(bodyRest: string): string {
        const body = bodyRest ? [cfg(BASE_SIG), '', bodyRest].join('\n') : cfg(BASE_SIG);
        return build(BASE_FM, body);
    }

    // ── Frontmatter ───────────────────────────────────────────────────────────

    test('parses title, difficulty, function, algorithm, status', () => {
        const fm = [
            'type: leetcode',
            'title: Two Sum',
            'difficulty: medium',
            'algorithm: hash-map',
            'status: attempted',
        ].join('\n');
        const body = cfg([
            'function: twoSum',
            'params:',
            '  - name: nums',
            '    type: int[]',
            'returns: int[]',
        ].join('\n'));
        const parsed = parseLeetCode(build(fm, body));
        assert.strictEqual(parsed.title, 'Two Sum');
        assert.strictEqual(parsed.difficulty, 'medium');
        assert.strictEqual(parsed.functionName, 'twoSum');
        assert.strictEqual(parsed.algorithm, 'hash-map');
        assert.strictEqual(parsed.status, 'attempted');
    });

    test('parses params array with name and type per entry', () => {
        const body = cfg([
            'function: demo',
            'params:',
            '  - name: nums',
            '    type: int[]',
            '  - name: target',
            '    type: int',
            'returns: int[]',
        ].join('\n'));
        const parsed = parseLeetCode(build(BASE_FM, body));
        assert.deepStrictEqual(parsed.params, [
            { name: 'nums', type: 'int[]' },
            { name: 'target', type: 'int' },
        ]);
    });

    test('parses returns type', () => {
        const body = cfg('function: demo\nparams: []\nreturns: bool');
        const parsed = parseLeetCode(build(BASE_FM, body));
        assert.strictEqual(parsed.returns, 'bool');
    });

    test('missing status defaults to "unsolved"', () => {
        const parsed = parseLeetCode(baseDoc(''));
        assert.strictEqual(parsed.status, 'unsolved');
    });

    test('missing difficulty defaults to "easy"', () => {
        const parsed = parseLeetCode(baseDoc(''));
        assert.strictEqual(parsed.difficulty, 'easy');
    });

    test('invalid difficulty value falls back to "easy"', () => {
        const fm = ['type: leetcode', 'title: Demo', 'difficulty: impossible'].join('\n');
        const parsed = parseLeetCode(build(fm, cfg(BASE_SIG)));
        assert.strictEqual(parsed.difficulty, 'easy');
    });

    // ── Description ───────────────────────────────────────────────────────────

    test('extracts prose between closing --- and first heading', () => {
        const body = [
            'Given an array of integers, return whatever.',
            '',
            'Multi-line prose.',
            '',
            cfg(BASE_SIG),
            '',
            '## Examples',
        ].join('\n');
        const parsed = parseLeetCode(build(BASE_FM, body));
        assert.strictEqual(
            parsed.description,
            'Given an array of integers, return whatever.\n\nMulti-line prose.',
        );
    });

    test('description is trimmed of surrounding whitespace', () => {
        const body = ['', '', '   prose   ', '', '', cfg(BASE_SIG), '', '## Examples'].join('\n');
        const parsed = parseLeetCode(build(BASE_FM, body));
        assert.strictEqual(parsed.description, 'prose');
    });

    test('no prose before first heading → empty description', () => {
        const body = [cfg(BASE_SIG), '', '## Examples'].join('\n');
        const parsed = parseLeetCode(build(BASE_FM, body));
        assert.strictEqual(parsed.description, '');
    });

    // ── Examples ──────────────────────────────────────────────────────────────

    test('parses multiple ```example fences under ## Examples', () => {
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
        const parsed = parseLeetCode(baseDoc(body));
        assert.deepStrictEqual(parsed.examples, [
            { input: 'nums = [2,7], target = 9', output: '[0,1]' },
            { input: 'nums = [3,2,4], target = 6', output: '[1,2]' },
        ]);
    });

    test('no examples section → empty array', () => {
        const parsed = parseLeetCode(baseDoc('## Tests'));
        assert.deepStrictEqual(parsed.examples, []);
    });

    // ── Tests block ───────────────────────────────────────────────────────────

    const NUMS_TARGET_SIG = [
        'function: demo',
        'params:',
        '  - name: nums',
        '    type: int[]',
        '  - name: target',
        '    type: int',
        'returns: int[]',
    ].join('\n');

    test('parses ```json block under ## Tests via JSON.parse', () => {
        const body = [
            cfg(NUMS_TARGET_SIG),
            '',
            '## Tests',
            FENCE + 'json',
            '[',
            '  { "input": { "nums": [2,7], "target": 9 }, "expected": [0,1] },',
            '  { "input": { "nums": [3,2,4], "target": 6 }, "expected": [1,2] }',
            ']',
            FENCE,
        ].join('\n');
        const parsed = parseLeetCode(build(BASE_FM, body));
        assert.strictEqual(parsed.tests.length, 2);
        assert.deepStrictEqual(parsed.tests[0].input, { nums: [2, 7], target: 9 });
        assert.deepStrictEqual(parsed.tests[0].expected, [0, 1]);
    });

    test('test input keys match params names (validate at least one test)', () => {
        const body = [
            cfg(NUMS_TARGET_SIG),
            '',
            '## Tests',
            FENCE + 'json',
            '[{ "input": { "nums": [1], "target": 1 }, "expected": [0] }]',
            FENCE,
        ].join('\n');
        const parsed = parseLeetCode(build(BASE_FM, body));
        const paramNames = parsed.params.map(p => p.name).sort();
        const inputKeys = Object.keys(parsed.tests[0].input).sort();
        assert.deepStrictEqual(inputKeys, paramNames);
    });

    test('malformed JSON in tests block → empty array, no crash', () => {
        const body = [
            '## Tests',
            FENCE + 'json',
            '[not, valid, json',
            FENCE,
        ].join('\n');
        const parsed = parseLeetCode(baseDoc(body));
        assert.deepStrictEqual(parsed.tests, []);
    });

    test('no tests section → empty array', () => {
        const parsed = parseLeetCode(baseDoc(''));
        assert.deepStrictEqual(parsed.tests, []);
    });

    // ── Widened json fence — the function grammar under the project change ────
    // The fence regex now accepts an info-string attribute (`check=<name>`) and
    // takes EVERY json fence in a case section, not just the first, so a
    // `project`'s cases can bind to named checks. These pin what that did to the
    // function grammar: the single-fence artifact — every shipped exercise — is
    // untouched, and a second fence, previously dropped in silence, now counts.

    test('a single bare json fence parses exactly as before', () => {
        const body = [
            '## Tests',
            FENCE + 'json',
            '[{ "input": { "x": 1 }, "expected": 2 }]',
            FENCE,
        ].join('\n');
        assert.deepStrictEqual(parseLeetCode(baseDoc(body)).tests,
            [{ input: { x: 1 }, expected: 2 }]);
    });

    test('a second json fence in the section is appended, no longer ignored', () => {
        const body = [
            '## Tests',
            FENCE + 'json',
            '[{ "input": { "x": 1 }, "expected": 2 }]',
            FENCE,
            '',
            FENCE + 'json',
            '[{ "input": { "x": 3 }, "expected": 4 }]',
            FENCE,
        ].join('\n');
        assert.deepStrictEqual(parseLeetCode(baseDoc(body)).tests, [
            { input: { x: 1 }, expected: 2 },
            { input: { x: 3 }, expected: 4 },
        ]);
    });

    test('one malformed fence costs only its own cases', () => {
        const body = [
            '## Tests',
            FENCE + 'json',
            '[not, valid, json',
            FENCE,
            '',
            FENCE + 'json',
            '[{ "input": { "x": 3 }, "expected": 4 }]',
            FENCE,
        ].join('\n');
        assert.deepStrictEqual(parseLeetCode(baseDoc(body)).tests,
            [{ input: { x: 3 }, expected: 4 }]);
    });

    test('a check= attribute does not stop a function artifact parsing its cases', () => {
        const body = [
            '## Tests',
            FENCE + 'json check=whatever',
            '[{ "input": { "x": 1 }, "expected": 2 }]',
            FENCE,
        ].join('\n');
        assert.strictEqual(parseLeetCode(baseDoc(body)).tests.length, 1);
    });

    // ── Solutions ─────────────────────────────────────────────────────────────

    test('# Solutions → ## Java → ### Brute Force → labelled solution', () => {
        const body = [
            '# Solutions',
            '',
            '## Java',
            '### Brute Force',
            FENCE + 'java',
            'public static int demo() { return 0; }',
            FENCE,
        ].join('\n');
        const parsed = parseLeetCode(baseDoc(body));
        assert.strictEqual(parsed.solutions.length, 1);
        assert.strictEqual(parsed.solutions[0].language, 'java');
        assert.strictEqual(parsed.solutions[0].label, 'Brute Force');
        assert.ok(parsed.solutions[0].code.includes('public static int demo()'));
    });

    test('## Python + fence directly (no ###) → label undefined', () => {
        const body = [
            '# Solutions',
            '',
            '## Python',
            FENCE + 'python',
            'def demo(): return 0',
            FENCE,
        ].join('\n');
        const parsed = parseLeetCode(baseDoc(body));
        assert.strictEqual(parsed.solutions.length, 1);
        assert.strictEqual(parsed.solutions[0].language, 'python');
        assert.strictEqual(parsed.solutions[0].label, undefined);
        assert.ok(parsed.solutions[0].code.includes('def demo()'));
    });

    test('multiple ### under same ## → multiple solutions for that language', () => {
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
        const parsed = parseLeetCode(baseDoc(body));
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
        const parsed = parseLeetCode(baseDoc(body));
        assert.strictEqual(parsed.solutions.length, 2);
        assert.strictEqual(parsed.solutions[0].label, 'Solution #1');
        assert.strictEqual(parsed.solutions[1].label, 'Solution #2');
    });

    test('no # Solutions → empty array', () => {
        const parsed = parseLeetCode(baseDoc(''));
        assert.deepStrictEqual(parsed.solutions, []);
    });

    test('<!-- meta: { ... } --> before fence → solvedAt and duration parsed', () => {
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
        const parsed = parseLeetCode(baseDoc(body));
        assert.strictEqual(parsed.solutions[0].solvedAt, '2025-05-12T14:30:00');
        assert.strictEqual(parsed.solutions[0].duration, '8m22s');
    });

    test('missing meta comment → solvedAt and duration undefined', () => {
        const body = [
            '# Solutions',
            '',
            '## Java',
            '### Hash Map',
            FENCE + 'java',
            'int x = 0;',
            FENCE,
        ].join('\n');
        const parsed = parseLeetCode(baseDoc(body));
        assert.strictEqual(parsed.solutions[0].solvedAt, undefined);
        assert.strictEqual(parsed.solutions[0].duration, undefined);
    });

    // ── Attempts (wiring only — extractAttempts itself is tested below) ─────────

    test('# Attempts is wired into parsed.attempts', () => {
        const body = [
            '# Attempts',
            '',
            '## Java',
            '<!-- attempt: { "at": "2026-07-10T00:00:00Z", "duration": "1m0s", "passed": true } -->',
            FENCE + 'java',
            'int x;',
            FENCE,
        ].join('\n');
        const parsed = parseLeetCode(baseDoc(body));
        assert.strictEqual(parsed.attempts.length, 1);
        assert.strictEqual(parsed.attempts[0].language, 'java');
    });

    test('no # Attempts section → empty attempts array', () => {
        const parsed = parseLeetCode(baseDoc(''));
        assert.deepStrictEqual(parsed.attempts, []);
    });

    // ── functions: block ──────────────────────────────────────────────────────

    test('parses a functions: block into a per-language map', () => {
        const fm = ['type: leetcode', 'title: AB Check'].join('\n');
        const body = cfg([
            'function: ABCheck',
            'params: []',
            'returns: bool',
            'functions:',
            '  python: ab_check',
            '  rust: ab_check',
        ].join('\n'));
        const parsed = parseLeetCode(build(fm, body));
        assert.deepStrictEqual(parsed.functions, { python: 'ab_check', rust: 'ab_check' });
    });

    test('an aliased language key in functions: resolves to its canonical id', () => {
        const body = cfg([BASE_SIG, 'functions:', '  py: demo_snake'].join('\n'));
        const parsed = parseLeetCode(build(BASE_FM, body));
        assert.deepStrictEqual(parsed.functions, { python: 'demo_snake' });
    });

    test('no functions: block → undefined map', () => {
        const parsed = parseLeetCode(baseDoc(''));
        assert.strictEqual(parsed.functions, undefined);
    });

    // ── tags: block ──────────────────────────────────────────────────────────
    // tags: is a D2-retained frontmatter key (§2.1) — it stays in frontmatter,
    // only the signature moves to the body fence.

    test('parses an inline tags: array', () => {
        const fm = [
            'type: leetcode',
            'title: Two Sum',
            'tags: [leetcode, arrays, hash-map]',
        ].join('\n');
        const body = cfg('function: twoSum\nparams: []\nreturns: int[]');
        const parsed = parseLeetCode(build(fm, body));
        assert.deepStrictEqual(parsed.tags, ['leetcode', 'arrays', 'hash-map']);
    });

    test('parses a YAML list tags: block', () => {
        const fm = [
            'type: leetcode',
            'title: Two Sum',
            'tags:',
            '  - leetcode',
            '  - arrays',
        ].join('\n');
        const body = cfg('function: twoSum\nparams: []\nreturns: int[]');
        const parsed = parseLeetCode(build(fm, body));
        assert.deepStrictEqual(parsed.tags, ['leetcode', 'arrays']);
    });

    test('no tags: field → empty array', () => {
        const parsed = parseLeetCode(baseDoc(''));
        assert.deepStrictEqual(parsed.tags, []);
    });

    test('tags: [] → empty array', () => {
        const fm = [BASE_FM, 'tags: []'].join('\n');
        const parsed = parseLeetCode(build(fm, cfg(BASE_SIG)));
        assert.deepStrictEqual(parsed.tags, []);
    });

    // ── D4 — a body-set key left in frontmatter is ignored, and warned ─────────

    test('D4: params: left in frontmatter is ignored (not read) and produces a warning', () => {
        const fm = [
            'type: leetcode',
            'title: Demo',
            'params:',
            '  - name: nums',
            '    type: int[]',
        ].join('\n');
        // function/returns correctly live in the body fence; only params: was
        // left behind in frontmatter — the one defect under test.
        const body = cfg('function: demo\nreturns: int');
        const parsed = parseLeetCode(build(fm, body));

        assert.deepStrictEqual(parsed.params, []); // ignored, not read from frontmatter
        assert.strictEqual(parsed.functionName, 'demo'); // the body fence still parses normally
        assert.deepStrictEqual(parsed.warnings, [
            "frontmatter 'params:' is ignored — move it into a 'yaml leetcode' body fence",
        ]);
    });

    test('a clean v2 artifact has warnings === undefined, never []', () => {
        const parsed = parseLeetCode(baseDoc(''));
        assert.strictEqual(parsed.warnings, undefined);
    });

    // ── CRLF — nothing in this repo previously pinned CRLF handling ────────────
    // An Obsidian vault synced from Windows writes CRLF; FRONTMATTER_RE, the
    // config-fence scanner, and sectionBounds all claim \r?\n support but were
    // untested end to end. CRLF is not output-invariant (the \r survives into
    // description/code text), so this asserts structure, not a byte-exact
    // parse result — chosen fixture exercises the config-fence extractor
    // (function/params/returns) and the ## Tests JSON extractor together.

    test('CRLF input still parses — config fence and ## Tests both survive \\r\\n', () => {
        const body = [
            cfg(NUMS_TARGET_SIG),
            '',
            '## Tests',
            FENCE + 'json',
            '[{ "input": { "nums": [1], "target": 1 }, "expected": [0] }]',
            FENCE,
        ].join('\n');
        const lfDoc = build(BASE_FM, body);
        const parsed = parseLeetCode(lfDoc.replace(/\n/g, '\r\n'));

        assert.strictEqual(parsed.functionName, 'demo');
        assert.strictEqual(parsed.params.length, 2);
        assert.strictEqual(parsed.tests.length, 1);
    });

});

// ── parseFrontmatterOnly ────────────────────────────────────────────────────────

suite('parseFrontmatterOnly', () => {

    function build(frontmatter: string, body: string): string {
        return ['---', frontmatter, '---', '', body].join('\n');
    }

    test('parses title, difficulty, status, algorithm, tags without touching the body', () => {
        const fm = [
            'type: leetcode',
            'title: Two Sum',
            'difficulty: medium',
            'algorithm: hash-map',
            'status: solved',
            'tags: [arrays, hash-map]',
        ].join('\n');
        // A body-set config fence (correctly ignored — this fast path never
        // reads the body) plus deliberately invalid JSON, so the assertion
        // proves both: the body is never parsed, and a fenced config block
        // living there changes nothing.
        const body = [
            '```yaml leetcode',
            'function: twoSum',
            'params: []',
            'returns: int[]',
            '```',
            '',
            '## Tests',
            '```json',
            'not valid json — must never be touched',
            '```',
        ].join('\n');
        const summary = parseFrontmatterOnly(build(fm, body));
        assert.deepStrictEqual(summary, {
            title: 'Two Sum',
            // No `leetcodeType:` declared and no `test:` block in frontmatter
            // (this fixture's is in a body fence, which this fast path never
            // reads) — derives the single-buffer default (plan §C.6).
            leetcodeType: 'function',
            difficulty: 'medium',
            status: 'solved',
            algorithm: 'hash-map',
            tags: ['arrays', 'hash-map'],
        });
    });

    test('defaults match parseLeetCode when frontmatter is minimal', () => {
        const fm = ['type: leetcode', 'title: Demo'].join('\n');
        const summary = parseFrontmatterOnly(build(fm, ''));
        assert.strictEqual(summary.difficulty, 'easy');
        assert.strictEqual(summary.status, 'unsolved');
        assert.strictEqual(summary.algorithm, undefined);
        assert.deepStrictEqual(summary.tags, []);
    });

});

// ── functionNameFor ───────────────────────────────────────────────────────────

suite('functionNameFor', () => {

    function fixture(overrides: Partial<ParsedLeetCode> = {}): ParsedLeetCode {
        return {
            title: 'AB Check', difficulty: 'easy', functionName: 'ABCheck', status: 'unsolved',
            params: [], returns: 'bool', description: '', examples: [],
            tests: [], finalTests: [], test: defaultTestConfig(),
            setups: [], practice: defaultPracticeConfig(), solutions: [], attempts: [], tags: [],
            ...overrides,
        };
    }

    test('returns the override for a listed language', () => {
        const parsed = fixture({ functions: { python: 'ab_check' } });
        assert.strictEqual(functionNameFor(parsed, 'python'), 'ab_check');
    });

    test('falls back to functionName for an unlisted language', () => {
        const parsed = fixture({ functions: { python: 'ab_check' } });
        assert.strictEqual(functionNameFor(parsed, 'java'), 'ABCheck');
    });

    test('falls back to functionName when no functions map is declared', () => {
        const parsed = fixture();
        assert.strictEqual(functionNameFor(parsed, 'python'), 'ABCheck');
    });
});

// ── extractAttempts ──────────────────────────────────────────────────────────
// Body-only parsing — # Attempts content was never in frontmatter, so this
// suite is unaffected by the v2 migration.

suite('extractAttempts', () => {

    const FENCE = '```';

    test('no # Attempts section → empty array', () => {
        assert.deepStrictEqual(extractAttempts(''), []);
        assert.deepStrictEqual(extractAttempts('## Tests\n```json\n[]\n```'), []);
    });

    test('parses a single attempt entry under a language heading', () => {
        const body = [
            '# Attempts',
            '',
            '## Java',
            '<!-- attempt: { "at": "2026-07-10T14:32:00Z", "duration": "8m22s", "passed": true, "bigO": "O(n)", "confidence": "medium" } -->',
            FENCE + 'java',
            'int x = 0;',
            FENCE,
        ].join('\n');
        const attempts = extractAttempts(body);
        assert.strictEqual(attempts.length, 1);
        assert.deepStrictEqual(attempts[0], {
            language: 'java',
            at: '2026-07-10T14:32:00Z',
            duration: '8m22s',
            passed: true,
            bigO: 'O(n)',
            confidence: 'medium',
            code: 'int x = 0;',
        });
    });

    test('optional bigO / confidence are omitted, not defaulted', () => {
        const body = [
            '# Attempts',
            '',
            '## Python',
            '<!-- attempt: { "at": "2026-07-10T00:00:00Z", "duration": "1m0s", "passed": false } -->',
            FENCE + 'python',
            'pass',
            FENCE,
        ].join('\n');
        const attempts = extractAttempts(body);
        assert.strictEqual(attempts[0].bigO, undefined);
        assert.strictEqual(attempts[0].confidence, undefined);
    });

    test('multiple entries under one language are parsed in file order (newest first on disk)', () => {
        const body = [
            '# Attempts',
            '',
            '## Python',
            '<!-- attempt: { "at": "2026-07-11T00:00:00Z", "duration": "2m0s", "passed": true } -->',
            FENCE + 'python',
            'pass # newest',
            FENCE,
            '',
            '<!-- attempt: { "at": "2026-07-10T00:00:00Z", "duration": "5m0s", "passed": false } -->',
            FENCE + 'python',
            'pass # oldest',
            FENCE,
        ].join('\n');
        const attempts = extractAttempts(body);
        assert.strictEqual(attempts.length, 2);
        assert.strictEqual(attempts[0].at, '2026-07-11T00:00:00Z');
        assert.strictEqual(attempts[1].at, '2026-07-10T00:00:00Z');
    });

    test('multiple ## language headings are parsed independently', () => {
        const body = [
            '# Attempts',
            '',
            '## Java',
            '<!-- attempt: { "at": "2026-07-10T00:00:00Z", "duration": "1m0s", "passed": true } -->',
            FENCE + 'java',
            'int x;',
            FENCE,
            '',
            '## Python',
            '<!-- attempt: { "at": "2026-07-10T00:00:00Z", "duration": "1m0s", "passed": false } -->',
            FENCE + 'python',
            'x = 1',
            FENCE,
        ].join('\n');
        const attempts = extractAttempts(body);
        assert.deepStrictEqual(attempts.map(a => a.language), ['java', 'python']);
    });

    test('malformed attempt comment (invalid JSON) is skipped, never throws', () => {
        const body = [
            '# Attempts',
            '',
            '## Java',
            '<!-- attempt: {not valid json} -->',
            FENCE + 'java',
            'int x;',
            FENCE,
        ].join('\n');
        assert.doesNotThrow(() => extractAttempts(body));
        assert.deepStrictEqual(extractAttempts(body), []);
    });

    test('a fenced block with no preceding attempt comment is skipped', () => {
        const body = [
            '# Attempts',
            '',
            '## Java',
            FENCE + 'java',
            'int x;',
            FENCE,
        ].join('\n');
        assert.deepStrictEqual(extractAttempts(body), []);
    });

    test('an attempt comment missing a required field (passed) is skipped', () => {
        const body = [
            '# Attempts',
            '',
            '## Java',
            '<!-- attempt: { "at": "2026-07-10T00:00:00Z", "duration": "1m0s" } -->',
            FENCE + 'java',
            'int x;',
            FENCE,
        ].join('\n');
        assert.deepStrictEqual(extractAttempts(body), []);
    });

});
