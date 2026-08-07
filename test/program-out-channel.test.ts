import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	LEET_OUT_ENV_VAR,
	MAX_LEET_OUT_BYTES,
	mintOutChannelPath,
	readOutChannel,
} from '../src/services/test-envs/program/out-channel.js';

/**
 * The `$LEET_OUT` channel — how a `program`-type case's graded value reaches
 * the extension when the child's own stdout is free for the solver's prints.
 *
 * The one rule every test here protects: a case whose file never showed up
 * must read as a **failed** case, never an empty-and-therefore-green one —
 * the same rule the `__LEET__` sentinel protocol already enforces for stdout.
 */
suite('program out-channel', () => {

	let runDir: string;

	setup(async () => {
		runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leet-out-'));
	});

	teardown(async () => {
		await fs.rm(runDir, { recursive: true, force: true });
	});

	suite('mintOutChannelPath', () => {

		test('mints a distinct path per case index under the run dir', () => {
			const p0 = mintOutChannelPath(runDir, 0);
			const p1 = mintOutChannelPath(runDir, 1);
			assert.notStrictEqual(p0, p1);
			assert.ok(p0.startsWith(runDir));
			assert.ok(p1.startsWith(runDir));
		});

		test('is stable for the same index (no randomness to smuggle in)', () => {
			assert.strictEqual(mintOutChannelPath(runDir, 3), mintOutChannelPath(runDir, 3));
		});
	});

	suite('readOutChannel', () => {

		test('a case whose file is absent after the run fails, never reads as empty-and-green', async () => {
			const outcome = await readOutChannel(mintOutChannelPath(runDir, 0), 0, 5);
			assert.strictEqual(outcome.index, 0);
			assert.strictEqual(outcome.ms, 5);
			assert.strictEqual(outcome.actual, undefined);
			assert.ok(outcome.error, 'a missing file must carry an error, not a green result');
			assert.match(outcome.error ?? '', /crash|timed out/);
		});

		test('a file over MAX_LEET_OUT_BYTES fails on size, without the content mattering', async () => {
			const file = mintOutChannelPath(runDir, 1);
			// Real oversized file on disk — proves the cap is enforced from `stat`,
			// not from a mocked size that would prove nothing.
			await fs.writeFile(file, '['.repeat(MAX_LEET_OUT_BYTES + 1));
			const outcome = await readOutChannel(file, 1, 3);
			assert.ok(outcome.error);
			assert.match(outcome.error ?? '', /limit|large|size/i);
		});

		test('unparseable content fails with a named reason', async () => {
			const file = mintOutChannelPath(runDir, 2);
			await fs.writeFile(file, 'not json at all');
			const outcome = await readOutChannel(file, 2, 1);
			assert.ok(outcome.error);
			assert.match(outcome.error ?? '', /json/i);
		});

		test('an empty file fails rather than reading as a green empty result', async () => {
			const file = mintOutChannelPath(runDir, 3);
			await fs.writeFile(file, '');
			const outcome = await readOutChannel(file, 3, 1);
			assert.ok(outcome.error);
			assert.strictEqual(outcome.actual, undefined);
		});

		test('valid JSON is returned as canonical JSON (sorted keys)', async () => {
			const file = mintOutChannelPath(runDir, 4);
			await fs.writeFile(file, '{"b":2,"a":1}');
			const outcome = await readOutChannel(file, 4, 9);
			assert.strictEqual(outcome.error, undefined);
			assert.strictEqual(outcome.actual, '{"a":1,"b":2}');
			assert.strictEqual(outcome.ms, 9);
		});

		test('a literal JSON null is a valid value, not a parse failure', async () => {
			const file = mintOutChannelPath(runDir, 5);
			await fs.writeFile(file, 'null');
			const outcome = await readOutChannel(file, 5, 0);
			assert.strictEqual(outcome.error, undefined);
			assert.strictEqual(outcome.actual, 'null');
		});

		test('a bare scalar round-trips', async () => {
			const file = mintOutChannelPath(runDir, 6);
			await fs.writeFile(file, '42');
			const outcome = await readOutChannel(file, 6, 0);
			assert.strictEqual(outcome.actual, '42');
		});
	});

	test('LEET_OUT_ENV_VAR is the frozen name the format doc promises solvers', () => {
		assert.strictEqual(LEET_OUT_ENV_VAR, 'LEET_OUT');
	});
});
