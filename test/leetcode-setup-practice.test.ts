import * as assert from 'node:assert';
import { parseLeetCode } from '../src/services/leetcode-parser.service.js';

/**
 * Unit tests for the two features added alongside the "Solve It" flow: the
 * `# Setup` starter-code tree (a body section, unaffected by the v2 move)
 * and the `practice:` block, which v2 relocated out of frontmatter into a
 * body ` ```yaml leetcode ` config fence (§2.5).
 */
suite('leetcode-setup-practice', () => {

    const FENCE = '```';

    /**
     * Compose a `.md` artifact whose `practice:` block (when given) lives in
     * a body config fence, never frontmatter — v2, §2.5. An empty
     * `configFence` omits the fence entirely, matching "no block ⇒ no fence."
     */
    function artifact(configFence: string, body: string): string {
        const fence = configFence === '' ? '' : `${FENCE}yaml leetcode\n${configFence}${FENCE}\n\n`;
        return `---\ntype: leetcode\ntitle: Sliding Window\n---\n\nProse.\n\n${fence}${body}`;
    }

    // ── # Setup ───────────────────────────────────────────────────────────────

    suite('# Setup section', () => {

        const setupBody = [
            '# Setup',
            '',
            '## JavaScript',
            `${FENCE}javascript`,
            'function slidingWindow(a, b) {',
            '\t// solution here',
            '}',
            FENCE,
            '',
            '## Python',
            `${FENCE}python`,
            'def sliding_window(a, b):',
            '\tpass',
            FENCE,
            '',
            '# Solutions',
            '',
            '## JavaScript',
            `${FENCE}javascript`,
            'function slidingWindow(a, b) { return 42; }',
            FENCE,
        ].join('\n');

        test('parses one setup per language heading', () => {
            const parsed = parseLeetCode(artifact('', setupBody));
            assert.strictEqual(parsed.setups.length, 2);
            assert.deepStrictEqual(parsed.setups.map(s => s.language), ['javascript', 'python']);
        });

        test('setup code keeps the starter body verbatim', () => {
            const parsed = parseLeetCode(artifact('', setupBody));
            const js = parsed.setups.find(s => s.language === 'javascript');
            assert.ok(js);
            assert.ok(js.code.includes('function slidingWindow(a, b) {'));
            assert.ok(js.code.includes('// solution here'));
        });

        test('# Solutions is not swallowed by the # Setup section', () => {
            const parsed = parseLeetCode(artifact('', setupBody));
            assert.strictEqual(parsed.solutions.length, 1);
            assert.ok(parsed.solutions[0].code.includes('return 42'));
        });

        test('missing # Setup yields an empty setups array', () => {
            const parsed = parseLeetCode(artifact('', '## Examples\n'));
            assert.deepStrictEqual(parsed.setups, []);
        });
    });

    // ── practice: frontmatter ─────────────────────────────────────────────────

    suite('practice: frontmatter block', () => {

        test('absent block falls back to the library defaults', () => {
            const parsed = parseLeetCode(artifact('', ''));
            assert.deepStrictEqual(parsed.practice.options, ['noCompletion', 'noAiAgents']);
            assert.strictEqual(parsed.practice.timeLimitMinutes, 0);
            assert.strictEqual(parsed.practice.locked, false);
        });

        test('inline options list replaces the defaults', () => {
            const fm = 'practice:\n  options: [noSnippets, noParameterHints]\n';
            const parsed = parseLeetCode(artifact(fm, ''));
            assert.deepStrictEqual(parsed.practice.options, ['noSnippets', 'noParameterHints']);
        });

        test('YAML list options are collected', () => {
            const fm = 'practice:\n  options:\n    - noAiAgents\n    - noSnippets\n';
            const parsed = parseLeetCode(artifact(fm, ''));
            assert.deepStrictEqual(parsed.practice.options, ['noAiAgents', 'noSnippets']);
        });

        test('an explicitly empty list means no restrictions', () => {
            const parsed = parseLeetCode(artifact('practice:\n  options: []\n', ''));
            assert.deepStrictEqual(parsed.practice.options, []);
        });

        test('unknown option ids are dropped', () => {
            const fm = 'practice:\n  options: [noCompletion, disableGravity]\n';
            const parsed = parseLeetCode(artifact(fm, ''));
            assert.deepStrictEqual(parsed.practice.options, ['noCompletion']);
        });

        test('duplicate option ids collapse', () => {
            const fm = 'practice:\n  options: [noCompletion, noCompletion]\n';
            const parsed = parseLeetCode(artifact(fm, ''));
            assert.deepStrictEqual(parsed.practice.options, ['noCompletion']);
        });

        test('timeLimit and locked are parsed', () => {
            const fm = 'practice:\n  timeLimit: 45\n  locked: true\n';
            const parsed = parseLeetCode(artifact(fm, ''));
            assert.strictEqual(parsed.practice.timeLimitMinutes, 45);
            assert.strictEqual(parsed.practice.locked, true);
        });

        test('a negative or unparsable timeLimit falls back to no limit', () => {
            assert.strictEqual(parseLeetCode(artifact('practice:\n  timeLimit: -5\n', '')).practice.timeLimitMinutes, 0);
            assert.strictEqual(parseLeetCode(artifact('practice:\n  timeLimit: soon\n', '')).practice.timeLimitMinutes, 0);
        });

        test('locked defaults to false for any value other than true', () => {
            const parsed = parseLeetCode(artifact('practice:\n  locked: yes\n', ''));
            assert.strictEqual(parsed.practice.locked, false);
        });

        test('the block does not swallow the frontmatter keys after it', () => {
            const fm = 'practice:\n  timeLimit: 10\ndifficulty: hard\n';
            const parsed = parseLeetCode(artifact(fm, ''));
            assert.strictEqual(parsed.practice.timeLimitMinutes, 10);
            assert.strictEqual(parsed.difficulty, 'hard');
        });

        test('defaults are a fresh object per parse', () => {
            const a = parseLeetCode(artifact('', ''));
            const b = parseLeetCode(artifact('', ''));
            a.practice.options.push('noSnippets');
            assert.deepStrictEqual(b.practice.options, ['noCompletion', 'noAiAgents']);
        });
    });
});
