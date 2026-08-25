import { spawn as spawnProcess, type ChildProcess } from 'node:child_process';
import * as net from 'node:net';
import type { PackageSpec } from '../../../types/leetcode.types.js';
import { resolveContained } from '../project/files.writer.js';

/**
 * Server lifecycle for a `packages:` entry (T3.3, VSX-122 §G): mint a port,
 * spawn `start`, wait for readiness, tear down by process group — and
 * register the group where a session-level cleanup can find it even when
 * this module's own `finally` never gets to run.
 *
 * **Scope.** This module boots **one** package. Which check kind drives the
 * requests (T3.4) and how a `stack`'s several packages are ordered by
 * `dependsOn` / wired through `exposeAs` (T4.1) are both out of scope here —
 * {@link bootServer} takes a single {@link PackageSpec} and a run directory
 * and returns one running server or one refusal.
 *
 * **S4 — process-group teardown, POSIX only.** `bootServer` always spawns
 * with `detached: true`, which makes the child the leader of a **new**
 * process group; {@link killProcessGroup} signals `-pid`, not `pid`, so
 * `npm run dev` / `uvicorn --reload` / `mvn exec:java` — every one of them a
 * shim over the real server — is torn down along with whatever it forked,
 * not left holding the port after its shim dies. Negative-pid group
 * signalling is a POSIX concept with no Windows equivalent, the same
 * caveat `runBuildCheck` (`project/build.check.ts`) already carries for its
 * own `PATH` prepending — this module inherits it rather than restating a
 * new one.
 *
 * **S6 — readiness is a TCP connect, never a log line alone.** A `ready:`
 * substring the artifact declares is checked only in **addition** to a
 * successful `net.connect`, because stdout is the solver's own overlay code
 * talking — D6 makes debug output mandatory and free, so a substring match
 * with nothing else behind it is forgeable by construction.
 *
 * **S12 — a booted group is registered before it is known to be ready.**
 * {@link BootedGroupRegistry} is intentionally its own type with no `vscode`
 * dependency: `bootServer` registers the spawned pid the moment `spawn`
 * returns, so a caller holding a session's registry can tear the group down
 * even if this module's own `finally` never runs — the extension host dying,
 * VS Code exiting, or a panel disposed mid-boot are all outside a `finally`'s
 * reach. `leetcode-challenge.service.ts` stores one registry per session and
 * drains it from `endChallenge()`, which is what lets `deactivate()` cover an
 * orphaned server for free.
 *
 * **S13 — the port is retried, not assumed.** Between reading a `:0` bind
 * back and the child binding the same number, another process can take it —
 * the child then fails to bind and exits, or something else already
 * listening answers the readiness probe before the child ever gets a
 * chance to try. A connect that succeeds is therefore only a *candidate*
 * signal: {@link waitReady} settles for {@link ATTRIBUTION_SETTLE_MS} —
 * long enough for a competing process to have started up and failed its own
 * bind — and only then re-checks that the spawned process is still alive.
 * A same-instant check is not enough here; see {@link waitReady}'s own doc
 * for the race it missed. Whatever fails this attribution check is retried
 * with a freshly minted port, up to {@link BOOT_ATTEMPTS}, and the losing
 * attempt's process is torn down before the retry — never left running to
 * win a later, unrelated port race of its own. A deadline reached while the
 * process is still running and never answered at all is not retried — that
 * is an ordinary never-ready failure, not a port race, and retrying it
 * would only multiply {@link BOOT_TIMEOUT_MS} for no benefit.
 */

/** Grace window between SIGTERM and a forced SIGKILL (S4). A solver's overlay is untrusted code and must never be assumed to exit cleanly on its own. */
const TEARDOWN_GRACE_MS = 500;

/** Poll interval used both while waiting for TCP readiness and while waiting for a killed group to actually disappear. */
const POLL_INTERVAL_MS = 25;

/**
 * Settle window after a *candidate* readiness connect, before it is trusted
 * (S13). Long enough for a competing process on the same port to have
 * finished starting up, attempted its own bind, and failed — a `node -e`
 * cold start plus an immediate bind-and-fail measured comfortably under
 * this on this machine; generous rather than tight, since the cost of
 * waiting is paid once per boot, not per poll.
 */
const ATTRIBUTION_SETTLE_MS = 300;

/**
 * Wall-clock budget for one boot attempt: from spawning `start` to a TCP
 * connect succeeding against the still-alive child (P2). Generous relative
 * to a dev-server's typical startup, deliberately not shared with any other
 * budget in the plan — booting is machinery the solver's algorithm has no
 * say over, so a slow boot must never be blamed on their code the way a
 * per-case timeout would be.
 */
export const BOOT_TIMEOUT_MS = 30_000;

/** Total boot attempts, including the first — see the S13 retry rule above. */
const BOOT_ATTEMPTS = 3;

// ── C27(a): the port-80 / default-port dependency on T3.2 ───────────────────

/**
 * Refuse a minted port that would break every `http` case in this run.
 *
 * `buildLoopbackUrl` (T3.2, `http-case.helpers.ts`) compares `url.host`
 * against `127.0.0.1:<port>` verbatim. WHATWG's own URL parser normalises
 * away the *default* HTTP port — `new URL('http://127.0.0.1:80/x').host`
 * reads back as the bare `127.0.0.1`, identical to what a bare-path request
 * resolves to — so assigning port `80` would make that comparison compare
 * against a string no case's request can ever produce, refusing every case
 * in the run. A `:0` bind never returns `80` in practice (the OS hands out
 * ephemeral ports from a high range), but nothing checked that fact before
 * this function did — the dependency between the two modules was assumed,
 * not enforced. Exported so it can be unit-tested directly, independent of
 * ever coercing a real `:0` bind into returning 80.
 *
 * @param port - The port {@link mintPort} just read back.
 * @throws When `port` is `80`.
 *
 * @example
 * assertMintedPortSafe(54321); // → no-op
 * assertMintedPortSafe(80);    // → throws
 */
export function assertMintedPortSafe(port: number): void {
	if (port === 80) {
		throw new Error(
			'bootServer: the OS assigned port 80 from a :0 bind — refusing, because '
			+ "buildLoopbackUrl (T3.2) normalises away the default HTTP port and every "
			+ 'http case in this run would compare against a host string no request can '
			+ 'ever produce (C27a)',
		);
	}
}

// ── S12: the session-level registry, pure and vscode-free ───────────────────

/**
 * Registry of booted process groups a challenge session owns (S12).
 *
 * Deliberately just three methods over a `Set<number>` of group-leader
 * pids — no `ChildProcess` handle, so a caller (`leetcode-challenge
 * .service.ts`) can hold one for a session's whole lifetime without holding
 * open stdio pipes or event listeners it has no use for. `teardownAll` is
 * the only consumer of {@link killProcessGroup} that does not already have a
 * `ChildProcess` to poll — it works from the pid alone, exactly as
 * `bootServer`'s own per-attempt teardown does.
 */
export interface BootedGroupRegistry {
	/** Record a group the moment it is spawned — before readiness is known. */
	register(pid: number): void;
	/** Drop a group this registry no longer owns (normal teardown already ran). */
	unregister(pid: number): void;
	/** Tear down every still-registered group and clear the registry. */
	teardownAll(): Promise<void>;
}

/**
 * Build an empty {@link BootedGroupRegistry}.
 *
 * @returns A registry with nothing booted yet.
 *
 * @example
 * const registry = createGroupRegistry();
 * registry.register(4242);
 * await registry.teardownAll(); // kills process group 4242
 */
export function createGroupRegistry(): BootedGroupRegistry {
	const pids = new Set<number>();
	return {
		register(pid) { pids.add(pid); },
		unregister(pid) { pids.delete(pid); },
		async teardownAll() {
			const toKill = [...pids];
			pids.clear();
			await Promise.all(toKill.map(pid => killProcessGroup(pid)));
		},
	};
}

// ── S4: process-group teardown ───────────────────────────────────────────────

/** Whether `pid` still answers signal `0` — the standard POSIX liveness probe. */
function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Tear down a booted server by **process group**, never by its direct pid
 * (S4). `bootServer` always spawns `detached: true`, so the child is the
 * leader of its own new process group and `process.kill(-pid, …)` reaches
 * every process in it — a shim's own children included, which a direct
 * `process.kill(pid, …)` would leave running with the port still held.
 *
 * SIGTERM first; a process that ignores it (untrusted overlay code must
 * never be assumed to exit cleanly) is escalated to SIGKILL after
 * `graceMs`. Both waits are bounded, so a group stuck in an unkillable
 * state (e.g. an unreaped zombie) cannot hang teardown forever — this
 * function is a best-effort `finally` step, not a promise that the OS will
 * always cooperate within one grace window.
 *
 * POSIX only — see the module doc.
 *
 * @param pid     - The group leader's pid.
 * @param graceMs - Grace window before escalating; defaults to {@link TEARDOWN_GRACE_MS}.
 *
 * @example
 * await killProcessGroup(4242);
 */
export async function killProcessGroup(pid: number, graceMs: number = TEARDOWN_GRACE_MS): Promise<void> {
	if (!isAlive(pid)) { return; }
	try {
		process.kill(-pid, 'SIGTERM');
	} catch {
		return; // ESRCH: the group is already gone
	}
	await waitDead(pid, graceMs);
	if (isAlive(pid)) {
		try {
			process.kill(-pid, 'SIGKILL');
		} catch {
			// already gone
		}
		await waitDead(pid, graceMs);
	}
}

/** Poll until `pid` stops answering signal `0`, or `timeoutMs` runs out. */
async function waitDead(pid: number, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (isAlive(pid) && Date.now() < deadline) {
		await sleep(POLL_INTERVAL_MS);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// ── port minting ──────────────────────────────────────────────────────────────

/**
 * Bind an ephemeral port and read it back — never a guessed or hardcoded
 * number. `:0` asks the OS to pick a free port; the number is only known
 * once `listen` resolves, and the probe closes immediately after reading it
 * so the child can bind the same number (the TOCTOU window S13 retries
 * around).
 */
function mintPort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = net.createServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const address = probe.address();
			probe.close(() => {
				if (address === null || typeof address === 'string') {
					reject(new Error('bootServer: failed to read back a bound port'));
					return;
				}
				try {
					assertMintedPortSafe(address.port);
				} catch (e) {
					reject(e as Error);
					return;
				}
				resolve(address.port);
			});
		});
	});
}

/** `${PORT}` is the only substitution `packages-parser.helpers.ts` ever admits into an argv element — a plain literal replace is all runtime substitution needs. */
function substitutePort(element: string, port: number): string {
	return element.replaceAll('${PORT}', String(port));
}

// ── readiness (S6, S13) ───────────────────────────────────────────────────────

/** Outcome of waiting for one boot attempt to become ready. */
interface ReadyOutcome {
	readonly ok: boolean;
	readonly reason?: string;
	/** Whether the spawned process had already exited when this outcome was decided — the S13 retry signal. */
	readonly childExited: boolean;
}

/** Whether a TCP connect to `127.0.0.1:port` succeeds within `timeoutMs`. */
function tryConnect(port: number, timeoutMs: number): Promise<boolean> {
	return new Promise(resolve => {
		const socket = new net.Socket();
		let settled = false;
		const finish = (ok: boolean): void => {
			if (settled) { return; }
			settled = true;
			socket.destroy();
			resolve(ok);
		};
		const timer = setTimeout(() => finish(false), timeoutMs);
		socket.once('connect', () => { clearTimeout(timer); finish(true); });
		socket.once('error', () => { clearTimeout(timer); finish(false); });
		socket.connect(port, '127.0.0.1');
	});
}

/**
 * Poll for readiness until it is confirmed, the process exits, or `deadline`
 * passes.
 *
 * A TCP connect is the baseline signal (S6); `readySubstring`, when the
 * package declares `ready:`, is checked only **in addition** to it, never
 * instead of it.
 *
 * **S13 attribution is a settle-and-recheck, not a single point-in-time
 * check.** A bare "has the child exited *yet*" check races: when a stale
 * listener already occupies the minted port (the TOCTOU window this
 * function exists to close), the very first connect attempt can succeed
 * against *that* listener before the freshly-spawned child has even
 * finished starting up, let alone attempted its own bind and failed —
 * `state.exited` is still `false` at that instant not because the child
 * owns the port, but because it has not gotten far enough to find out it
 * doesn't. Measured against a real impostor: a same-instant check reported
 * `ok: true` for a child whose own bind failed tens of milliseconds later,
 * once Node finished starting it up. So a first successful connect is only
 * a *candidate*: this function waits {@link ATTRIBUTION_SETTLE_MS} — long
 * enough for a competing process to have started, attempted its own bind,
 * and failed — then re-checks `state.exited` before trusting it. Two
 * processes can never both hold a listening socket on the same port, so a
 * child that is still alive after that settle window, with the port still
 * answering, has to be the one actually holding it.
 */
async function waitReady(
	child: ChildProcess, port: number, readySubstring: string | undefined,
	state: { exited: boolean }, log: { text: string }, deadline: number,
): Promise<ReadyOutcome> {
	for (;;) {
		if (state.exited) {
			return { ok: false, reason: 'the spawned process exited before the server became ready', childExited: true };
		}
		if (Date.now() >= deadline) {
			return { ok: false, reason: 'server never became ready', childExited: false };
		}
		const budget = Math.max(1, Math.min(POLL_INTERVAL_MS * 4, deadline - Date.now()));
		const connected = await tryConnect(port, budget);
		if (connected) {
			await sleep(ATTRIBUTION_SETTLE_MS);
			if (state.exited) {
				return {
					ok: false,
					reason: 'the port answered but the spawned process had already exited — unattributable (S13)',
					childExited: true,
				};
			}
			if (readySubstring === undefined || log.text.includes(readySubstring)) {
				return { ok: true, childExited: false };
			}
		}
		await sleep(POLL_INTERVAL_MS);
	}
}

// ── boot ───────────────────────────────────────────────────────────────────────

/** A running server this module booted and can tear down on request. */
export interface BootedServer {
	readonly pid: number;
	readonly port: number;
	/** Tear down the process group. Idempotent — a second call is a no-op. */
	stop(): Promise<void>;
}

/** {@link bootServer}'s result: a running server, or the reason boot never confirmed one. */
export type BootResult =
	| { readonly ok: true; readonly server: BootedServer }
	| { readonly ok: false; readonly reason: string };

/** Optional knobs for {@link bootServer}. */
export interface BootOptions {
	/** Overrides {@link BOOT_TIMEOUT_MS} — a test-only escape hatch; production callers omit it. */
	readonly bootTimeoutMs?: number;
	/** A session's registry, when this boot should be torn down by `endChallenge()` too (S12). Omit for a boot with no session (e.g. a direct unit test). */
	readonly registry?: BootedGroupRegistry;
	/**
	 * Overrides the internal `:0`-bind port minter. A test-only seam — the
	 * same shape as `RunArgv` in `lib-ecosystem.ts`, "the seam every
	 * installer test observes instead of the network" — that lets a test
	 * force the exact port TOCTOU race S13 defends against (an impostor
	 * already listening on the port a real bind would otherwise have picked)
	 * without depending on OS scheduling to win that race. Production
	 * callers omit it; the real bind-and-read-back still runs, retries and
	 * all.
	 */
	readonly mintPort?: () => Promise<number>;
}

/** One boot attempt's result — `retryable` is the S13 signal `bootServer`'s loop reads. */
interface AttemptResult {
	readonly ok: boolean;
	readonly reason?: string;
	readonly retryable: boolean;
	readonly server?: BootedServer;
}

/** Spawn `pkg.start` once, with `${PORT}` substituted, and wait for readiness. */
async function attemptBoot(
	pkg: PackageSpec, cwd: string, command: string, rawArgs: readonly string[],
	bootTimeoutMs: number, registry: BootedGroupRegistry | undefined,
	mint: () => Promise<number>,
): Promise<AttemptResult> {
	let port: number;
	try {
		port = await mint();
	} catch (e) {
		// A port-minting failure is not the child's fault — nothing about a fresh attempt would help.
		return { ok: false, reason: e instanceof Error ? e.message : String(e), retryable: false };
	}

	const args = rawArgs.map(el => substitutePort(el, port));
	const child = spawnProcess(command, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });

	const state = { exited: false };
	child.on('error', () => { state.exited = true; });
	child.on('exit', () => { state.exited = true; });

	const log = { text: '' };
	child.stdout?.on('data', (chunk: Buffer) => { log.text += chunk.toString('utf8'); });
	child.stderr?.on('data', (chunk: Buffer) => { log.text += chunk.toString('utf8'); });

	// S12: registered the moment it is spawned — before readiness, even before
	// we know this attempt will succeed. A caller with no registry (a direct
	// unit test, say) simply gets no session-level safety net.
	if (child.pid !== undefined) { registry?.register(child.pid); }

	const outcome = await waitReady(child, port, pkg.ready, state, log, Date.now() + bootTimeoutMs);

	if (outcome.ok && child.pid !== undefined) {
		const pid = child.pid;
		let stopped = false;
		return {
			ok: true, retryable: false,
			server: {
				pid, port,
				stop: async () => {
					if (stopped) { return; }
					stopped = true;
					await killProcessGroup(pid);
					registry?.unregister(pid);
				},
			},
		};
	}

	// Either a genuine refusal, or (type-only edge) a connect that raced past a
	// pid that was never assigned — neither may report success.
	if (child.pid !== undefined) {
		await killProcessGroup(child.pid);
		registry?.unregister(child.pid);
	}
	const reason = outcome.ok
		? `packages: '${pkg.name}' lost its process before it could be confirmed ready`
		: `packages: '${pkg.name}' — ${outcome.reason}`;
	return { ok: false, reason, retryable: outcome.ok ? true : outcome.childExited };
}

/**
 * Boot one package: mint a port, spawn `start` with `${PORT}` substituted,
 * wait for readiness, and hand back a running server or a named refusal.
 *
 * Never assumes `pkg.dir` is safe on its own — `packages-parser.helpers.ts`
 * only shape-guards it at parse time (no `..`, no `node_modules` segment,
 * not absolute); this is the point of use, so `resolveContained` runs here
 * against the real `runDir` before anything is spawned.
 *
 * @param pkg    - The package to boot. Only `dir`, `start` and `ready` are
 *   read here — `install` and `dependsOn`/`exposeAs` ordering belong to
 *   whoever boots a whole `packages:` list (T3.4/T4.1), not to booting one.
 * @param runDir - Absolute run directory; `pkg.dir` resolves inside it.
 * @param opts   - Optional boot-timeout override and session registry.
 * @returns The booted server, or the reason it never became ready.
 *
 * @example
 * const result = await bootServer(pkg, '/tmp/run123', { registry: session.bootedGroups });
 * if (result.ok) {
 *   // ... issue requests against `result.server.port` ...
 *   await result.server.stop();
 * }
 */
export async function bootServer(pkg: PackageSpec, runDir: string, opts: BootOptions = {}): Promise<BootResult> {
	const bootTimeoutMs = opts.bootTimeoutMs ?? BOOT_TIMEOUT_MS;
	const mint = opts.mintPort ?? mintPort;

	let cwd: string;
	try {
		cwd = resolveContained(runDir, pkg.dir);
	} catch (e) {
		return { ok: false, reason: e instanceof Error ? e.message : String(e) };
	}

	const [command, ...rawArgs] = pkg.start;
	if (command === undefined) {
		return { ok: false, reason: `packages: '${pkg.name}' start is an empty argv` };
	}

	let lastReason = 'server never became ready';
	for (let attempt = 0; attempt < BOOT_ATTEMPTS; attempt++) {
		const result = await attemptBoot(pkg, cwd, command, rawArgs, bootTimeoutMs, opts.registry, mint);
		if (result.ok && result.server) { return { ok: true, server: result.server }; }
		lastReason = result.reason ?? lastReason;
		if (!result.retryable) { break; }
	}
	return { ok: false, reason: lastReason };
}
