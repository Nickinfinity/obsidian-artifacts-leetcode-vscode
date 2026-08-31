import * as assert from 'node:assert';
import { verifyExercise } from '../src/services/exercise-verify.helpers.js';

/**
 * VSX-181 (T4.4) — `stack.rules.ts` gives `leetcodeType: stack` its own rule
 * set instead of borrowing `verifyPackageExercise` wholesale (see
 * `rules.registry.ts`'s JSDoc for the routing history).
 *
 * Three rules are new (shape, http wiring, call-check shape); everything else
 * a `stack` is held to is the reused `package` rule set, already pinned by
 * `exercise-verify-rules.test.ts` and `exercise-verify.test.ts` — this suite
 * does not re-pin that, only that a `stack` genuinely reaches it.
 *
 * Every fixture here fails **before** `runProjectChecks` — a `stack` with two
 * or more `packages:` entries unconditionally boots all of them
 * (`gradeProjectDir`), so a green-path or execution-reaching test would need
 * real, bootable servers. That is exactly why the vault sweep gates a `stack`
 * behind `LEET_STACK_E2E=1`; this suite stays fast and offline by construction,
 * proving only the structural rules that fire before anything is installed or
 * booted.
 */
suite('exercise-verify — stack.rules.ts', () => {

    /** A minimal, valid two-entry `packages:` block — never executed by any test here. */
    const TWO_PACKAGES = [
        'packages:',
        '  - name: api',
        '    dir: pkg-api',
        '    install: ["noop"]',
        '    start: ["noop"]',
        '  - name: web',
        '    dir: pkg-web',
        '    install: ["noop"]',
        '    start: ["noop"]',
    ].join('\n');

    /** Wraps a body (everything after the description) in a well-formed `leetcodeType: stack` frontmatter. */
    function stackMd(body: string): string {
        return [
            '---',
            'artifactType: leetcode',
            'leetcodeType: stack',
            'title: Widget',
            'difficulty: medium',
            '---',
            '',
            'A multi-package exercise.',
            '',
            body,
        ].join('\n');
    }

    function reasonOf(result: Awaited<ReturnType<typeof verifyExercise>>): string {
        return result.ok ? '' : result.reason;
    }

    // ── Rule 1: shape — a stack is several packages, never zero or one ───────
    // T4.4's own test-first assertion.

    test('a stack declaring one package fails with the shape rule', async () => {
        const md = stackMd([
            '```yaml leetcode',
            'packages:',
            '  - name: api',
            '    dir: pkg-api',
            '    install: ["noop"]',
            '    start: ["noop"]',
            '```',
        ].join('\n'));

        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false);
        assert.strictEqual(reasonOf(result), 'stack: needs more than one package');
    });

    test('a stack declaring no packages at all fails the same way', async () => {
        const md = stackMd('No packages block declared at all.');

        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false);
        assert.strictEqual(reasonOf(result), 'stack: needs more than one package');
    });

    // ── Delegation: two packages clears the shape gate, package rules take over ──

    test('a stack with two packages but no ## Files is refused by the reused package rules', async () => {
        const md = stackMd(['```yaml leetcode', TWO_PACKAGES, '```'].join('\n'));

        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false);
        assert.strictEqual(reasonOf(result), 'stack: no ## Files declared');
    });

    // ── Rule 3 (structural half of [[C30]]): a check with no cases, named clearly ──

    test('an http check with no cases bound fails naming the check, not incidentally', async () => {
        // This is the exact shape of the four vault `stack` artifacts (ledger
        // [[C30]]): an `http` check declared, but no `## Tests` fence carries
        // its `check=` attribute. The reused package rule already names it —
        // this fixture proves a `stack` genuinely reaches that rule.
        const md = stackMd([
            '```yaml leetcode',
            TWO_PACKAGES,
            'checks:',
            '  - name: orders api',
            '    kind: http',
            '    package: api',
            '```',
            '',
            '## Files',
            '',
            '```javascript path=index.js role=editable',
            'module.exports = {};',
            '```',
        ].join('\n'));

        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false);
        assert.strictEqual(
            reasonOf(result),
            "stack: check 'orders api' has no cases — bind them with a `check=` fence attribute",
        );
    });

    // ── Delegation: the checks: / test.type mirror rule ───────────────────────

    test('a stack naming a real test.type alongside checks is refused by the mirror rule', async () => {
        const md = stackMd([
            '```yaml leetcode',
            'test:',
            '  type: in-place',
            TWO_PACKAGES,
            'checks:',
            '  - name: probe',
            '    kind: build',
            '    argv: ["node", "--version"]',
            '```',
            '',
            '## Files',
            '',
            '```javascript path=index.js role=editable',
            'module.exports = {};',
            '```',
        ].join('\n'));

        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false);
        assert.strictEqual(
            reasonOf(result),
            "stack: checks declared but test.type is 'in-place' — "
                + 'a checks-graded exercise must not also declare a top-level execution strategy',
        );
    });

    // ── An unimplemented triple: a reserved check kind is dropped at parse ────

    test('a stack whose only check names an unimplemented kind fails as though it declared none', async () => {
        // `kind: class` is reserved — no environment implements it, so
        // `buildCheck` drops it silently (with a warning) at parse time. With
        // it gone, `parsed.checks` is empty: the artifact must not read as
        // gradeable on the strength of a check nothing can run.
        const md = stackMd([
            '```yaml leetcode',
            TWO_PACKAGES,
            'checks:',
            '  - name: server compiles',
            '    kind: class',
            '```',
            '',
            '## Files',
            '',
            '```javascript path=index.js role=editable',
            'module.exports = {};',
            '```',
        ].join('\n'));

        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false);
        assert.strictEqual(reasonOf(result), 'stack: no checks declared — solved means every check green');
    });

    // ── Rule 3: a call check needs the artifact's own top-level params ───────

    test('a call check with no top-level params fails on the case-shape mismatch', async () => {
        // `runFunctionCheck` serialises a case's `input` into positional
        // arguments using the artifact's own top-level `params:` — never
        // anything the check itself declares. No `params:` here means the
        // driver has nothing to bind this check's cases to.
        const md = stackMd([
            '```yaml leetcode',
            TWO_PACKAGES,
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
        ].join('\n'));

        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false);
        assert.strictEqual(
            reasonOf(result),
            "stack: check 'pricing' is kind 'call' but the artifact declares no params "
                + "— a call check runs against the artifact's own top-level function shape",
        );
    });

    // ── Rule 2: an http check naming a package the artifact never declared ───

    test('an http check naming an unknown package fails before anything boots', async () => {
        const md = stackMd([
            '```yaml leetcode',
            TWO_PACKAGES,
            'checks:',
            '  - name: orders api',
            '    kind: http',
            '    package: missing',
            '```',
            '',
            '## Files',
            '',
            '```javascript path=index.js role=editable',
            'module.exports = {};',
            '```',
        ].join('\n'));

        const result = await verifyExercise(md);
        assert.strictEqual(result.ok, false);
        assert.strictEqual(reasonOf(result), "stack: check 'orders api' names unknown package 'missing'");
    });
});
