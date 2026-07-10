import * as assert from 'node:assert';
import { extractFinalTests, extractTests } from '../src/services/leetcode-sections.helpers.js';
import { parseLeetCode } from '../src/services/leetcode-parser.service.js';

/**
 * Unit tests for the `## Final Tests` grading section.
 *
 * The interesting property is that the two test sections must not swallow each
 * other in either document order — `## Tests` is anchored, so `## Final Tests`
 * cannot match it, and each slice ends at the next heading.
 */
suite('leetcode ## Final Tests', () => {

    const FENCE = '```';

    /** Build a body with the two JSON sections in the given order. */
    function body(...sections: string[]): string {
        return sections.join('\n\n');
    }

    const publicSection = [
        '## Tests',
        `${FENCE}json`,
        '[{ "input": { "x": 1 }, "expected": 2 }]',
        FENCE,
    ].join('\n');

    const finalSection = [
        '## Final Tests',
        `${FENCE}json`,
        '[{ "input": { "x": 3 }, "expected": 6 }, { "input": { "x": 4 }, "expected": 8 }]',
        FENCE,
    ].join('\n');

    // ── extractFinalTests ─────────────────────────────────────────────────────

    suite('extractFinalTests', () => {

        test('parses the grading cases', () => {
            const cases = extractFinalTests(body(publicSection, finalSection));
            assert.strictEqual(cases.length, 2);
            assert.deepStrictEqual(cases[0], { input: { x: 3 }, expected: 6 });
        });

        test('an absent section yields an empty array, never a throw', () => {
            assert.deepStrictEqual(extractFinalTests(body(publicSection)), []);
        });

        test('a malformed JSON fence yields an empty array, never a throw', () => {
            const broken = ['## Final Tests', `${FENCE}json`, '[{ oops', FENCE].join('\n');
            assert.deepStrictEqual(extractFinalTests(broken), []);
        });

        test('a section with no fence yields an empty array', () => {
            assert.deepStrictEqual(extractFinalTests('## Final Tests\n\nnothing here\n'), []);
        });
    });

    // ── Mutual non-interference ───────────────────────────────────────────────

    suite('the two sections do not swallow each other', () => {

        test('## Tests before ## Final Tests', () => {
            const src = body(publicSection, finalSection);
            assert.strictEqual(extractTests(src).length, 1);
            assert.strictEqual(extractFinalTests(src).length, 2);
        });

        test('## Final Tests before ## Tests', () => {
            const src = body(finalSection, publicSection);
            assert.strictEqual(extractTests(src).length, 1);
            assert.strictEqual(extractFinalTests(src).length, 2);
        });

        test('## Tests never matches the ## Final Tests heading', () => {
            assert.deepStrictEqual(extractTests(finalSection), []);
        });

        test('a following heading terminates the final section', () => {
            const src = body(finalSection, '# Setup\n\n## JavaScript\n' + `${FENCE}javascript\nfn();\n${FENCE}`);
            assert.strictEqual(extractFinalTests(src).length, 2);
        });
    });

    // ── parseLeetCode wiring ──────────────────────────────────────────────────

    suite('parseLeetCode', () => {

        function artifact(sections: string): string {
            return `---\ntype: leetcode\ntitle: T\nfunction: f\nreturns: int\nparams: []\n---\n\nProse.\n\n${sections}`;
        }

        test('populates finalTests alongside tests', () => {
            const parsed = parseLeetCode(artifact(body(publicSection, finalSection)));
            assert.strictEqual(parsed.tests.length, 1);
            assert.strictEqual(parsed.finalTests.length, 2);
        });

        test('a legacy artifact with only ## Tests reports finalTests as empty', () => {
            const parsed = parseLeetCode(artifact(publicSection));
            assert.strictEqual(parsed.tests.length, 1);
            assert.deepStrictEqual(parsed.finalTests, []);
        });

        test('the parser applies no fallback — that belongs to submitSuite', () => {
            const parsed = parseLeetCode(artifact(publicSection));
            assert.notDeepStrictEqual(parsed.finalTests, parsed.tests);
        });
    });
});
