import * as assert from 'node:assert';
import { apiPortForRenderCheck } from '../src/services/test-envs/project/check.dispatcher.js';
import type { StackBoot } from '../src/services/test-envs/stack/stack.runner.js';

/**
 * `apiPortForRenderCheck` (T4.3 round 2, VSX-180): which loopback port, if
 * any, a `dom-assert`/`css-assert` component may fetch from. Pure and
 * offline — a `StackBoot` is just a `Map`, so no real package ever boots
 * here; the actual threading into a live render is proven end to end by the
 * `[LEET_PROJECT_E2E=1]` test in `project-render-driver.test.ts`.
 */
suite('apiPortForRenderCheck', () => {

	const CHECK = { kind: 'dom-assert' as const, name: 'shows the value' };

	function stackBootOf(outcomes: [string, { ok: true; port: number; pid: number } | { ok: false; reason: string }][]): StackBoot {
		return { outcomes: new Map(outcomes), teardownAll: async () => { /* unused in this suite */ } };
	}

	test('no stackBoot at all (a `package` artifact, or a stack with no packages:) leaves the port unset', () => {
		assert.deepStrictEqual(apiPortForRenderCheck(CHECK, undefined), { ok: true });
	});

	test('a stack that booted nothing (empty outcomes) also leaves the port unset', () => {
		assert.deepStrictEqual(apiPortForRenderCheck(CHECK, stackBootOf([])), { ok: true });
	});

	test('exactly one booted package hands back its port — the S1 worked example', () => {
		const boot = stackBootOf([['api', { ok: true, port: 54321, pid: 1 }]]);
		assert.deepStrictEqual(apiPortForRenderCheck(CHECK, boot), { ok: true, port: 54321 });
	});

	test('a failed package does not count as booted — still no port, not a refusal', () => {
		const boot = stackBootOf([['api', { ok: false, reason: 'server never started: boom' }]]);
		assert.deepStrictEqual(apiPortForRenderCheck(CHECK, boot), { ok: true });
	});

	test('one booted package plus one failed package still resolves the sole survivor', () => {
		const boot = stackBootOf([
			['api', { ok: true, port: 9001, pid: 1 }],
			['broken', { ok: false, reason: 'boom' }],
		]);
		assert.deepStrictEqual(apiPortForRenderCheck(CHECK, boot), { ok: true, port: 9001 });
	});

	test('two booted packages refuse the check by name, rather than guessing which one', () => {
		const boot = stackBootOf([
			['api', { ok: true, port: 1111, pid: 1 }],
			['worker', { ok: true, port: 2222, pid: 2 }],
		]);
		const result = apiPortForRenderCheck(CHECK, boot);
		assert.strictEqual(result.ok, false);
		assert.ok(!result.ok && result.detail.includes(CHECK.name), JSON.stringify(result));
		assert.ok(!result.ok && result.detail.includes('2 packages'), JSON.stringify(result));
	});

	/**
	 * T4.8 (VSX-228): a render check that names its package via `package:`
	 * resolves against that one entry directly — the ambiguous-count guess
	 * above only ever applied to a check declaring no binding at all. This is
	 * the Flask+React case: two booted packages, no longer refused outright,
	 * because the component's check says which one it talks to.
	 */
	suite('a check with a package: binding', () => {

		test('resolves the named package\'s port even when two packages are booted', () => {
			const boot = stackBootOf([
				['api', { ok: true, port: 1111, pid: 1 }],
				['worker', { ok: true, port: 2222, pid: 2 }],
			]);
			const check = { ...CHECK, package: 'worker' };
			assert.deepStrictEqual(apiPortForRenderCheck(check, boot), { ok: true, port: 2222 });
		});

		test('a binding naming a package the artifact never declares fails the check by name', () => {
			const boot = stackBootOf([['api', { ok: true, port: 1111, pid: 1 }]]);
			const check = { ...CHECK, package: 'ghost' };
			const result = apiPortForRenderCheck(check, boot);
			assert.strictEqual(result.ok, false);
			assert.ok(!result.ok && result.detail.includes('ghost'), JSON.stringify(result));
			assert.ok(!result.ok && result.detail.includes(CHECK.name), JSON.stringify(result));
		});

		test('a binding naming a package that never booted fails the check by name, carrying the boot reason', () => {
			const boot = stackBootOf([['api', { ok: false, reason: 'boom' }]]);
			const check = { ...CHECK, package: 'api' };
			const result = apiPortForRenderCheck(check, boot);
			assert.strictEqual(result.ok, false);
			assert.ok(!result.ok && result.detail.includes('boom'), JSON.stringify(result));
		});

		test('a binding is never consulted when nothing booted at all — same as no binding', () => {
			const check = { ...CHECK, package: 'api' };
			assert.deepStrictEqual(apiPortForRenderCheck(check, undefined), { ok: true });
		});
	});
});
