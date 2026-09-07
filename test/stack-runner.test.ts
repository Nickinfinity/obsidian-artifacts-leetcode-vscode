import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PackageSpec } from '../src/types/leetcode.types.js';
import type { LibEcosystem } from '../src/services/libs/lib-ecosystem.js';
import { bootStack } from '../src/services/test-envs/stack/stack.runner.js';
import { createGroupRegistry } from '../src/services/test-envs/http/server.lifecycle.js';

/**
 * `bootStack` (T4.1, VSX-178): `dependsOn`-ordered boot of a `stack`'s whole
 * `packages:` list, `exposeAs` wired from each dependency's already-assigned
 * port, one teardown for the group.
 *
 * Every process-boundary assertion here spawns a real `node -e` one-liner —
 * the same "honest fixture" precedent `http-server-lifecycle.test.ts` sets —
 * rather than a mock, because the whole point of dependency ordering and
 * environment wiring is observable process behaviour a fake spawn cannot
 * reproduce.
 */
suite('stack-runner', () => {

	let runDir: string;

	setup(() => {
		runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leet-stackrun-'));
		fs.mkdirSync(path.join(runDir, 'server'));
		fs.mkdirSync(path.join(runDir, 'client'));
	});

	teardown(() => {
		fs.rmSync(runDir, { recursive: true, force: true });
	});

	function isAlive(pid: number): boolean {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	}

	async function assertEventuallyDead(pid: number, timeoutMs = 3000): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (isAlive(pid) && Date.now() < deadline) {
			await new Promise(resolve => setTimeout(resolve, 20));
		}
		assert.strictEqual(isAlive(pid), false, `pid ${pid} is still alive after teardown`);
	}

	/** A no-op, always-succeeding install — mirrors the vault's own `install: ["true"]` pattern. */
	function okInstall(): string[] {
		return [process.execPath, '-e', 'process.exit(0)'];
	}

	// ── fixtures ──────────────────────────────────────────────────────────────

	/** Binds `process.env.PORT` immediately (C31 — PORT is now injected, never argv-only). */
	const LISTEN_ON_PORT_ENV = [
		"const net = require('net');",
		'const port = Number(process.env.PORT);',
		"net.createServer(s => s.end()).listen(port, '127.0.0.1');",
	].join('\n');

	/** Never binds anything — records its own pid at `argv[1]` and hangs. */
	const NEVER_BINDS = [
		"const fs = require('fs');",
		'fs.writeFileSync(process.argv[1], String(process.pid));',
		'setInterval(() => {}, 1000);',
	].join('\n');

	/** Records that it was ever invoked at all (`argv[1]`), then binds and hangs — used to prove a package was never even attempted. */
	const MARK_STARTED_AND_LISTEN = [
		"const fs = require('fs');",
		"const net = require('net');",
		'const port = Number(process.env.PORT);',
		'fs.writeFileSync(process.argv[1], "started");',
		"net.createServer(s => s.end()).listen(port, '127.0.0.1');",
	].join('\n');

	/** Records the value of one named env var (`argv[1]` name, `argv[2]` output file), then binds and hangs. */
	const RECORD_ENV_AND_LISTEN = [
		"const fs = require('fs');",
		"const net = require('net');",
		'const port = Number(process.env.PORT);',
		'const varName = process.argv[1];',
		'const outFile = process.argv[2];',
		'fs.writeFileSync(outFile, process.env[varName] || "");',
		"net.createServer(s => s.end()).listen(port, '127.0.0.1');",
	].join('\n');

	/** Records `VIRTUAL_ENV` and `PATH` as JSON (`argv[1]` output file), then binds and hangs. C29/T4.7. */
	const RECORD_LIB_ENV_AND_LISTEN = [
		"const fs = require('fs');",
		"const net = require('net');",
		'const port = Number(process.env.PORT);',
		'const outFile = process.argv[1];',
		'fs.writeFileSync(outFile, JSON.stringify({',
		'  virtualEnv: process.env.VIRTUAL_ENV || null,',
		'  path: process.env.PATH || "",',
		'}));',
		"net.createServer(s => s.end()).listen(port, '127.0.0.1');",
	].join('\n');

	/** Records `VIRTUAL_ENV` seen during the **install** step (`argv[1]` output file), then exits 0. C29 install-half. */
	const RECORD_VENV_DURING_INSTALL = [
		"const fs = require('fs');",
		'fs.writeFileSync(process.argv[1], process.env.VIRTUAL_ENV || "");',
	].join('\n');

	// ── the Test First: failure propagates with the dependency's own reason ────

	suite('dependency failure propagation (the Test First)', () => {
		test("when api fails to boot, web (dependsOn: [api]) carries api's own reason, and web is never even attempted", async function () {
			this.timeout(10_000);
			const webMarker = path.join(runDir, 'web-started.marker');
			const packages: PackageSpec[] = [
				{ name: 'api', dir: 'server', install: okInstall(), start: [process.execPath, '-e', NEVER_BINDS, path.join(runDir, 'api-pid.txt')] },
				{
					name: 'web', dir: 'client', install: okInstall(),
					start: [process.execPath, '-e', MARK_STARTED_AND_LISTEN, webMarker],
					dependsOn: ['api'],
				},
			];

			const stack = await bootStack(packages, runDir, { bootTimeoutMs: 300 });
			try {
				const api = stack.outcomes.get('api');
				const web = stack.outcomes.get('web');
				assert.strictEqual(api?.ok, false, 'api must be reported as failed');
				assert.strictEqual(web?.ok, false, 'web must be reported as failed too — its dependency never came up');
				if (api?.ok === false && web?.ok === false) {
					assert.ok(
						web.reason.includes(api.reason),
						`web's failure reason must carry api's own reason verbatim; got web="${web.reason}" api="${api.reason}"`,
					);
				}
				assert.strictEqual(fs.existsSync(webMarker), false, 'web must never have been spawned once its dependency failed');

				const apiPid = Number(fs.readFileSync(path.join(runDir, 'api-pid.txt'), 'utf8'));
				await assertEventuallyDead(apiPid);
			} finally {
				await stack.teardownAll();
			}
		});
	});

	// ── ordering + exposeAs wiring (items 1–3) ───────────────────────────────

	suite('dependsOn ordering and exposeAs wiring', () => {
		test("a dependent's exposeAs-derived env var carries the dependency's ALREADY-ASSIGNED port, injected before it boots", async function () {
			this.timeout(10_000);
			const envFile = path.join(runDir, 'web-env.txt');
			const packages: PackageSpec[] = [
				{
					name: 'api', dir: 'server', install: okInstall(),
					start: [process.execPath, '-e', LISTEN_ON_PORT_ENV],
					exposeAs: { API_URL: 'http://127.0.0.1:${PORT}' },
				},
				{
					name: 'web', dir: 'client', install: okInstall(),
					start: [process.execPath, '-e', RECORD_ENV_AND_LISTEN, 'API_URL', envFile],
					dependsOn: ['api'],
				},
			];

			const stack = await bootStack(packages, runDir);
			try {
				const api = stack.outcomes.get('api');
				const web = stack.outcomes.get('web');
				assert.strictEqual(api?.ok, true, `api must have booted: ${api?.ok === false ? api.reason : ''}`);
				assert.strictEqual(web?.ok, true, `web must have booted: ${web?.ok === false ? web.reason : ''}`);
				if (api?.ok !== true) { return; }

				const recorded = fs.readFileSync(envFile, 'utf8');
				assert.strictEqual(
					recorded, `http://127.0.0.1:${api.port}`,
					'web must have received API_URL naming the port bootStack actually assigned api, not a placeholder',
				);
			} finally {
				await stack.teardownAll();
			}
		});

		test('two independent (no dependsOn) packages boot concurrently, each on its own port', async function () {
			this.timeout(10_000);
			const packages: PackageSpec[] = [
				{ name: 'api', dir: 'server', install: okInstall(), start: [process.execPath, '-e', LISTEN_ON_PORT_ENV] },
				{ name: 'web', dir: 'client', install: okInstall(), start: [process.execPath, '-e', LISTEN_ON_PORT_ENV] },
			];

			const stack = await bootStack(packages, runDir);
			try {
				const api = stack.outcomes.get('api');
				const web = stack.outcomes.get('web');
				assert.strictEqual(api?.ok, true);
				assert.strictEqual(web?.ok, true);
				if (api?.ok === true && web?.ok === true) {
					assert.notStrictEqual(api.port, web.port, 'two independently-minted ports must never collide');
				}
			} finally {
				await stack.teardownAll();
			}
		});

		test('an unknown dependsOn name fails the package by name, never hangs', async function () {
			this.timeout(10_000);
			const webMarker = path.join(runDir, 'web-started.marker');
			const packages: PackageSpec[] = [{
				name: 'web', dir: 'client', install: okInstall(),
				start: [process.execPath, '-e', MARK_STARTED_AND_LISTEN, webMarker],
				dependsOn: ['ghost'],
			}];

			const stack = await bootStack(packages, runDir);
			try {
				const web = stack.outcomes.get('web');
				assert.strictEqual(web?.ok, false);
				if (web?.ok === false) { assert.match(web.reason, /'ghost'.*does not declare/); }
				assert.strictEqual(fs.existsSync(webMarker), false, 'web must never boot with an unresolved dependency');
			} finally {
				await stack.teardownAll();
			}
		});

		test('a hostile, directly-constructed cycle (bypassing the parser) resolves as failed, never hangs', async function () {
			this.timeout(10_000);
			// packages-parser.helpers.ts refuses a real dependsOn cycle at parse
			// time (S7) — this constructs one directly to prove bootStack's own
			// defensive exit (the `wave.length === 0` branch) is actually reached
			// rather than an inert guard nothing ever triggers.
			const packages: PackageSpec[] = [
				{ name: 'a', dir: 'server', install: okInstall(), start: [process.execPath, '-e', LISTEN_ON_PORT_ENV], dependsOn: ['b'] },
				{ name: 'b', dir: 'client', install: okInstall(), start: [process.execPath, '-e', LISTEN_ON_PORT_ENV], dependsOn: ['a'] },
			];

			const stack = await bootStack(packages, runDir);
			try {
				const a = stack.outcomes.get('a');
				const b = stack.outcomes.get('b');
				assert.strictEqual(a?.ok, false, 'a hostile cycle must never resolve as booted');
				assert.strictEqual(b?.ok, false, 'a hostile cycle must never resolve as booted');
			} finally {
				await stack.teardownAll();
			}
		});
	});

	// ── install-all (item 3) ──────────────────────────────────────────────────

	suite('install-all', () => {
		test('a failed install fails that package and propagates to its dependents, without ever attempting to boot either', async function () {
			this.timeout(10_000);
			const apiMarker = path.join(runDir, 'api-started.marker');
			const webMarker = path.join(runDir, 'web-started.marker');
			const packages: PackageSpec[] = [
				{
					name: 'api', dir: 'server', install: [process.execPath, '-e', 'process.exit(1)'],
					start: [process.execPath, '-e', MARK_STARTED_AND_LISTEN, apiMarker],
				},
				{
					name: 'web', dir: 'client', install: okInstall(),
					start: [process.execPath, '-e', MARK_STARTED_AND_LISTEN, webMarker],
					dependsOn: ['api'],
				},
			];

			const stack = await bootStack(packages, runDir);
			try {
				const api = stack.outcomes.get('api');
				const web = stack.outcomes.get('web');
				assert.strictEqual(api?.ok, false);
				if (api?.ok === false) { assert.match(api.reason, /install failed/); }
				assert.strictEqual(web?.ok, false);
				assert.strictEqual(fs.existsSync(apiMarker), false, 'a failed install must never let start run');
				assert.strictEqual(fs.existsSync(webMarker), false, 'a dependent of a failed install must never boot');
			} finally {
				await stack.teardownAll();
			}
		});
	});

	// ── S12: every booted package is session-registered (item 4) ────────────

	suite('teardown and S12 registration', () => {
		test('every package that boots is registered on the caller\'s registry, and teardownAll() (the group-level one) kills both', async function () {
			this.timeout(10_000);
			const packages: PackageSpec[] = [
				{ name: 'api', dir: 'server', install: okInstall(), start: [process.execPath, '-e', LISTEN_ON_PORT_ENV] },
				{ name: 'web', dir: 'client', install: okInstall(), start: [process.execPath, '-e', LISTEN_ON_PORT_ENV] },
			];

			const registry = createGroupRegistry();
			const stack = await bootStack(packages, runDir, { registry });
			const api = stack.outcomes.get('api');
			const web = stack.outcomes.get('web');
			assert.strictEqual(api?.ok, true);
			assert.strictEqual(web?.ok, true);
			if (api?.ok !== true || web?.ok !== true) { return; }

			// The crash-mid-run scenario S12 exists for: never call `stack
			// .teardownAll()` — only the *session's own* registry stands between
			// these two servers and an orphan, exactly the same proof
			// `http-server-lifecycle.test.ts` already runs for a single boot.
			await registry.teardownAll();
			await assertEventuallyDead(api.pid);
			await assertEventuallyDead(web.pid);

			// A harmless no-op afterwards — `stop()` is idempotent and both pids
			// are already gone.
			await stack.teardownAll();
		});
	});

	// ── C29/C36 (T4.7, VSX-227): a booted package gets its libs: environment ──

	suite('bootStack — C29/C36, libDirs reach the booted child', () => {
		test('a pip libDirs entry sets VIRTUAL_ENV and puts <dir>/bin ahead of the inherited PATH', async function () {
			this.timeout(10_000);
			const pipDir = path.join(runDir, 'fake-venv');
			fs.mkdirSync(path.join(pipDir, 'bin'), { recursive: true });
			const envFile = path.join(runDir, 'api-env.txt');
			const inheritedPath = process.env.PATH ?? '';
			const packages: PackageSpec[] = [{
				name: 'api', dir: 'server', install: okInstall(),
				start: [process.execPath, '-e', RECORD_LIB_ENV_AND_LISTEN, envFile],
			}];
			const libDirs: ReadonlyMap<LibEcosystem, string> = new Map([['pip', pipDir]]);

			const stack = await bootStack(packages, runDir, { libDirs });
			try {
				const api = stack.outcomes.get('api');
				assert.strictEqual(api?.ok, true, `api must have booted: ${api?.ok === false ? api.reason : ''}`);

				const report = JSON.parse(fs.readFileSync(envFile, 'utf8')) as { virtualEnv: string | null; path: string };
				assert.strictEqual(report.virtualEnv, pipDir, 'VIRTUAL_ENV must name the resolved pip cache directory');

				const expectedBinDir = path.join(pipDir, 'bin');
				assert.ok(
					report.path.startsWith(`${expectedBinDir}${path.delimiter}`),
					`<dir>/bin must lead PATH; got "${report.path}"`,
				);
				assert.ok(report.path.includes(inheritedPath), 'the inherited PATH must still be present, never dropped');
			} finally {
				await stack.teardownAll();
			}
		});

		test('a pip libDirs entry sets VIRTUAL_ENV during the INSTALL step too, not just start', async function () {
			this.timeout(10_000);
			const pipDir = path.join(runDir, 'fake-venv-install');
			fs.mkdirSync(path.join(pipDir, 'bin'), { recursive: true });
			const installEnvFile = path.join(runDir, 'api-install-env.txt');
			const packages: PackageSpec[] = [{
				name: 'api', dir: 'server',
				install: [process.execPath, '-e', RECORD_VENV_DURING_INSTALL, installEnvFile],
				start: [process.execPath, '-e', LISTEN_ON_PORT_ENV],
			}];
			const libDirs: ReadonlyMap<LibEcosystem, string> = new Map([['pip', pipDir]]);

			const stack = await bootStack(packages, runDir, { libDirs });
			try {
				const api = stack.outcomes.get('api');
				assert.strictEqual(api?.ok, true, `api must have booted: ${api?.ok === false ? api.reason : ''}`);

				const recorded = fs.readFileSync(installEnvFile, 'utf8');
				assert.strictEqual(
					recorded, pipDir,
					'the install step must see VIRTUAL_ENV from libDirs, not just the later start step',
				);
			} finally {
				await stack.teardownAll();
			}
		});
	});
});
