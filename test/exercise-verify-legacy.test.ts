import * as assert from 'node:assert';
import { verifyExercise } from '../src/services/exercise-verify.helpers.js';

/**
 * T7 — `verifyExercise` fails an artifact carrying D2 body-set config
 * (`function`, `params`, `libs`, …) left in frontmatter instead of a
 * ` ```yaml leetcode ` body fence.
 *
 * `parseLeetCode` already *ignores* such a key (D4's hard cut) rather than
 * reading it, so this suite is the third leg: proving the harness reports
 * `ok: false` and names the offender, instead of silently verifying a v1
 * artifact clean.
 */
suite('exercise-verify — legacy frontmatter config', () => {

    /** A v1 artifact: every execution-config key still in frontmatter, no body fence at all. */
    const V1_FIXTURE = [
        '---',
        'type: leetcode',
        'title: Sum',
        'difficulty: easy',
        'function: sum',
        'params:',
        '  - name: a',
        '    type: int',
        '  - name: b',
        '    type: int',
        'returns: int',
        'test:',
        '  type: function',
        '---',
        '',
        'Problem description.',
        '',
        '## Examples',
        '```example',
        'input: a = 1, b = 2',
        'output: 3',
        '```',
        '',
        '## Tests',
        '```json',
        '[]',
        '```',
    ].join('\n');

    // ── Spec's own test-first assertion ───────────────────────────────────

    test('a v1 artifact (config still in frontmatter) fails', async () => {
        assert.strictEqual((await verifyExercise(V1_FIXTURE)).ok, false);
    });

    test('the message names the offending key and the fence it belongs in', async () => {
        const result = await verifyExercise(V1_FIXTURE);
        assert.strictEqual(result.ok, false);
        assert.ok(!result.ok && result.reason.includes("'function:'"), JSON.stringify(result));
        assert.ok(!result.ok && result.reason.includes('yaml leetcode'), JSON.stringify(result));
    });

    test('every offending key is named, not just the first', async () => {
        const result = await verifyExercise(V1_FIXTURE);
        assert.strictEqual(result.ok, false);
        assert.ok(!result.ok, JSON.stringify(result));
        if (!result.ok) {
            assert.ok(result.reason.includes("'function:'"), result.reason);
            assert.ok(result.reason.includes("'params:'"), result.reason);
            assert.ok(result.reason.includes("'returns:'"), result.reason);
            assert.ok(result.reason.includes("'test:'"), result.reason);
        }
    });

    // ── A clean v2 artifact must be unaffected ────────────────────────────

    interface CaseFixture { input: Record<string, unknown>; expected: unknown }

    const TESTS: CaseFixture[] = [
        { input: { a: 1, b: 2 }, expected: 3 },
        { input: { a: 5, b: 7 }, expected: 12 },
        { input: { a: 0, b: 0 }, expected: 0 },
        { input: { a: -1, b: 1 }, expected: 0 },
        { input: { a: 10, b: 20 }, expected: 30 },
        { input: { a: 100, b: 200 }, expected: 300 },
    ];
    const FINAL_TESTS: CaseFixture[] = [
        { input: { a: 2, b: 2 }, expected: 4 },
        { input: { a: 3, b: 3 }, expected: 6 },
        { input: { a: 4, b: 4 }, expected: 8 },
    ];

    /** A conforming v2 artifact: all execution config in a body fence, nothing legacy in frontmatter. */
    function buildCleanV2Md(opts: { extraFrontmatter?: string; solutionExtra?: string } = {}): string {
        const { extraFrontmatter = '', solutionExtra = '' } = opts;

        const frontmatter = [
            '---',
            'type: leetcode',
            'title: Sum',
            'difficulty: easy',
            extraFrontmatter,
            '---',
        ].filter(l => l !== '').join('\n');

        const configFence = '```yaml leetcode\n'
            + 'function: sum\n'
            + 'params:\n'
            + '  - name: a\n    type: int\n'
            + '  - name: b\n    type: int\n'
            + 'returns: int\n'
            + 'test:\n'
            + '  type: function\n'
            + '```';

        const examplesBlock = [
            '```example\ninput: a = 1, b = 2\noutput: 3\n```',
            '```example\ninput: a = 5, b = 7\noutput: 12\n```',
        ].join('\n\n');

        const solutionCode = `function sum(a, b) {\n  ${solutionExtra}\n  return a + b;\n}`;

        return `${frontmatter}\n\nProblem description.\n\n${configFence}\n\n## Examples\n${examplesBlock}\n\n`
            + `## Tests\n\`\`\`json\n${JSON.stringify(TESTS, null, 2)}\n\`\`\`\n\n`
            + `## Final Tests\n\`\`\`json\n${JSON.stringify(FINAL_TESTS, null, 2)}\n\`\`\`\n\n`
            + `# Setup\n\n## JavaScript\n\`\`\`javascript\nfunction sum(a, b) {\n  // solution here\n}\n\`\`\`\n\n`
            + `# Solutions\n\n## JavaScript\n\`\`\`javascript\n${solutionCode}\n\`\`\`\n`;
    }

    test('a clean v2 artifact (config only in a body fence) verifies ok', async () => {
        const result = await verifyExercise(buildCleanV2Md());
        assert.strictEqual(result.ok, true, JSON.stringify(result));
    });

    // ── SEC: hostile inputs ────────────────────────────────────────────────

    // A body-set key appearing ONLY inside the config fence is the correct v2
    // form — the check must not treat the fence body itself as frontmatter.
    test('SEC: body-set keys present only in the config fence do not fail', async () => {
        const result = await verifyExercise(buildCleanV2Md());
        assert.strictEqual(result.ok, true, JSON.stringify(result));
    });

    // A line that merely LOOKS like a frontmatter key (`params:`) sitting inside
    // a `# Solutions` code fence is body content, never frontmatter — the check
    // reads only the `---`-delimited block via `splitFrontmatter`, so this must
    // not misfire.
    test('SEC: a key-shaped comment inside a # Solutions code fence is not mistaken for frontmatter', async () => {
        const result = await verifyExercise(buildCleanV2Md({ solutionExtra: '// params: not frontmatter' }));
        assert.strictEqual(result.ok, true, JSON.stringify(result));
    });

    // No frontmatter block at all: `splitFrontmatter` returns `fmRaw: ''`, so
    // `legacyFrontmatterKeys` finds nothing — the check must degrade quietly
    // rather than crash, leaving any failure to a later rule (missing title).
    test('SEC: an artifact with no frontmatter at all does not crash and reports no legacy failure', async () => {
        const noFrontmatter = 'Just a body, no --- frontmatter block, no config fence.';
        const result = await verifyExercise(noFrontmatter);
        assert.strictEqual(result.ok, false);
        assert.ok(!result.ok && !result.reason.startsWith('legacy:'), JSON.stringify(result));
    });

    // CRLF frontmatter must be scanned exactly like LF — `legacyFrontmatterKeys`
    // already handles `\r?\n`, this pins that the verifier-level check inherits it.
    test('SEC: a CRLF frontmatter block carrying a legacy key still fails', async () => {
        const crlf = V1_FIXTURE.replace(/\n/g, '\r\n');
        const result = await verifyExercise(crlf);
        assert.strictEqual(result.ok, false);
        assert.ok(!result.ok && result.reason.includes("'function:'"), JSON.stringify(result));
    });

    // `paramsX:` merely starts with a body-set name — `TOP_LEVEL_KEY_RE` captures
    // the whole `\w+` token, so it must NOT be mistaken for `params`.
    test('SEC: a frontmatter key that only starts with a body-set name does not fail', async () => {
        const result = await verifyExercise(buildCleanV2Md({ extraFrontmatter: 'paramsX: unrelated' }));
        assert.strictEqual(result.ok, true, JSON.stringify(result));
    });

    // ── path prefixing still applies to this rule ─────────────────────────

    test('a supplied path is prefixed onto the legacy-key failure reason', async () => {
        const result = await verifyExercise(V1_FIXTURE, 'Strings/Bad.md');
        assert.strictEqual(result.ok, false);
        assert.ok(!result.ok && result.reason.startsWith('Strings/Bad.md: '), JSON.stringify(result));
    });

});
