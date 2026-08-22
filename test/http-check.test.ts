import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MAX_HTTP_BODY_BYTES } from '../src/services/test-envs/http/http-case.helpers.js';
import { runHttpCheck } from '../src/services/test-envs/http/http.check.js';
import type { PackageSpec } from '../src/services/packages-parser.helpers.js';

/**
 * The `http` check kind (T3.4, VSX-122 §G): one boot serves every case, per-
 * case outcomes reduce to one {@link ProjectCheckOutcome}, and the server is
 * always torn down.
 *
 * Every test here spawns a real `node -e` HTTP server (the honest fixture
 * Orchestrator note #5 asks for) rather than mocking `bootServer` — "one
 * boot, N cases" is only proven by counting real process starts, and a mock
 * that always boots once would pass even if the implementation booted per
 * case.
 *
 * **The suite-deadline suite injects a fake clock rather than waiting.**
 * `suiteTimeout(cases.length, clampedPerCase)` sums to the full budget
 * exactly when every case takes up to its own fair share — that is the
 * point of the formula — so a *real* case succeeding inside its own
 * per-request budget can never itself starve a later case of wall-clock
 * time; the deadline only ever binds once `MAX_SUITE_TIMEOUT_MS` (60 s) has
 * capped the suite below what `cases.length × clampedPerCase` would
 * otherwise allow. Proving that end to end without a real 60-second-plus
 * wait needs a controllable clock — `runHttpCheck`'s optional `now` param,
 * the same test-only-seam spirit as `bootOpts.mintPort` — so this suite
 * still runs against a real booted server (deterministic on the request
 * path) while controlling only the deadline arithmetic.
 */
suite('http-check', () => {

	let runDir: string;
	let pkgDir: string;
	let bootLog: string;
	let reqLog: string;

	setup(() => {
		runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leet-httpcheck-'));
		pkgDir = path.join(runDir, 'server');
		fs.mkdirSync(pkgDir);
		bootLog = path.join(runDir, 'boot.log');
		reqLog = path.join(runDir, 'req.log');
	});

	teardown(() => {
		fs.rmSync(runDir, { recursive: true, force: true });
	});

	/** Binds `${PORT}` immediately, records its own pid per boot, and echoes `{method,path}` as JSON. */
	const ECHO_SERVER = [
		"const http = require('http');",
		"const fs = require('fs');",
		'const port = Number(process.argv[1]);',
		'const bootLogPath = process.argv[2];',
		'const reqLogPath = process.argv[3];',
		'fs.appendFileSync(bootLogPath, process.pid + "\\n");',
		'http.createServer((req, res) => {',
		'  let body = "";',
		'  req.on("data", c => { body += c; });',
		'  req.on("end", () => {',
		'    fs.appendFileSync(reqLogPath, req.method + " " + req.url + "\\n");',
		'    res.writeHead(200, { "content-type": "application/json" });',
		'    res.end(JSON.stringify({ method: req.method, path: req.url }));',
		'  });',
		'}).listen(port, "127.0.0.1");',
	].join('\n');

	/**
	 * Binds and accepts, then never answers — so boot succeeds and the request
	 * is what runs out of budget. That makes the per-case clip observable in the
	 * timeout **number** `runHttpCase` reports, which is the only difference
	 * between a clipped and an unclipped request.
	 */
	const NEVER_ANSWERS = [
		"const http = require('http');",
		"const fs = require('fs');",
		'const port = Number(process.argv[1]);',
		'fs.appendFileSync(process.argv[2], process.pid + "\\n");',
		'http.createServer(() => { /* accept, never respond */ }).listen(port, "127.0.0.1");',
	].join('\n');

	/** Never binds anything — writes its own pid to `argv[1]` and hangs. */
	const NEVER_BINDS = [
		"const fs = require('fs');",
		'fs.writeFileSync(process.argv[1], String(process.pid));',
		'setInterval(() => {}, 1000);',
	].join('\n');

	function pkg(over: Partial<PackageSpec> = {}): PackageSpec {
		return {
			name: 'api',
			dir: 'server',
			install: [process.execPath, '-e', 'process.exit(0)'],
			start: [process.execPath, '-e', ECHO_SERVER, '${PORT}', bootLog, reqLog],
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

	async function assertEventuallyDead(pid: number, timeoutMs = 3000): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (isAlive(pid) && Date.now() < deadline) {
			await new Promise(resolve => setTimeout(resolve, 20));
		}
		assert.strictEqual(isAlive(pid), false, `pid ${pid} is still alive after teardown`);
	}

	function bootedPids(): number[] {
		if (!fs.existsSync(bootLog)) { return []; }
		return fs.readFileSync(bootLog, 'utf8').trim().split('\n').filter(Boolean).map(Number);
	}

	function requestLines(): string[] {
		if (!fs.existsSync(reqLog)) { return []; }
		return fs.readFileSync(reqLog, 'utf8').trim().split('\n').filter(Boolean);
	}

	// ── the primary Test First: one boot, N cases ──────────────────────────────

	suite('runHttpCheck — one boot serves every case', () => {
		test('boots exactly once for a 3-case check, all green, and tears the server down', async function () {
			this.timeout(10_000);
			const check = {
				name: 'health',
				cases: [
					{ request: { method: 'GET', path: '/a' }, expect: { status: 200, body: { method: 'GET', path: '/a' } } },
					{ request: { method: 'GET', path: '/b' }, expect: { status: 200, body: { method: 'GET', path: '/b' } } },
					{ request: { method: 'GET', path: '/c' }, expect: { status: 200, body: { method: 'GET', path: '/c' } } },
				],
			};

			const outcome = await runHttpCheck(check, pkg(), runDir, 5000);

			assert.deepStrictEqual(outcome, { name: 'health', passed: true });
			assert.strictEqual(bootedPids().length, 1, 'exactly one process must have been spawned for a 3-case check');
			assert.strictEqual(requestLines().length, 3, 'all 3 cases must have reached the one booted server');

			const [pid] = bootedPids();
			await assertEventuallyDead(pid);
		});

		// The reviewer's M6: replacing `Math.min(clampedPerCase, remaining)` with
		// a bare `clampedPerCase` killed **no** test — the clip was live, reachable
		// and pinned by nothing. It is the last case before a capped deadline that
		// feels it: without the clip that case is handed its own full budget and
		// can overrun the suite's, which fails closed (the next iteration's
		// pre-check catches it) but overruns by up to one per-case budget first.
		test('the last case before the deadline is clipped to what remains, not handed its full budget', async function () {
			this.timeout(20_000);
			// One case, per-case floor 100 ms ⇒ suite budget 100 ms. The clock says
			// 60 ms is already spent when the case is attempted, so 40 ms remain:
			// the clip must hand `runHttpCase` **40**, not 100. The server binds
			// (boot succeeds) and never answers, so the request is what runs out —
			// and T3.2 reports the budget it was given by number, which is the one
			// observable difference between the clipped and unclipped paths.
			const check = {
				name: 'clipped',
				cases: [{ request: { method: 'GET', path: '/slow' }, expect: { status: 200 } }],
			};
			const clockReads = [1000, 1060];
			let read = 0;
			const now = (): number => clockReads[Math.min(read++, clockReads.length - 1)];

			const outcome = await runHttpCheck(
				check, pkg({ start: [process.execPath, '-e', NEVER_ANSWERS, '${PORT}', bootLog] }),
				runDir, 100, {}, now,
			);

			assert.strictEqual(outcome.passed, false);
			assert.match(
				outcome.detail ?? '', /timed out after 40ms/,
				'the request must be clipped to the 40ms that remain, not given its full 100ms budget',
			);
			const [pid] = bootedPids();
			await assertEventuallyDead(pid);
		});

		test('a failing case still leaves the server booted exactly once, and still tears it down', async function () {
			this.timeout(10_000);
			const check = {
				name: 'health',
				cases: [
					{ request: { method: 'GET', path: '/a' }, expect: { status: 200 } },
					{ request: { method: 'GET', path: '/b' }, expect: { status: 404 } }, // wrong on purpose
					{ request: { method: 'GET', path: '/c' }, expect: { status: 200 } },
				],
			};

			const outcome = await runHttpCheck(check, pkg(), runDir, 5000);

			assert.strictEqual(outcome.passed, false);
			assert.match(outcome.detail ?? '', /case 1/);
			assert.strictEqual(bootedPids().length, 1, 'a failing case must not have triggered a second boot');
			// First failure wins: case 2 (`/c`) must never have been requested.
			assert.strictEqual(requestLines().length, 2);

			const [pid] = bootedPids();
			await assertEventuallyDead(pid);
		});
	});

	// ── empty suite: never a silent green ──────────────────────────────────────

	suite('runHttpCheck — empty cases', () => {
		test('a check with no cases fails by name rather than reading as an empty, green suite', async () => {
			const outcome = await runHttpCheck({ name: 'health', cases: [] }, pkg(), runDir, 5000);
			assert.strictEqual(outcome.passed, false);
			assert.match(outcome.detail ?? '', /no cases/);
			assert.strictEqual(bootedPids().length, 0, 'an empty check must never boot a server at all');
		});
	});

	// ── a malformed case still tears the server down ────────────────────────────

	suite('runHttpCheck — teardown on every path', () => {
		test('a case that fails to parse still boots once, fails the check, and stops the server', async function () {
			this.timeout(10_000);
			const check = { name: 'health', cases: [{ request: { method: 'GET', path: 'https://evil.example/x' }, expect: {} }] };

			const outcome = await runHttpCheck(check, pkg(), runDir, 5000);

			assert.strictEqual(outcome.passed, false);
			assert.match(outcome.detail ?? '', /case 0/);
			assert.strictEqual(bootedPids().length, 1);
			const [pid] = bootedPids();
			await assertEventuallyDead(pid);
		});

		test('a server that never becomes ready is reported and leaves no orphan process', async function () {
			this.timeout(10_000);
			const pidFile = path.join(runDir, 'pid.txt');
			const check = { name: 'health', cases: [{ request: { method: 'GET', path: '/a' }, expect: { status: 200 } }] };

			const outcome = await runHttpCheck(
				check, pkg({ start: [process.execPath, '-e', NEVER_BINDS, pidFile] }), runDir, 5000,
				{ bootTimeoutMs: 300 },
			);

			assert.strictEqual(outcome.passed, false);
			assert.match(outcome.detail ?? '', /server never started/);
			const pid = Number(fs.readFileSync(pidFile, 'utf8'));
			await assertEventuallyDead(pid);
		});
	});

	// ── C27(b)(a): timeoutMs is clamped before it reaches AbortSignal.timeout ──

	suite('runHttpCheck — C27(b)(a) timeoutMs clamp', () => {
		test('a negative timeoutMs is clamped to a workable floor, not passed straight to AbortSignal.timeout', async function () {
			this.timeout(10_000);
			// AbortSignal.timeout(-1) throws a RangeError synchronously (measured on
			// this Node) — so an *unclamped* -1 would fail this case every time,
			// regardless of how fast the server answers. A clamp that floors it to
			// something workable lets a fast local server answer well inside budget.
			const check = { name: 'health', cases: [{ request: { method: 'GET', path: '/a' }, expect: { status: 200 } }] };

			const outcome = await runHttpCheck(check, pkg(), runDir, -1);

			assert.deepStrictEqual(outcome, { name: 'health', passed: true });
			const [pid] = bootedPids();
			await assertEventuallyDead(pid);
		});
	});

	// ── C27(b)(b): the request body is capped, symmetrically with the response ──

	suite('runHttpCheck — C27(b)(b) request body cap', () => {
		// Same standard as the NaN guard beside it: the serialisation guard was
		// landed unpinned. A body that cannot be stringified (circular, BigInt)
		// must fail its case by name — an uncaught throw here escapes the
		// `Promise<ProjectCheckOutcome>` contract exactly as T2.8's hostile case
		// data escaped `claimSubmission`.
		test('a body that cannot be serialised is refused, never thrown past the check', async function () {
			this.timeout(20_000);
			const circular: Record<string, unknown> = { name: 'loop' };
			circular.self = circular;
			const check = {
				name: 'unserialisable',
				cases: [{ request: { method: 'POST', path: '/x', body: circular }, expect: { status: 200 } }],
			};

			const outcome = await runHttpCheck(check, pkg(), runDir, 5_000);

			assert.strictEqual(outcome.passed, false);
			assert.match(outcome.detail ?? '', /request body exceeded/);
			const [pid] = bootedPids();
			await assertEventuallyDead(pid);
		});

		// Added by the orchestrator after the wave-3.C review: the `Number.isFinite`
		// guard the review asked for was landed **unpinned** — removing it killed no
		// test, which is the very defect class this plan keeps paying for. `Math.min`
		// and `Math.max` both propagate `NaN`, so an unguarded `NaN` makes
		// `remaining <= 0` false forever and silently disables the suite deadline.
		// The two paths are told apart by *how* the case fails: floored, the request
		// is a real 100 ms timeout; unguarded, `AbortSignal.timeout(NaN)` throws a
		// RangeError that surfaces as `request failed`.
		test('a NaN timeoutMs is floored, not propagated into the deadline arithmetic', async function () {
			this.timeout(20_000);
			const check = {
				name: 'nan-budget',
				cases: [{ request: { method: 'GET', path: '/slow' }, expect: { status: 200 } }],
			};

			const outcome = await runHttpCheck(
				check, pkg({ start: [process.execPath, '-e', NEVER_ANSWERS, '${PORT}', bootLog] }),
				runDir, Number.NaN,
			);

			assert.strictEqual(outcome.passed, false);
			assert.match(outcome.detail ?? '', /timed out/, 'a floored budget produces a real timeout');
			assert.doesNotMatch(
				outcome.detail ?? '', /request failed/,
				'an unfloored NaN reaches AbortSignal.timeout and throws RangeError instead of timing out',
			);
			const [pid] = bootedPids();
			await assertEventuallyDead(pid);
		});

		test('an oversized request body is refused before it is ever sent', async function () {
			this.timeout(10_000);
			const big = 'x'.repeat(MAX_HTTP_BODY_BYTES + 100);
			const check = {
				name: 'health',
				cases: [{ request: { method: 'POST', path: '/a', body: { big } }, expect: { status: 200 } }],
			};

			const outcome = await runHttpCheck(check, pkg(), runDir, 5000);

			assert.strictEqual(outcome.passed, false);
			assert.match(outcome.detail ?? '', /request body exceeded/);
			assert.strictEqual(requestLines().length, 0, 'an oversized body must never have reached the server');

			const [pid] = bootedPids();
			await assertEventuallyDead(pid);
		});
	});

	// ── the suite deadline: a total, not just a per-request clamp ──────────────

	suite('runHttpCheck — suite deadline excludes boot but bounds the total', () => {
		test('a later case is refused by the deadline pre-check, and never reaches the server, once the budget runs out', async function () {
			this.timeout(10_000);
			const check = {
				name: 'health',
				cases: [
					{ request: { method: 'GET', path: '/a' }, expect: { status: 200 } },
					{ request: { method: 'GET', path: '/b' }, expect: { status: 200 } },
				],
			};

			// timeoutMs=100 is already at the floor, so clampedPerCase=100 and the
			// suite budget is suiteTimeout(2, 100) = 200. The fake clock supplies
			// exactly the three reads `runCasesAgainst` makes (arm, case-0
			// pre-check, case-1 pre-check): case 0 has 190ms left (proceeds and
			// succeeds against the real, fast server), case 1 reads the deadline
			// already passed and must be refused *before* any request is sent.
			const clockReads = [1_000, 1_010, 1_250];
			let read = 0;
			const now = (): number => clockReads[Math.min(read++, clockReads.length - 1)];

			const outcome = await runHttpCheck(check, pkg(), runDir, 100, {}, now);

			assert.strictEqual(outcome.passed, false);
			assert.match(outcome.detail ?? '', /case 1: suite timeout/);
			assert.strictEqual(requestLines().length, 1, 'case 1 must never have reached the server');

			const [pid] = bootedPids();
			await assertEventuallyDead(pid);
		});
	});
});
