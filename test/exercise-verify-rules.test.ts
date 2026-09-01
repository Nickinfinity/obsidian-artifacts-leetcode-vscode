import * as assert from 'node:assert';
import { verifyExercise } from '../src/services/exercise-verify.helpers.js';

/**
 * VSX-154 (T1.7) — `verifyExercise` dispatches on the **leetcode-type axis**
 * (`parsed.leetcodeType`) through a rules registry, not a hand-rolled
 * `if (parsed.test.type === 'project')` branch.
 *
 * `exercise-verify.test.ts` already pins the full `function` floor and the
 * `project`-derived `package` behaviour byte-for-byte; this suite adds only
 * what T1.7 changes: the registry-based dispatch itself, the `package:`
 * message rename, the `checks:` / `test.type` mirror rule, and the `stack`
 * routing decision.
 */
suite('exercise-verify — rules registry (leetcode-type axis)', () => {

    const NODE = process.execPath.replace(/\\/g, '\\\\');

    // ── T1.7's own test-first assertion ───────────────────────────────────
    //
    // A `package`-shaped artifact (derived from the legacy `test.type:
    // project`, same as every `exercise-verify.test.ts` project fixture)
    // declaring no `## Files` must fail structurally, before anything is
    // installed or run — and the message must come from `package.rules.ts`,
    // not the old inline `project:`-prefixed string.

    test('a package artifact with no ## Files fails with the exact registry message', async () => {
        const md = [
            '---',
            'artifactType: leetcode',
            'title: Widget',
            'difficulty: medium',
            '---',
            '',
            'A multi-file exercise.',
            '',
            '```yaml leetcode',
            'test:',
            '  type: project',
            '```',
            '',
        ].join('\n');

        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false);
        assert.strictEqual(!result.ok ? result.reason : '', 'package: no ## Files declared');
    });

    // ── registry routing: leetcodeType drives dispatch, not test.type ─────

    /** A well-formed `package` artifact: one `build` check that reads `probe.js`. */
    function buildPackageMd(opts: { testBlock?: string } = {}): string {
        const { testBlock = '' } = opts;
        return [
            '---',
            'artifactType: leetcode',
            'leetcodeType: package',
            'title: Widget',
            'difficulty: medium',
            '---',
            '',
            'A multi-file exercise.',
            '',
            '```yaml leetcode',
            testBlock,
            'checks:',
            '  - name: probe',
            '    kind: build',
            `    argv: ["${NODE}", "probe.js"]`,
            '```',
            '',
            '## Files',
            '',
            '```javascript path=probe.js role=editable',
            'process.exit(1);',
            '```',
            '',
            '# Solutions',
            '',
            '```javascript path=probe.js',
            'process.exit(0);',
            '```',
        ].join('\n');
    }

    test('a migrated package — checks, no test.type at all — verifies green', async () => {
        // This is the shape the migration *produces*: it deletes the `type:`
        // line from every `test:` block declaring `checks:`. An earlier cut of
        // the mirror rule required the legacy shape marker to be **present**,
        // which would have failed every artifact the migration writes.
        const result = await verifyExercise(buildPackageMd());
        assert.strictEqual(result.ok, true, JSON.stringify(result));
    });

    test('an unmigrated package still carrying the legacy shape marker verifies green', async () => {
        const result = await verifyExercise(buildPackageMd({ testBlock: 'test:\n  type: project' }));
        assert.strictEqual(result.ok, true, JSON.stringify(result));
    });

    test('a package that also names a real execution strategy is refused by the mirror rule', async () => {
        // The direction that stays a violation: `checks:` and a deliberately
        // named single-suite strategy are mutually exclusive. Everything else
        // about this fixture is valid — the overlay exits 0 — so a green
        // result would mean the guard was deleted, not that the fixture is
        // malformed.
        const result = await verifyExercise(buildPackageMd({ testBlock: 'test:\n  type: in-place' }));
        assert.strictEqual(result.ok, false, JSON.stringify(result));
        assert.strictEqual(
            !result.ok ? result.reason : '',
            "package: checks declared but test.type is 'in-place' — "
                + 'a checks-graded exercise must not also declare a top-level execution strategy',
        );
    });

    // ── C37: a `call` check needs the artifact's own top-level `params:` ──
    //
    // T4.4 gave `stack.rules.ts` this exact rule (its rule 3) but
    // `package.rules.ts` never checked it — so a `package` declaring a `call`
    // check with no top-level `params:` graded its cases against nothing
    // instead of failing by name. `runFunctionCheck` builds each case's
    // arguments from the artifact's own `params:`, never anything the check
    // itself declares, so this is a genuine case-shape mismatch. The rule now
    // lives once, in the shared structural path both `package.rules.ts` and
    // `stack.rules.ts` delegate through (`checkPackageStructure`) — this
    // fixture is the `package` half of the pin; `exercise-verify-stack.test.ts`
    // still pins the `stack` half, now reached the same way.

    test('a package with a call check and no top-level params fails on the case-shape mismatch', async () => {
        const md = [
            '---',
            'artifactType: leetcode',
            'leetcodeType: package',
            'title: Widget',
            'difficulty: medium',
            '---',
            '',
            'A multi-file exercise.',
            '',
            '```yaml leetcode',
            'checks:',
            '  - name: pricing',
            '    kind: call',
            '    file: index.js',
            '    function: computePrice',
            '```',
            '',
            '## Files',
            '',
            '```javascript path=index.js role=editable',
            'module.exports = { computePrice: () => 0 };',
            '```',
            '',
            '## Tests',
            '```json check=pricing',
            '[{"input": {"price": 10}, "expected": 10}]',
            '```',
        ].join('\n');

        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false, JSON.stringify(result));
        assert.strictEqual(
            !result.ok ? result.reason : '',
            "package: check 'pricing' is kind 'call' but the artifact declares no params "
                + "— a call check runs against the artifact's own top-level function shape",
        );
    });

    test('an explicit leetcodeType: stack is held to the package rules, not the function floors', async () => {
        // A `stack` is *several packages* — the most tree-shaped artifact in
        // the model — so it is graded by declared checks, never by one
        // candidate buffer. An earlier cut routed it to the function rules to
        // keep two `test.type: 'service'` fixtures green; those fixtures
        // assert the **reserved-test-type** relaxation and their `service`
        // spelling merely predated the axis, so they now say `class` and the
        // routing follows the model instead of the fixtures.
        //
        // What that routing actually bought: a `stack` could not verify in any
        // `test.type` spelling, *and* one with duplicate check names, failing
        // checks and no overlay reported ok — the function rules never look at
        // a file tree.
        //
        // T4.4 gives `stack` its own rule set (`stack.rules.ts`), whose first
        // gate is the shape check this suite pins separately
        // (`exercise-verify-stack.test.ts`); two `packages:` entries here
        // clear that gate so this fixture still exercises the *next* one down
        // — the reused package rules' `## Files` requirement — exactly as it
        // did before T4.4.
        const md = [
            '---',
            'artifactType: leetcode',
            'leetcodeType: stack',
            'title: Widget',
            'difficulty: medium',
            '---',
            '',
            'Problem description.',
            '',
            '```yaml leetcode',
            'packages:',
            '  - name: api',
            '    dir: pkg-api',
            '    install: ["noop"]',
            '    start: ["noop"]',
            '  - name: web',
            '    dir: pkg-web',
            '    install: ["noop"]',
            '    start: ["noop"]',
            '```',
            '',
            '## Examples',
            '```example',
            'input: a = 1',
            'output: 2',
            '```',
            '',
            '## Tests',
            '```json',
            '[{"input": {"a": 1}, "expected": 2}]',
            '```',
        ].join('\n');

        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false, JSON.stringify(result));
        assert.match(result.reason ?? '', /^stack: no ## Files declared$/);
    });
});
