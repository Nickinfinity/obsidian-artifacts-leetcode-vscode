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
