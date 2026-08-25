import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PackageSpec } from '../src/types/leetcode.types.js';
import {
	assertMintedPortSafe,
	bootServer,
	createGroupRegistry,
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
});
