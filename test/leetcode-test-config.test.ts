import * as assert from 'node:assert';
import { defaultTestConfig, parseLeetCode } from '../src/services/leetcode-parser.service.js';
import { SHAPE_TEST_TYPE_IDS, TEST_TYPES } from '../src/types/constants.js';
import { languagesForType } from '../src/services/test-envs/env.registry.js';

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
        assert.deepStrictEqual(parsed.test, { type: 'call', timeoutMs: 5000 });
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

    test('an unknown type falls back to the default rather than breaking the exercise', () => {
        assert.strictEqual(parseLeetCode(artifact('test:\n  type: quantum\n')).test.type, 'call');
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
        const parsed = parseLeetCode(artifact('test:\n  type: call\n  timeoutMs: 1500\n'));
        assert.deepStrictEqual(parsed.test, { type: 'call', timeoutMs: 1500 });
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

        test('`call` is implemented — the five envs register under it (T3.5)', () => {
            // `status` is the table's claim about the tree — an id marked
            // implemented before its implementation lands contradicts the
            // registry, which is what `languagesForType` actually reads.
            assert.strictEqual(TEST_TYPES.find(t => t.id === 'call')?.status, 'implemented');
            assert.deepStrictEqual(
                languagesForType('call', 'function'),
                ['java', 'javascript', 'python', 'rust', 'typescript'],
            );
        });

        test('the legacy ids are gone from the vocabulary entirely', () => {
            // They survive only as derivation inputs read off the raw scalar
            // (`deriveLeetcodeType`); a table row would make them authorable.
            const ids = new Set<string>(TEST_TYPES.map(t => t.id));
            for (const legacy of ['function', 'stdin-stdout', 'project', 'service']) {
                assert.ok(!ids.has(legacy), `${legacy} must not be a test type`);
            }
        });

        test('the vocabulary carries every merged id', () => {
            const ids = new Set<string>(TEST_TYPES.map(t => t.id));
            for (const id of ['call', 'program', 'http', 'build', 'dom-assert', 'css-assert', 'class', 'in-place']) {
                assert.ok(ids.has(id), `missing ${id}`);
            }
        });

        test('the check kinds that used to live in VALID_KINDS are all declared here', () => {
            // The set `project-parser.helpers.ts` hardcoded before the merge —
            // with `function` now spelled `call`, which is the whole point of
            // the merge: one id, one meaning.
            const ids = new Set<string>(TEST_TYPES.map(t => t.id));
            for (const kind of ['call', 'build', 'dom-assert', 'css-assert', 'http']) {
                assert.ok(ids.has(kind), `missing kind ${kind}`);
            }
        });

        test('`http` and `program` are implemented as of T3.4/T2.8', () => {
            assert.strictEqual(TEST_TYPES.find(t => t.id === 'http')?.status, 'implemented');
            assert.strictEqual(TEST_TYPES.find(t => t.id === 'program')?.status, 'implemented');
        });

        test('an implemented check kind is dispatched, never registered', () => {
            // `http`, `build` and the two render kinds are dispatched per check
            // by `runOneCheck` against an already-written directory, so the
            // registry answers `[]` for them — the coverage sweep asks the
            // parser instead. A registration here would be a stub env that
            // refuses every candidate, which is what T3.5 deleted.
            for (const kind of ['http', 'build', 'dom-assert', 'css-assert'] as const) {
                assert.deepStrictEqual(languagesForType(kind, 'package'), [], kind);
            }
        });

        test('every id is unique — a duplicate row would shadow a status', () => {
            const ids = TEST_TYPES.map(t => t.id);
            assert.strictEqual(new Set(ids).size, ids.length);
        });

        test('the shape ids are the two that were never a way to deliver a case', () => {
            assert.deepStrictEqual([...SHAPE_TEST_TYPE_IDS].sort(), ['project', 'service']);
            // `function` was the legacy spelling of `call`, not a shape — the
            // verifier's mirror rule must keep tolerating it as a `type:`.
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
        // Every kind-specific field is supplied, so the only reason a check is
        // ever dropped here is its `kind` — a check missing `function:` or
        // `package:` would otherwise read as an undispatchable kind.
        function checkWarnings(kind: string): string[] {
            const fm = [
                'test:', '  type: project', '  checks:',
                '    - name: c', `      kind: ${kind}`, '      file: a.js',
                '      function: f', '      package: api', '      argv: ["true"]',
            ].join('\n');
            return parseLeetCode(artifact(`${fm}\n`)).warnings ?? [];
        }

        test('`kind: call` is dispatchable as of T3.5 — it is what `kind: function` was renamed to', () => {
            assert.deepStrictEqual(checkWarnings('call').filter(w => w.includes('kind')), []);
        });

        test('`kind: http` is dispatchable as of T3.5', () => {
            assert.deepStrictEqual(checkWarnings('http').filter(w => w.includes('kind')), []);
        });

        test('`kind: function` is now unknown — the legacy spelling was rewritten in the vault', () => {
            assert.ok(checkWarnings('function').some(w => w.includes('unknown kind')));
        });

        test('`kind: program` is reserved — declared by the vocabulary, dispatched by nothing', () => {
            assert.ok(checkWarnings('program').some(w => w.includes('no environment implements')));
        });

        test('`kind: project` is unknown, not reserved — a shape was never a way to deliver a case', () => {
            assert.ok(checkWarnings('project').some(w => w.includes('unknown kind')));
        });

        test('an explicit `type: call` is honoured', () => {
            assert.strictEqual(parseLeetCode(artifact('test:\n  type: call\n')).test.type, 'call');
        });

        /**
         * The legacy spellings are no longer members of the vocabulary (T3.5),
         * so they collapse to `DEFAULT_TEST_TYPE` exactly as any other
         * unrecognised value does — an unmigrated artifact still **parses**,
         * and reads as the one thing a legacy `function` ever meant.
         *
         * **C3's discriminating input, and the reason it could not be written
         * before now.** `project` collapses to `call` while its *shape*
         * derives to `package`: two different answers from one scalar, which is
         * only possible because the derivation reads the **raw** value before
         * this fallback runs. While `project` was still a `TestTypeId` no input
         * could tell the raw read from the parsed one, and a "simplification"
         * to `fm.test.type` would have passed the whole gate.
         */
        test('a legacy scalar collapses to the default, and still derives its shape', () => {
            for (const [legacy, shape] of [
                ['function', 'function'], ['stdin-stdout', 'function'],
                ['project', 'package'], ['service', 'stack'],
            ] as const) {
                const parsed = parseLeetCode(artifact(`test:\n  type: ${legacy}\n`));
                assert.strictEqual(parsed.test.type, 'call', legacy);
                assert.strictEqual(parsed.leetcodeType, shape, legacy);
            }
        });
    });
});
