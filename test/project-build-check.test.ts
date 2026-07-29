import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { BuildCheck } from '../src/types/leetcode.types.js';
import { runBuildCheck } from '../src/services/test-envs/project/build.check.js';

/**
 * `build` check kind (eval-fixes TB.7): a declared argv exits 0, or the check
 * fails.
 *
 * Both untrusted inputs are pinned here — the `argv` never becomes a command
 * string, and the optional `dir` is containment-asserted **before** anything is
 * spawned, so a `..` never reaches a working directory.
 */
suite('project build check', () => {

	let runDir: string;

	setup(() => {
		runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-build-'));
	});

	teardown(() => {
		fs.rmSync(runDir, { recursive: true, force: true });
	});

	function check(over: Partial<BuildCheck> = {}): BuildCheck {
		return { name: 'app builds', kind: 'build', argv: [process.execPath, '-e', 'process.exit(0)'], cases: [], publicCount: 0, ...over };
	}

	// ── Containment, before any spawn ─────────────────────────────────────────

	test('a dir escaping the run root is refused before anything runs', async () => {
		const outcome = await runBuildCheck(check({ dir: '../..' }), runDir);

		assert.strictEqual(outcome.passed, false);
		assert.ok(/path|dir/i.test(outcome.detail ?? ''), outcome.detail);
	});

	test('an absolute dir is refused', async () => {
		const outcome = await runBuildCheck(check({ dir: '/etc' }), runDir);
		assert.strictEqual(outcome.passed, false);
	});

	test('a dir inside the run root is used as cwd', async () => {
		fs.mkdirSync(path.join(runDir, 'client'));
		const outcome = await runBuildCheck(
			check({ dir: 'client', argv: [process.execPath, '-e', 'process.stdout.write(process.cwd())'] }),
			runDir,
		);

		assert.strictEqual(outcome.passed, true, outcome.detail);
		assert.ok(outcome.detail === undefined || outcome.detail.includes('client'), outcome.detail);
	});

	test('a dir aimed at node_modules is refused before any spawn', async () => {
		// A real run directory always has a node_modules (linkModules creates it),
		// so this must exist here too — otherwise a missing cwd, not the guard,
		// would be what makes execFile fail, and the test would pass for the wrong reason.
		fs.mkdirSync(path.join(runDir, 'node_modules'), { recursive: true });
		const marker = path.join(runDir, 'spawned');
		const outcome = await runBuildCheck(
			check({
				dir: 'node_modules',
				argv: [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`],
			}),
			runDir,
		);

		assert.strictEqual(outcome.passed, false);
		assert.ok(/reserved/.test(outcome.detail ?? ''), outcome.detail);
		assert.strictEqual(fs.existsSync(marker), false, 'a spawn happened despite the containment refusal');
	});

	// ── The run's own node_modules/.bin resolves on PATH ─────────────────────

	test("a binary in the run's node_modules/.bin resolves by bare name", async () => {
		const binDir = path.join(runDir, 'node_modules', '.bin');
		fs.mkdirSync(binDir, { recursive: true });
		const shimPath = path.join(binDir, 'mytool');
		fs.writeFileSync(shimPath, '#!/bin/sh\necho from-local-bin\n');
		fs.chmodSync(shimPath, 0o755);

		const outcome = await runBuildCheck(check({ argv: ['mytool'] }), runDir);

		assert.strictEqual(outcome.passed, true, outcome.detail);
		assert.ok(outcome.detail?.includes('from-local-bin'), outcome.detail);
	});

	test('PATH is prepended, not replaced — a system binary still resolves', async () => {
		const outcome = await runBuildCheck(check({ argv: ['sh', '-c', 'exit 0'] }), runDir);
		assert.strictEqual(outcome.passed, true, outcome.detail);
	});

	// ── Exit code is the verdict ──────────────────────────────────────────────

	test('exit 0 passes', async () => {
		assert.strictEqual((await runBuildCheck(check(), runDir)).passed, true);
	});

	test('a non-zero exit fails and reports the output', async () => {
		const outcome = await runBuildCheck(
			check({ argv: [process.execPath, '-e', 'console.error("type error"); process.exit(1)'] }),
			runDir,
		);

		assert.strictEqual(outcome.passed, false);
		assert.ok(outcome.detail?.includes('type error'), outcome.detail);
	});

	test('an empty argv fails rather than spawning a shell', async () => {
		const outcome = await runBuildCheck(check({ argv: [] }), runDir);
		assert.strictEqual(outcome.passed, false);
	});

	test('a command that does not exist fails as a check, never as a crash', async () => {
		const outcome = await runBuildCheck(check({ argv: ['definitely-not-a-real-binary-xyz'] }), runDir);
		assert.strictEqual(outcome.passed, false);
	});

	test('the outcome carries the check name so results can group by it', async () => {
		assert.strictEqual((await runBuildCheck(check(), runDir)).name, 'app builds');
	});

	// ── argv stays an array ───────────────────────────────────────────────────

	test('shell metacharacters in argv are inert — they are arguments, not syntax', async () => {
		const marker = path.join(runDir, 'pwned');
		const outcome = await runBuildCheck(
			check({ argv: [process.execPath, '-e', 'process.exit(0)', `; touch ${marker}`] }),
			runDir,
		);

		assert.strictEqual(outcome.passed, true, outcome.detail);
		assert.strictEqual(fs.existsSync(marker), false, 'a shell interpreted the argv');
	});
});
