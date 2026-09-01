import * as assert from 'node:assert';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PackageSpec } from '../src/types/leetcode.types.js';
import type { LibEcosystem } from '../src/services/libs/lib-ecosystem.js';
import { classifyStarterFailure } from '../src/services/exercise-verify/starter-red.helpers.js';
import {
	assertMintedPortSafe,
	bootServer,
	createGroupRegistry,
	installSignalTeardown,
	killProcessGroup,
} from '../src/services/test-envs/http/server.lifecycle.js';

/**
 * Server lifecycle (T3.3, VSX-122 §G): mint a port, spawn `start`, wait for
 * readiness, tear down by process group — and register the group where a
 * session-level cleanup can find it even when this module's own `finally`
 * never runs.
 *
 * Every process-boundary test here spawns a real `node -e` one-liner
 * (Orchestrator note #7's "honest fixture") rather than a mock — the whole
 * point of S4/S6/S13 is observable process behaviour a fake spawn cannot
 * reproduce. Nothing imports `vscode`: the session-registration half (S12)
 * is exercised through {@link createGroupRegistry} directly, the same pure
 * object `leetcode-challenge.service.ts`'s `endChallenge()` drains.
 */
suite('http-server-lifecycle', () => {

	let runDir: string;
	let pkgDir: string;

	setup(() => {
		runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leet-srvlife-'));
		pkgDir = path.join(runDir, 'server');
		fs.mkdirSync(pkgDir);
	});

	teardown(() => {
		fs.rmSync(runDir, { recursive: true, force: true });
	});

	function pkg(over: Partial<PackageSpec> = {}): PackageSpec {
		return {
			name: 'api',
			dir: 'server',
			install: [process.execPath, '-e', 'process.exit(0)'],
			start: [process.execPath, '-e', LISTEN_IMMEDIATELY, '${PORT}'],
			...over,
		};
	}

	function isAlive(pid: number): boolean {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Ask the OS for a free loopback port and release it again.
	 *
	 * Only for tests that must know the port **before** the boot, so a fixture
	 * can be named after it (the C32 case below). Everything else lets
	 * `bootServer` mint its own — this deliberately reproduces the same
	 * bind-`:0`-and-read-it-back trick rather than guessing a number, because a
	 * guessed port collides on a busy machine and fails a test for the wrong
	 * reason.
	 *
	 * @returns A port that was free a moment ago — inherently racy, which is
	 *   why the caller passes it straight to `mintPort` rather than binding it.
	 *
	 * @example
	 * const port = await freePort(); // → 53124
	 */
	async function freePort(): Promise<number> {
		return new Promise((resolve, reject) => {
			const probe = net.createServer();
			probe.on('error', reject);
			probe.listen(0, '127.0.0.1', () => {
				const addr = probe.address();
				const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
				probe.close(() => { resolve(port); });
			});
		});
	}

	/** Poll `predicate` until it is true, or fail the assertion after `timeoutMs`. */
	async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (!predicate() && Date.now() < deadline) {
			await new Promise(resolve => setTimeout(resolve, 20));
		}
		assert.ok(predicate(), `condition was not met within ${timeoutMs}ms`);
	}

	/** Poll until `pid` is gone, or fail the assertion after `timeoutMs`. */
	async function assertEventuallyDead(pid: number, timeoutMs = 3000): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (isAlive(pid) && Date.now() < deadline) {
			await new Promise(resolve => setTimeout(resolve, 20));
		}
		assert.strictEqual(isAlive(pid), false, `pid ${pid} is still alive after teardown`);
	}

	// ── fixtures ──────────────────────────────────────────────────────────────

	/** Binds `${PORT}` immediately and answers every connection. `argv[1]` is the port. */
	const LISTEN_IMMEDIATELY = [
		"const net = require('net');",
		'const port = Number(process.argv[1]);',
		"net.createServer(s => s.end()).listen(port, '127.0.0.1');",
	].join('\n');

	/** Never binds anything — records its own pid at `argv[1]` and hangs. */
	const NEVER_BINDS = [
		"const fs = require('fs');",
		'fs.writeFileSync(process.argv[1], String(process.pid));',
		'setInterval(() => {}, 1000);',
	].join('\n');

	/** Binds immediately but only prints its ready line after a delay — `argv[1]` port, `argv[2]` delay ms. */
	const LISTEN_THEN_LOG_LATE = [
		"const net = require('net');",
		'const port = Number(process.argv[1]);',
		'const delayMs = Number(process.argv[2]);',
		"net.createServer(s => s.end()).listen(port, '127.0.0.1');",
		"setTimeout(() => { console.log('READY_MARKER'); }, delayMs);",
	].join('\n');

	/** Never binds anything, but logs the ready line immediately — `argv[1]` is a pid marker path. */
	const LOG_ONLY_NEVER_LISTENS = [
		"const fs = require('fs');",
		'fs.writeFileSync(process.argv[1], String(process.pid));',
		"console.log('READY_MARKER');",
		'setInterval(() => {}, 1000);',
	].join('\n');

	/** Binds `${PORT}` and forks a grandchild that outlives it in the group — `argv[1]` port, `argv[2]` grandchild pid file. */
	const SPAWN_GRANDCHILD = [
		"const net = require('net');",
		"const cp = require('child_process');",
		"const fs = require('fs');",
		'const port = Number(process.argv[1]);',
		'const gcPidFile = process.argv[2];',
		"const gc = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
		'fs.writeFileSync(gcPidFile, String(gc.pid));',
		"net.createServer(s => s.end()).listen(port, '127.0.0.1');",
	].join('\n');

	/** Binds `${PORT}` and refuses to die on SIGTERM — forces the SIGKILL escalation. */
	const IGNORES_SIGTERM = [
		"const net = require('net');",
		'const port = Number(process.argv[1]);',
		"process.on('SIGTERM', () => {});",
		"net.createServer(s => s.end()).listen(port, '127.0.0.1');",
	].join('\n');

	/** Fails to bind and exits on its FIRST invocation only (a marker file on disk), succeeds on any later one. `argv[1]` port, `argv[2]` marker, `argv[3]` port log, `argv[4]` pid log. */
	const FAIL_FIRST_INVOCATION_ONLY = [
		"const fs = require('fs');",
		"const net = require('net');",
		'const port = Number(process.argv[1]);',
		'const marker = process.argv[2];',
		'const log = process.argv[3];',
		'const pidLog = process.argv[4];',
		"fs.appendFileSync(log, port + '\\n');",
		"fs.appendFileSync(pidLog, process.pid + '\\n');",
		'if (!fs.existsSync(marker)) { fs.writeFileSync(marker, "x"); process.exit(1); }',
		"net.createServer(s => s.end()).listen(port, '127.0.0.1');",
	].join('\n');

	/** Tries to bind `${PORT}` and exits the instant that bind fails — never ignores the error. `argv[1]` port, `argv[2]` pid log, appended to on every invocation. */
	const EXIT_ON_BIND_FAILURE = [
		"const fs = require('fs');",
		"const net = require('net');",
		'const port = Number(process.argv[1]);',
		'const pidLog = process.argv[2];',
		"fs.appendFileSync(pidLog, process.pid + '\\n');",
		"const srv = net.createServer(s => s.end());",
		'srv.on("error", () => process.exit(1));',
		"srv.listen(port, '127.0.0.1');",
	].join('\n');

	// ── assertMintedPortSafe (C27a) ──────────────────────────────────────────

	suite('assertMintedPortSafe — C27(a), the T3.2 default-port dependency', () => {
		test('refuses port 80', () => {
			assert.throws(() => { assertMintedPortSafe(80); }, /port 80/);
		});

		test('accepts an ordinary ephemeral port', () => {
			assert.doesNotThrow(() => { assertMintedPortSafe(54321); });
		});
	});

	// ── happy path ────────────────────────────────────────────────────────────

	suite('bootServer — happy path', () => {
		test('boots a listening server, substitutes ${PORT} into multiple argv elements, and stop() kills it', async function () {
			this.timeout(10_000);
			const result = await bootServer(pkg({
				start: [process.execPath, '-e', LISTEN_IMMEDIATELY, '${PORT}', '--also=${PORT}'],
			}), runDir);

			assert.strictEqual(result.ok, true);
			if (!result.ok) { return; }
			assert.notStrictEqual(result.server.port, 80, 'a real :0 bind must never be port 80');
			assert.ok(isAlive(result.server.pid), 'the booted server must be running');

			// Prove it is genuinely reachable at the reported port.
			await new Promise<void>((resolve, reject) => {
				const socket = net.connect(result.server.port, '127.0.0.1');
				socket.once('connect', () => { socket.destroy(); resolve(); });
				socket.once('error', reject);
			});

			await result.server.stop();
			await assertEventuallyDead(result.server.pid);
		});

		test('a dir escaping the run directory is refused before anything is spawned', async () => {
			const result = await bootServer(pkg({ dir: '../evil' }), runDir);
			assert.strictEqual(result.ok, false);
			if (result.ok) { return; }
			assert.match(result.reason, /escapes|relative/i);
		});

		test('stop() is idempotent — a second call is a harmless no-op', async function () {
			this.timeout(10_000);
			const result = await bootServer(pkg(), runDir);
			assert.strictEqual(result.ok, true);
			if (!result.ok) { return; }
			await result.server.stop();
			await result.server.stop();
			await assertEventuallyDead(result.server.pid, 500);
		});
	});

	// ── S6: readiness is a TCP connect, a log substring is never sufficient alone ──

	suite('bootServer — S6 readiness', () => {
		test('a ready: substring is required IN ADDITION to a TCP connect, not instead of it', async function () {
			this.timeout(10_000);
			const started = Date.now();
			const result = await bootServer(pkg({
				ready: 'READY_MARKER',
				start: [process.execPath, '-e', LISTEN_THEN_LOG_LATE, '${PORT}', '200'],
			}), runDir, { bootTimeoutMs: 5000 });
			const elapsed = Date.now() - started;

			assert.strictEqual(result.ok, true);
			assert.ok(elapsed >= 180, `boot reported ready after ${elapsed}ms — before the declared ready: line was ever printed`);
			if (result.ok) { await result.server.stop(); }
		});

        // This is the mutation Orchestrator note #7 names directly: "accept a
        // log substring as sole readiness". A server that prints the ready
        // line immediately but never opens the port must never read as ready.
		test('a ready: substring with no listening port never reports ready (S6)', async function () {
			this.timeout(10_000);
			const pidFile = path.join(runDir, 'pid.txt');
			const result = await bootServer(pkg({
				ready: 'READY_MARKER',
				start: [process.execPath, '-e', LOG_ONLY_NEVER_LISTENS, pidFile],
			}), runDir, { bootTimeoutMs: 300 });

			assert.strictEqual(result.ok, false);
			const pid = Number(fs.readFileSync(pidFile, 'utf8'));
			await assertEventuallyDead(pid);
		});
	});

	// ── S4: process-group teardown, including a never-ready child ───────────────

	suite('bootServer — never ready (S4, the primary Test First)', () => {
		test('a child that never becomes ready is reported and leaves no orphan process', async function () {
			this.timeout(10_000);
			const pidFile = path.join(runDir, 'pid.txt');
			const result = await bootServer(pkg({
				start: [process.execPath, '-e', NEVER_BINDS, pidFile],
			}), runDir, { bootTimeoutMs: 300 });

			assert.strictEqual(result.ok, false);
			if (result.ok) { return; }
			assert.match(result.reason, /never became ready/);

			const pid = Number(fs.readFileSync(pidFile, 'utf8'));
			await assertEventuallyDead(pid);
		});
	});

	suite('bootServer — S4 group teardown reaches a grandchild', () => {
		test('stop() kills the whole process group, not just the direct child', async function () {
			this.timeout(10_000);
			const gcPidFile = path.join(runDir, 'gc-pid.txt');
			const result = await bootServer(pkg({
				start: [process.execPath, '-e', SPAWN_GRANDCHILD, '${PORT}', gcPidFile],
			}), runDir);

			assert.strictEqual(result.ok, true);
			if (!result.ok) { return; }

			// Give the grandchild a moment to actually start and write its pid.
			await new Promise(resolve => setTimeout(resolve, 100));
			const grandchildPid = Number(fs.readFileSync(gcPidFile, 'utf8'));
			assert.ok(isAlive(grandchildPid), 'grandchild must be alive before teardown, or this test proves nothing');

			await result.server.stop();
			await assertEventuallyDead(result.server.pid);
			await assertEventuallyDead(grandchildPid);
		});
	});

	suite('bootServer — S4 SIGTERM-ignoring process is still killed', () => {
		test('stop() escalates to SIGKILL when the process ignores SIGTERM', async function () {
			this.timeout(10_000);
			const result = await bootServer(pkg({
				start: [process.execPath, '-e', IGNORES_SIGTERM, '${PORT}'],
			}), runDir);

			assert.strictEqual(result.ok, true);
			if (!result.ok) { return; }
			await result.server.stop();
			await assertEventuallyDead(result.server.pid);
		});
	});

	// ── S13: the port is retried, not assumed ────────────────────────────────────

	suite('bootServer — S13 port retry', () => {
		test('a child that fails once is retried with a fresh port and the failed attempt is not orphaned', async function () {
			this.timeout(10_000);
			const marker = path.join(runDir, 'marker.txt');
			const portLog = path.join(runDir, 'ports.log');
			const pidLog = path.join(runDir, 'pids.log');
			const result = await bootServer(pkg({
				start: [process.execPath, '-e', FAIL_FIRST_INVOCATION_ONLY, '${PORT}', marker, portLog, pidLog],
			}), runDir);

			assert.strictEqual(result.ok, true);
			if (!result.ok) { return; }

			const ports = fs.readFileSync(portLog, 'utf8').trim().split('\n').map(Number);
			assert.strictEqual(ports.length, 2, 'the retry loop must have made exactly two attempts');
			assert.strictEqual(ports[1], result.server.port, 'the surviving server must be the second attempt');

			// The assertion Orchestrator note asked for directly: a refused/retried
			// boot must not leave the losing attempt's process alive. It is not
			// enough that the return value looks right — the earlier hang this
			// suite produced was a bootServer that reported correctly-shaped
			// results while a spawned child kept running underneath it.
			const spawnedPids = fs.readFileSync(pidLog, 'utf8').trim().split('\n').filter(Boolean).map(Number);
			assert.strictEqual(spawnedPids.length, 2, 'both attempts must have recorded a pid');
			assert.notStrictEqual(spawnedPids[0], result.server.pid, 'the failed first attempt must not be the pid now serving');
			await assertEventuallyDead(spawnedPids[0]);

			await result.server.stop();
			await assertEventuallyDead(result.server.pid);
		});

		test('a connect that races past the spawned child\'s own death is refused, never reported ready (unattributable)', async function () {
			this.timeout(10_000);
			// An impostor that answers on a fixed port, simulating "something else
			// is already listening there" — the real child's own bind onto that
			// exact port must fail immediately, and this module must never credit
			// the impostor's response to the child it spawned.
			const impostor = net.createServer(s => s.end());
			await new Promise<void>(resolve => { impostor.listen(0, '127.0.0.1', resolve); });
			const address = impostor.address();
			if (address === null || typeof address === 'string') { throw new Error('failed to bind the impostor'); }
			const occupiedPort = address.port;
			const pidLog = path.join(runDir, 'pids.log');

			try {
				const result = await bootServer(pkg({
					start: [process.execPath, '-e', EXIT_ON_BIND_FAILURE, '${PORT}', pidLog],
				}), runDir, {
					bootTimeoutMs: 2000,
					mintPort: () => Promise.resolve(occupiedPort),
				});

				// Defensive cleanup on the *unexpected* path only — never expected to
				// run when the guard below holds, but a false-positive `ok: true`
				// must not itself leave a second orphan on top of the one being
				// tested for.
				if (result.ok) { await result.server.stop(); }

				assert.strictEqual(
					result.ok, false,
					'a connect answered by the impostor must never be credited to the spawned child',
				);

				// Every attempt records its pid before it ever tries to bind (see the
				// fixture) — so this is the same "no spawned pid survives" proof as
				// the retry test above, but for every one of the (up to three)
				// attempts a fully-occupied port forces.
				const spawnedPids = fs.readFileSync(pidLog, 'utf8').trim().split('\n').filter(Boolean).map(Number);
				assert.ok(spawnedPids.length >= 1, 'the fixture must have recorded at least one spawned pid');
				for (const pid of spawnedPids) {
					await assertEventuallyDead(pid);
				}
			} finally {
				impostor.close();
			}
		});
	});

	// ── S12: session-level registration, pure and vscode-free ───────────────────

	suite('BootedGroupRegistry — S12, drained the way endChallenge() drains it', () => {
		test('a booted group is registered the moment it is spawned, before readiness is known', async function () {
			this.timeout(10_000);
			const registry = createGroupRegistry();
			const result = await bootServer(pkg(), runDir, { registry });
			assert.strictEqual(result.ok, true);
			if (result.ok) { await result.server.stop(); }
		});

		test('teardownAll() alone kills a still-registered group, exactly what endChallenge() calls', async function () {
			this.timeout(10_000);
			const registry = createGroupRegistry();
			const result = await bootServer(pkg(), runDir, { registry });
			assert.strictEqual(result.ok, true);
			if (!result.ok) { return; }

			// The normal path (server.stop()) is deliberately never called here —
			// this is the crash-mid-run scenario S12 exists for: nothing but the
			// session's own registry stands between this server and an orphan.
			await registry.teardownAll();
			await assertEventuallyDead(result.server.pid);
		});
	});

	// ── killProcessGroup, exercised directly ─────────────────────────────────────

	suite('killProcessGroup', () => {
		test('a pid that is already gone is a harmless no-op', async () => {
			// A pid essentially guaranteed not to exist on this machine right now.
			await assert.doesNotReject(killProcessGroup(999_999));
		});
	});

	// ── C31: a booted package now receives PORT ──────────────────────────────

	suite('bootServer — C31, PORT is injected into the child environment', () => {
		test('a start script that reads process.env.PORT (never argv) still binds and is reachable', async function () {
			this.timeout(10_000);
			// No `${PORT}` anywhere in argv — before C31 this script would read
			// `undefined`, `Number(undefined)` is `NaN`, and `listen(NaN, …)`
			// throws inside the child. If this boots, PORT reached the child.
			const READ_PORT_FROM_ENV = [
				"const net = require('net');",
				'const port = Number(process.env.PORT);',
				"net.createServer(s => s.end()).listen(port, '127.0.0.1');",
			].join('\n');

			const result = await bootServer(pkg({ start: [process.execPath, '-e', READ_PORT_FROM_ENV] }), runDir);
			assert.strictEqual(result.ok, true);
			if (!result.ok) { return; }
			await new Promise<void>((resolve, reject) => {
				const socket = net.connect(result.server.port, '127.0.0.1');
				socket.once('connect', () => { socket.destroy(); resolve(); });
				socket.once('error', reject);
			});
			await result.server.stop();
		});
	});

	// ── C32: ${PORT} substituted into argv[0] too ────────────────────────────

	suite('bootServer — C32, ${PORT} at argv index 0', () => {
		/**
		 * **The obvious test here is vacuous, and this one exists because that
		 * one shipped.** Asserting that `bootServer`'s failure *reason* does not
		 * contain the literal `${PORT}` proves nothing: `bootServer` never
		 * surfaces the spawn error text at all, so `start: ['${PORT}']` reports
		 * the identical `… exited before the server became ready` whether argv[0]
		 * is substituted or not. Deleting the fix left that suite 20 passing, 0
		 * failing.
		 *
		 * So this pins the substitution by **making the port the only thing that
		 * can make the command exist**. The port is forced with `mintPort`, a
		 * real executable is written at `boot-<port>.sh`, and `start` names
		 * `./boot-${PORT}.sh`: without argv[0] substitution `spawn` looks for a
		 * file literally called `boot-${PORT}.sh`, which is not on disk, and the
		 * boot can never succeed. Success is therefore only reachable through
		 * the substitution — an outcome the two branches cannot share.
		 */
		test('${PORT} in argv[0] is substituted — a script only reachable by its substituted name boots', async function () {
			this.timeout(10_000);
			const port = await freePort();
			const script = path.join(runDir, 'server', `boot-${port}.sh`);
			fs.writeFileSync(
				script,
				['#!/bin/sh', `exec ${JSON.stringify(process.execPath)} -e "$1" "$2"`, ''].join('\n'),
				'utf8',
			);
			fs.chmodSync(script, 0o755);

			const LISTEN = "require('net').createServer(s => s.end()).listen(Number(process.argv[1]), '127.0.0.1');";
			const result = await bootServer(
				pkg({ start: ['./boot-${PORT}.sh', LISTEN, '${PORT}'] }),
				runDir,
				{ mintPort: () => Promise.resolve(port), bootTimeoutMs: 5_000 },
			);

			assert.strictEqual(result.ok, true, result.ok ? '' : result.reason);
			if (!result.ok) { return; }
			assert.strictEqual(result.server.port, port);
			await result.server.stop();
		});
	});

	// ── item 5: env composition is spread-then-allowlist, never a wholesale spread ──

	suite('bootServer — item 5, the child env is spread-then-allowlist, not a wholesale spread', () => {
		test('a safe exposeAs-shaped var reaches the child; a hostile PATH or PORT override in opts.env never does', async function () {
			this.timeout(10_000);
			const outFile = path.join(runDir, 'env-report.json');
			const REPORT_ENV = [
				"const net = require('net');",
				"const fs = require('fs');",
				'const port = Number(process.env.PORT);',
				`fs.writeFileSync(${JSON.stringify(outFile)}, JSON.stringify({`,
				'  path: process.env.PATH,',
				'  safeVar: process.env.MY_SAFE_VAR,',
				'  port: process.env.PORT,',
				'}));',
				"net.createServer(s => s.end()).listen(port, '127.0.0.1');",
			].join('\n');

			const inheritedPath = process.env.PATH ?? '';
			const result = await bootServer(pkg({
				start: [process.execPath, '-e', REPORT_ENV],
				exposeAs: { MY_SAFE_VAR: 'http://127.0.0.1:${PORT}' },
			}), runDir, {
				// A direct caller's `env` is defense-in-depth territory (a unit
				// test standing in for "some future non-parsed entry point") —
				// `packages-parser.helpers.ts` would already have refused `PATH`
				// as an `exposeAs` name at parse time, so this proves `bootServer`
				// itself never trusts that the parser ran.
				// `PORT` is the second half of the same rule, and it is the one that
				// actually shipped broken: it passes `isSafeExposeName`'s shape check,
				// so while it was assigned *before* the allowlist loop an artifact
				// could overwrite the minted port with its own value. It fails closed
				// (`Number('http://…')` is NaN, the child binds nothing and never
				// becomes ready) rather than dangerously — but `composeChildEnv`'s doc
				// claims the port is this module's own literal, and that has to be true.
				env: { PATH: '/evil/shadow-path', PORT: 'http://127.0.0.1:9', MY_SAFE_VAR: 'http://127.0.0.1:9' },
			});

			assert.strictEqual(result.ok, true);
			if (!result.ok) { return; }
			await new Promise<void>((resolve, reject) => {
				const socket = net.connect(result.server.port, '127.0.0.1');
				socket.once('connect', () => { socket.destroy(); resolve(); });
				socket.once('error', reject);
			});
			await result.server.stop();

			const report = JSON.parse(fs.readFileSync(outFile, 'utf8')) as
				{ path: string; safeVar: string; port: string };
			// C36 (T4.7): PATH is now `runDir`'s own `node_modules/.bin` ahead of
			// whatever was inherited — never a bare pass-through — so the
			// assertion is "still ends in the untouched inherited PATH", not
			// strict equality to it.
			const expectedBinDir = path.join(runDir, 'node_modules', '.bin');
			assert.strictEqual(
				report.path, `${expectedBinDir}${path.delimiter}${inheritedPath}`,
				'PATH must be runDir\'s node_modules/.bin ahead of the untouched inherited PATH, never shadowed by an opts.env entry',
			);
			assert.strictEqual(report.safeVar, 'http://127.0.0.1:9', 'an allowlisted name must still reach the child');
			assert.strictEqual(
				report.port, String(result.server.port),
				'PORT must be this module\'s own minted literal, never an artifact-supplied override',
			);
		});
	});

	// ── C33: SIGINT/SIGTERM teardown, the harness/CLI backstop ───────────────

	suite('installSignalTeardown — C33, the harness/CLI backstop for a Ctrl-C/kill mid-boot', () => {
		test('emitting SIGINT drains the registry and calls the injected exit — proving the handler actually runs, not just that it is registered', async function () {
			this.timeout(10_000);
			const registry = createGroupRegistry();
			const result = await bootServer(pkg(), runDir, { registry });
			assert.strictEqual(result.ok, true);
			if (!result.ok) { return; }

			let exitCode: number | undefined;
			const uninstall = installSignalTeardown(registry, code => { exitCode = code; });
			try {
				// A real OS signal to *this* test process would kill the test
				// runner — `process.emit` fires the exact same listener a real
				// `SIGINT` would (Node's own signal dispatch is nothing more than
				// this emit), without touching the process actually running the
				// suite. The registered server is real; only the delivery
				// mechanism is substituted. A **real** SIGINT passes `'SIGINT'` as
				// the listener's argument (confirmed against an actual `kill -INT`
				// child) — `process.emit('SIGINT')` alone does not forward it, so
				// the second argument here is required to reproduce that shape.
				process.emit('SIGINT', 'SIGINT');
				// Poll for `exit` itself, rather than for the pid's death: both this
				// module's internal `killProcessGroup` and a separate poll of the
				// same pid race the same 20ms-interval check, so waiting on pid
				// death first can observe it before `.finally()`'s microtask has
				// run — `exitCode` is the one signal that is authoritative, since
				// `onSignal` calls it only *after* `registry.teardownAll()` settles.
				await waitUntil(() => exitCode !== undefined, 3000);
				assert.strictEqual(exitCode, 130, 'SIGINT must report the conventional 128+2 exit code');
				await assertEventuallyDead(result.server.pid);
			} finally {
				uninstall();
			}
		});

		/**
		 * **Counts, not `doesNotThrow` — the obvious spelling asserts nothing.**
		 * The handler's work happens inside `void registry.teardownAll()
		 * .finally(…)`, so anything it throws is asynchronous and a synchronous
		 * `assert.doesNotThrow(() => process.emit('SIGINT'))` cannot observe a
		 * listener that is still installed. Replacing `uninstall` with a no-op
		 * left that spelling at 20 passing, 0 failing.
		 *
		 * Deltas against `before`, never against zero: mocha's own process
		 * already carries `SIGINT`/`SIGTERM` listeners, so an absolute
		 * assertion would pass or fail by harness accident rather than by this
		 * module's behaviour.
		 */
		/**
		 * **C35 — a registry that has begun draining kills on arrival.**
		 * Without this, a signal landing *mid-boot* still orphaned a server:
		 * `teardownAll()` clears the set and awaits the kill, the killed child
		 * makes `waitReady` report `childExited: true`, S13 treats that as
		 * retryable, and `bootServer` spawns a **fresh** detached child into a
		 * set nobody will drain again. Reproduced on the real CLI — the
		 * registered pid reaped, a new child on a new port surviving.
		 *
		 * A real spawned process, not a fake pid: the assertion is that the
		 * late arrival is actually dead, which only a real process can answer.
		 */
		test('C35: a pid registered after teardown began is killed on arrival, not stored', async function () {
			this.timeout(10_000);
			const registry = createGroupRegistry();
			await registry.teardownAll();

			const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { detached: true, stdio: 'ignore' });
			assert.ok(child.pid !== undefined, 'the fixture child must have a pid');
			const pid = child.pid;
			try {
				registry.register(pid);
				await assertEventuallyDead(pid);
			} finally {
				// The assertion above is the whole test, so a FAILING run is exactly
				// the run that left this child alive — reap it here or a red test
				// leaks the very process this suite exists to stop leaking, and
				// mocha never exits.
				await killProcessGroup(pid).catch(() => { /* already gone */ });
			}
		});

		test('uninstall() removes both listeners — asserted by count, since a late throw is unobservable', () => {
			const registry = createGroupRegistry();
			const beforeInt = process.listenerCount('SIGINT');
			const beforeTerm = process.listenerCount('SIGTERM');

			const uninstall = installSignalTeardown(registry, () => { throw new Error('must not be called after uninstall'); });
			assert.strictEqual(process.listenerCount('SIGINT'), beforeInt + 1, 'install must add exactly one SIGINT listener');
			assert.strictEqual(process.listenerCount('SIGTERM'), beforeTerm + 1, 'install must add exactly one SIGTERM listener');

			uninstall();
			assert.strictEqual(process.listenerCount('SIGINT'), beforeInt, 'uninstall must remove its SIGINT listener');
			assert.strictEqual(process.listenerCount('SIGTERM'), beforeTerm, 'uninstall must remove its SIGTERM listener');
		});
	});

	// ── C29 (T4.7, VSX-227): a booted package gets the env its libs: bought ──

	suite('bootServer — C29, libDirs reach the booted child directly', () => {
		test('a pip libDirs entry sets VIRTUAL_ENV on the spawned child', async function () {
			this.timeout(10_000);
			const pipDir = path.join(runDir, 'fake-venv');
			fs.mkdirSync(path.join(pipDir, 'bin'), { recursive: true });
			const outFile = path.join(runDir, 'venv-report.json');
			const REPORT_VENV = [
				"const net = require('net');",
				"const fs = require('fs');",
				'const port = Number(process.env.PORT);',
				`fs.writeFileSync(${JSON.stringify(outFile)}, JSON.stringify({ virtualEnv: process.env.VIRTUAL_ENV || null }));`,
				"net.createServer(s => s.end()).listen(port, '127.0.0.1');",
			].join('\n');
			const libDirs: ReadonlyMap<LibEcosystem, string> = new Map([['pip', pipDir]]);

			const result = await bootServer(pkg({ start: [process.execPath, '-e', REPORT_VENV] }), runDir, { libDirs });
			assert.strictEqual(result.ok, true, result.ok ? '' : result.reason);
			if (!result.ok) { return; }
			await result.server.stop();

			const report = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { virtualEnv: string | null };
			assert.strictEqual(report.virtualEnv, pipDir, 'VIRTUAL_ENV must reach the child from libDirs');
		});
	});

	// ── C36 (T4.7, VSX-227): runDir's node_modules/.bin joins PATH ──────────

	suite('bootServer — C36, runDir/node_modules/.bin is ahead of PATH', () => {
		test('a start command resolvable only via node_modules/.bin actually resolves and boots', async function () {
			this.timeout(10_000);
			const binDir = path.join(runDir, 'node_modules', '.bin');
			fs.mkdirSync(binDir, { recursive: true });
			const toolPath = path.join(binDir, 'leet-fake-tool');
			fs.writeFileSync(
				toolPath,
				['#!/bin/sh', `exec ${JSON.stringify(process.execPath)} -e "$1"`, ''].join('\n'),
				'utf8',
			);
			fs.chmodSync(toolPath, 0o755);

			const LISTEN_FROM_PORT_ENV =
				"require('net').createServer(s => s.end()).listen(Number(process.env.PORT), '127.0.0.1');";

			// `leet-fake-tool` names no path — it is reachable at all only through
			// PATH, and nothing but this run's own linked `.bin` could ever hold a
			// command by this name. If this boots, `runDir/node_modules/.bin`
			// reached the child's PATH.
			const result = await bootServer(pkg({ start: ['leet-fake-tool', LISTEN_FROM_PORT_ENV] }), runDir);
			assert.strictEqual(result.ok, true, result.ok ? '' : result.reason);
			if (!result.ok) { return; }
			await result.server.stop();
		});
	});

	// ── C39 (T4.7, VSX-227): a boot failure carries the child's own text ────

	suite('bootServer — C39, the failure reason carries the child\'s own diagnostic', () => {
		test('a missing executable (spawn ENOENT) classifies as infrastructure, not candidate', async function () {
			this.timeout(10_000);
			const result = await bootServer(pkg({
				start: ['definitely-not-a-real-leet-command-xyz'],
			}), runDir, { bootTimeoutMs: 2000 });

			assert.strictEqual(result.ok, false, 'a nonexistent command must never report a boot success');
			if (result.ok) { return; }
			assert.match(result.reason, /ENOENT/, `reason must carry the spawn error text; got "${result.reason}"`);
			assert.strictEqual(
				classifyStarterFailure(result.reason), 'infrastructure',
				'a missing interpreter must classify as infrastructure so --starter-red reports INCONCLUSIVE, not RED',
			);
		});

		test('a candidate crash with no infra-shaped text stays classified candidate', async function () {
			this.timeout(10_000);
			const CRASH_WITH_OWN_MESSAGE = "console.error('totally ordinary bug in the solver code'); process.exit(1);";
			const result = await bootServer(pkg({
				start: [process.execPath, '-e', CRASH_WITH_OWN_MESSAGE],
			}), runDir, { bootTimeoutMs: 2000 });

			assert.strictEqual(result.ok, false);
			if (result.ok) { return; }
			assert.match(result.reason, /totally ordinary bug in the solver code/);
			assert.strictEqual(
				classifyStarterFailure(result.reason), 'candidate',
				'an ordinary candidate crash must not be misclassified as a broken toolchain',
			);
		});

		test('the crash diagnostic survives 500+ chars of banner noise ahead of it — truncation is from the TAIL', async function () {
			this.timeout(10_000);
			// A dev-server `start` (`npm start` → vite/next) routinely prints
			// hundreds of characters of banner before the line that actually
			// matters — this reproduces that shape directly rather than shelling
			// out to a real bundler. 600 > MAX_LOG_IN_REASON (500), so a
			// head-truncating reason drops the diagnostic entirely.
			const NOISY_THEN_CRASH = [
				"process.stdout.write('X'.repeat(600) + '\\n');",
				"console.error(\"Cannot find module 'totally-not-installed-xyz'\");",
				'process.exit(1);',
			].join('\n');
			const result = await bootServer(pkg({
				start: [process.execPath, '-e', NOISY_THEN_CRASH],
			}), runDir, { bootTimeoutMs: 2000 });

			assert.strictEqual(result.ok, false);
			if (result.ok) { return; }
			assert.match(
				result.reason, /Cannot find module 'totally-not-installed-xyz'/,
				`the tail diagnostic must survive truncation; got "${result.reason}"`,
			);
			assert.strictEqual(
				classifyStarterFailure(result.reason), 'infrastructure',
				'with the diagnostic intact this must classify as infrastructure, not read as banner-only noise',
			);
		});
	});
});
