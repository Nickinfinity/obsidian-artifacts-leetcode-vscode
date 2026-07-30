import * as assert from 'node:assert';
import { defaultTestConfig, parseLeetCode } from '../src/services/leetcode-parser.service.js';

/**
 * Unit tests for the `test:` body config-fence block — the sibling of
 * `practice:` that selects the execution strategy and the per-case timeout.
 * Both moved out of frontmatter into ` ```yaml leetcode ` fences (§2.5).
 */
suite('leetcode test: config', () => {

    const FENCE = '```';

    /**
     * Compose a `.md` artifact whose `test:`/`practice:` block (when given)
     * lives in a body config fence, never frontmatter — v2, §2.5. An empty
     * `configFence` omits the fence entirely, matching "no block ⇒ no fence."
     */
    function artifact(configFence: string): string {
        const fence = configFence === '' ? '' : `${FENCE}yaml leetcode\n${configFence}${FENCE}\n\n`;
        return `---\ntype: leetcode\ntitle: Two Sum\n---\n\nProse.\n\n${fence}`;
    }

    test('an absent block yields the defaults', () => {
        const parsed = parseLeetCode(artifact(''));
        assert.deepStrictEqual(parsed.test, { type: 'function', timeoutMs: 5000 });
    });

    test('defaultTestConfig returns a fresh object each call', () => {
        const a = defaultTestConfig();
        const b = defaultTestConfig();
        a.timeoutMs = 1;
        assert.strictEqual(b.timeoutMs, 5000);
    });

    test('an explicit type is honoured', () => {
        assert.strictEqual(parseLeetCode(artifact('test:\n  type: class\n')).test.type, 'class');
        assert.strictEqual(parseLeetCode(artifact('test:\n  type: in-place\n')).test.type, 'in-place');
    });

    test('an unknown type falls back to function rather than breaking the exercise', () => {
        assert.strictEqual(parseLeetCode(artifact('test:\n  type: quantum\n')).test.type, 'function');
    });

    test('timeoutMs is parsed', () => {
        assert.strictEqual(parseLeetCode(artifact('test:\n  timeoutMs: 2000\n')).test.timeoutMs, 2000);
    });

    test('timeoutMs is clamped to a runnable floor', () => {
        assert.strictEqual(parseLeetCode(artifact('test:\n  timeoutMs: 0\n')).test.timeoutMs, 100);
        assert.strictEqual(parseLeetCode(artifact('test:\n  timeoutMs: -50\n')).test.timeoutMs, 100);
    });

    test('timeoutMs is clamped to the suite ceiling', () => {
        assert.strictEqual(parseLeetCode(artifact('test:\n  timeoutMs: 900000\n')).test.timeoutMs, 60_000);
    });

    test('an unparsable timeoutMs falls back to the default', () => {
        assert.strictEqual(parseLeetCode(artifact('test:\n  timeoutMs: soon\n')).test.timeoutMs, 5000);
    });

    test('both sub-keys together', () => {
        const parsed = parseLeetCode(artifact('test:\n  type: function\n  timeoutMs: 1500\n'));
        assert.deepStrictEqual(parsed.test, { type: 'function', timeoutMs: 1500 });
    });

    test('the block does not swallow the frontmatter keys after it', () => {
        const parsed = parseLeetCode(artifact('test:\n  timeoutMs: 1500\ndifficulty: hard\n'));
        assert.strictEqual(parsed.test.timeoutMs, 1500);
        assert.strictEqual(parsed.difficulty, 'hard');
    });

    test('test: and practice: blocks coexist', () => {
        const fm = 'test:\n  timeoutMs: 1200\npractice:\n  timeLimit: 20\n';
        const parsed = parseLeetCode(artifact(fm));
        assert.strictEqual(parsed.test.timeoutMs, 1200);
        assert.strictEqual(parsed.practice.timeLimitMinutes, 20);
    });
});
