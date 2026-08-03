import * as assert from 'node:assert';
import { defaultTestConfig, parseLeetCode } from '../src/services/leetcode-parser.service.js';
import { SHAPE_TEST_TYPE_IDS, TEST_TYPES } from '../src/types/constants.js';

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

    // ── The merged vocabulary ────────────────────────────────────────────────
    //
    // `test.type` and a check's `kind:` draw from one id set. They used to be
    // two tables that both listed `function` meaning different things, which
    // is why a check-graded artifact could not name a per-check strategy.

    suite('merged test-type vocabulary', () => {

        test('`call` is declared', () => {
            assert.ok(TEST_TYPES.some(t => t.id === 'call'));
        });

        test('`call` stays reserved while every env still answers to `function`', () => {
            // `status` is the table's claim about the tree — an id marked
            // implemented before its implementation lands contradicts the
            // registry, which is what `languagesForType` actually reads.
            assert.strictEqual(TEST_TYPES.find(t => t.id === 'call')?.status, 'reserved');
            assert.strictEqual(TEST_TYPES.find(t => t.id === 'function')?.status, 'implemented');
        });

        test('the vocabulary carries every merged id', () => {
            const ids = new Set<string>(TEST_TYPES.map(t => t.id));
            for (const id of ['call', 'program', 'http', 'build', 'dom-assert', 'css-assert', 'class', 'in-place']) {
                assert.ok(ids.has(id), `missing ${id}`);
            }
        });

        test('the check kinds that used to live in VALID_KINDS are all declared here', () => {
            // The set `project-parser.helpers.ts` hardcoded before the merge.
            const ids = new Set<string>(TEST_TYPES.map(t => t.id));
            for (const kind of ['function', 'build', 'dom-assert', 'css-assert']) {
                assert.ok(ids.has(kind), `missing kind ${kind}`);
            }
        });

        test('`http` stays reserved until an environment implements it', () => {
            assert.strictEqual(TEST_TYPES.find(t => t.id === 'http')?.status, 'reserved');
            assert.strictEqual(TEST_TYPES.find(t => t.id === 'program')?.status, 'reserved');
        });

        test('every id is unique — a duplicate row would shadow a status', () => {
            const ids = TEST_TYPES.map(t => t.id);
            assert.strictEqual(new Set(ids).size, ids.length);
        });

        test('the shape ids are the two that were never a way to deliver a case', () => {
            assert.deepStrictEqual([...SHAPE_TEST_TYPE_IDS].sort(), ['project', 'service']);
            // `function` is the legacy spelling of `call` and a live check kind
            // in the vault — excluding it would drop two real checks.
            assert.ok(!SHAPE_TEST_TYPE_IDS.has('function'));
        });

        // A check's `kind:` draws from the vocabulary, but *only* the ids
        // `runOneCheck` can dispatch. Deriving the set from `status:
        // implemented` instead admitted `kind: call`, which matches no case in
        // that switch — it fell through to the render branch and was graded as
        // a `dom-assert`.
        // `type: project` is what dispatches to the project parser — without it
        // the artifact parses as a function exercise and reports no warnings at
        // all, which would make every assertion below vacuously pass.
        function checkWarnings(kind: string): string[] {
            const fm = [
                'test:', '  type: project', '  checks:',
                '    - name: c', `      kind: ${kind}`, '      file: a.js',
            ].join('\n');
            return parseLeetCode(artifact(`${fm}\n`)).warnings ?? [];
        }

        test('`kind: call` is not dispatchable and is dropped, never graded as a render check', () => {
            const warnings = checkWarnings('call');
            assert.ok(
                warnings.some(w => w.includes("'c'") && w.includes('call')),
                `expected a dropped-check warning, got ${JSON.stringify(warnings)}`,
            );
        });

        test('`kind: function` is still dispatchable — two vault checks declare it', () => {
            assert.deepStrictEqual(checkWarnings('function').filter(w => w.includes('kind')), []);
        });

        test('`kind: project` is unknown, not reserved — a shape was never a way to deliver a case', () => {
            assert.ok(checkWarnings('project').some(w => w.includes('unknown kind')));
        });

        test('an explicit `type: call` is honoured', () => {
            assert.strictEqual(parseLeetCode(artifact('test:\n  type: call\n')).test.type, 'call');
        });

        test('the legacy `type: function` still parses — an unmigrated artifact is readable', () => {
            assert.strictEqual(parseLeetCode(artifact('test:\n  type: function\n')).test.type, 'function');
        });
    });
});
