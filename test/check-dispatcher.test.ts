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
});
