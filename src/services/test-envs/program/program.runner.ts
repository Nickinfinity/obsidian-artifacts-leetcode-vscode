import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { COMPILE_TIMEOUT_MS, PROGRAM_SPAWN_OVERHEAD_MS } from '../../../types/constants.js';
import { isLangId, type LangId } from '../../../types/languages.js';
import type { ParsedLeetCode, TestCase, TestResult } from '../../../types/leetcode.types.js';
import { resolveLangId } from '../../language-map.service.js';
import { collectResults, errorResult } from '../../leetcode-runner.helpers.js';
import type { ProgramConfig } from '../../program-config.helpers.js';
import type { CaseOutcome } from '../env.types.js';
import { serializeProgramInput } from './input-channel.js';
import { programSuiteTimeout, type ProgramEnv, type ProgramPlan } from './make-program-env.js';
import { LEET_OUT_ENV_VAR, mintOutChannelPath, readOutChannel } from './out-channel.js';

/**
 * The `program` test type's suite runner: **one process per case** (P5).
 *
 * `runSuite` cannot serve this shape. It runs one child for the whole suite
 * and recovers outcomes from `__LEET__` sentinel lines, which works only
 * because a `call` suite's cases differ solely in their arguments *inside* one
 * program. Here argv and stdin differ per case, so each case **is** an
 * invocation, and the graded value is read back from the out-of-band
 * `$LEET_OUT` file rather than parsed out of stdout (D6) — which is what
 * leaves the solver's own `print`/`console.log` completely free.
 *
 * What is shared with `runSuite` rather than re-implemented: the build runs
 * **once** for the whole suite under `COMPILE_TIMEOUT_MS` (P1), and per-case
 * outcomes are mapped to results by `collectResults`, so a `program` result
 * and a `call` result are the same shape and compare the same canonical way.
 */

/**
 * Is this artifact graded as a `program` **suite** rather than by declared
 * checks?
 *
 * The artifact answers it, not a label: a `program:` block and **no**
 * `checks:`. The two are mutually exclusive by the D14 mirror rule, so no
 * artifact can claim both paths. Every caller that forks between the two —
 * the run handlers, the verifier, `--starter-red` — asks here, so the fork
 * cannot be spelled three subtly different ways.
 *
 * @param parsed - The parsed artifact.
 * @returns True when the program suite path applies.
 *
 * @example
 * isProgramSuite(parsed); // → true for a `package` declaring `program:` and no checks
 */
export function isProgramSuite(parsed: ParsedLeetCode): boolean {
	return parsed.program !== undefined && (parsed.checks ?? []).length === 0;
}

/**
 * The language a `program` artifact runs in: the first file its `## Files`
 * tree declares.
 *
 * A `program` package builds and runs **one** entry point, so unlike a
 * check-graded tree — where each check names its own file and language — there
 * is a single answer, and the tree's own first declaration is it.
 *
 * @param parsed - The parsed artifact.
 * @returns The canonical language, or `undefined` when it names none runnable.
 *
 * @example
 * programLanguageOf(parsed); // → 'java'
 */
export function programLanguageOf(parsed: ParsedLeetCode): LangId | undefined {
	const langId = resolveLangId(parsed.files?.[0]?.language ?? '');
	return isLangId(langId) ? langId : undefined;
}

/** Everything one `program` suite needs. Assembled by the caller, never parsed here. */
export interface ProgramRunRequest {
	/** Candidate source, written verbatim at the plan's entry path. */
	readonly code: string;
	/** The suite to run, in order. */
	readonly tests: TestCase[];
	/** Parsed artifact — supplies `params` order and `test.timeoutMs`. */
	readonly parsed: ParsedLeetCode;
	/** The language's env, from `makeProgramEnv`. */
	readonly env: ProgramEnv;
	/** The artifact's `program:` block — channel, entry, flags. */
	readonly program: ProgramConfig;
	/**
	 * Directory the suite runs in. Minted by the caller (`mkdtemp`, or the
	 * solver's live attempt tree) and **never** derived from artifact text;
	 * `emit` containment-checks the declared entry against exactly this path.
	 */
	readonly runDir: string;
	/** Resolved library cache directory, when the artifact declares `libs:`. */
	readonly libDir?: string;
}

/**
 * Run a whole `program` suite and map it to per-case results.
 *
 * Failure modes, all producing a full-length result array — a suite must never
 * come back shorter than the cases it was given:
 *
 * - **Build failure** — every case carries the same `compilation error: …`.
 * - **Per-case timeout / crash** — that case fails and the suite continues.
 *   This is the difference P5 turns on: one slow case must not spend a budget
 *   the cases after it still need.
 * - **No `$LEET_OUT`** — a failed case with a named reason, never an empty and
 *   therefore green one (the same rule the sentinel protocol enforces).
 *
 * @param request - The suite, the environment, and the directory to run in.
 * @returns One `TestResult` per case, in the input order.
 *
 * @example
 * await runProgramSuite({ code, tests, parsed, env, program, runDir });
 */
export async function runProgramSuite(request: ProgramRunRequest): Promise<TestResult[]> {
	const { code, tests, parsed, env, program, runDir, libDir } = request;
	if (tests.length === 0) { return []; }

	const plan = env.emit({ parsed, code, program, ...(libDir === undefined ? {} : { libDir }) }, runDir);
	await writePlanFiles(plan, runDir);

	const childEnv = { ...process.env, ...plan.env };
	if (plan.pathPrepend !== undefined) {
		childEnv.PATH = `${plan.pathPrepend}${path.delimiter}${process.env.PATH ?? ''}`;
	}

	if (plan.build) {
		const failure = await runBuild(plan.build, runDir, childEnv);
		if (failure !== null) { return tests.map((t, i) => errorResult(i, t, failure)); }
	}

	// Two budgets, and both are load-bearing. Each case is killed on its **own**
	// clock (`timeoutMs + PROGRAM_SPAWN_OVERHEAD_MS`), so one slow case cannot
	// spend the allowance of the cases after it — that is P5's whole point. On
	// top of that the *suite* has a wall-clock ceiling, because per-case budgets
	// alone bound nothing in total: 40 cases × 7 s is nearly five minutes with
	// no deadline at all. `programSuiteTimeout` computes it, the format spec
	// promises it ("capped at 180 s"), and until now nothing enforced it.
	const deadline = Date.now() + programSuiteTimeout(tests.length, parsed.test.timeoutMs);

	const outcomes: CaseOutcome[] = [];
	for (const [index, testCase] of tests.entries()) {
		// Reachable only once the 180 s cap actually binds — i.e.
		// `cases × (timeoutMs + PROGRAM_SPAWN_OVERHEAD_MS) > MAX_PROGRAM_SUITE_TIMEOUT_MS`
		// (100 cases × 5 s, say). Below the cap the per-case budgets sum to
		// exactly the deadline, so the clip below always leaves headroom and
		// this never trips — measured. It is **not** a general per-loop guard,
		// and reading it as one is the mistake this comment exists to prevent.
		// Cases that cannot run are reported by name rather than dropped: a
		// suite must never come back shorter than its cases, and `collectResults`
		// maps this to `passed: false`, so it fails closed.
		if (Date.now() >= deadline || remainingFor(deadline) < PROGRAM_SPAWN_OVERHEAD_MS) {
			outcomes.push({ index, ms: 0, error: 'suite timeout — the whole program suite exceeded its budget' });
			continue;
		}
		outcomes.push(await runOneCase(plan, testCase, index, { parsed, runDir, childEnv, deadline }));
	}
	return collectResults(tests, outcomes, null);
}

// ── Internals ─────────────────────────────────────────────────────────────────

/** Milliseconds left before the suite's wall-clock deadline; never negative. */
function remainingFor(deadline: number): number {
	return Math.max(0, deadline - Date.now());
}

/**
 * Write the plan's files under the run directory.
 *
 * `plan.files[].name` is the entry path **as the artifact declared it**, so it
 * may be nested — the join below is against the very `runDir` that `emit`
 * containment-checked it against, which is the condition that makes reusing
 * the raw name safe. Passing a different directory here than the one given to
 * `emit` would void that check.
 *
 * @param plan   - The emitted plan.
 * @param runDir - The directory `emit` was given.
 */
async function writePlanFiles(plan: ProgramPlan, runDir: string): Promise<void> {
	await Promise.all(plan.files.map(async file => {
		const target = path.join(runDir, file.name);
		await fs.mkdir(path.dirname(target), { recursive: true });
		await fs.writeFile(target, file.content, 'utf-8');
	}));
}

/**
 * Run the build once, under its own budget (P1).
 *
 * @param build    - Build argv from the plan.
 * @param cwd      - The run directory.
 * @param childEnv - Environment for the child.
 * @returns `null` on success, else the message every case will carry.
 */
async function runBuild(
	build: readonly string[], cwd: string, childEnv: NodeJS.ProcessEnv,
): Promise<string | null> {
	const [command, ...args] = build;
	const outcome = await spawn(command, args, { cwd, env: childEnv, timeoutMs: COMPILE_TIMEOUT_MS });
	if (outcome.ok) { return null; }
	return outcome.timedOut
		? 'compilation timed out'
		: `compilation error: ${outcome.message}`;
}

/** Everything a single case's invocation needs beyond the plan. */
interface CaseContext {
	parsed: ParsedLeetCode;
	runDir: string;
	childEnv: NodeJS.ProcessEnv;
	/** Wall-clock instant the whole suite must stop by (`programSuiteTimeout`). */
	deadline: number;
}

/**
 * Run one case in its own process and read its `$LEET_OUT` back.
 *
 * The budget is `test.timeoutMs + PROGRAM_SPAWN_OVERHEAD_MS` **per case**, not
 * one alarm across the loop: a process start is machinery the solver does not
 * control, and one slow case must not consume the allowance of the cases after
 * it (C23(b)).
 *
 * @param plan      - The suite-invariant plan.
 * @param testCase  - The case to run.
 * @param index     - Its position in the suite.
 * @param ctx       - Parsed artifact, run directory and child environment.
 * @returns The case's outcome.
 */
async function runOneCase(
	plan: ProgramPlan, testCase: TestCase, index: number, ctx: CaseContext,
): Promise<CaseOutcome> {
	// Serialisation **refuses** hostile case data by throwing — a NUL byte on
	// argv is the case `input-channel.ts` names. Caught here, at the one place
	// every caller funnels through, so it becomes that single case's failure
	// rather than an exception escaping into whatever called the suite. It had
	// escaped: the panel's `void routeMessage(...)` has no catch, so a Submit
	// threw *after* claiming the session and left every later Submit returning
	// silently — a run unrecoverable without reloading the window.
	let input;
	try {
		input = serializeProgramInput(
			plan.channel,
			ctx.parsed.params.map(p => p.name),
			plan.flags,
			testCase.input,
		);
	} catch (e) {
		return { index, ms: 0, error: e instanceof Error ? e.message : String(e) };
	}

	const outPath = mintOutChannelPath(ctx.runDir, index);
	// **Delete any previous answer before the program runs.** The path is
	// deterministic per (runDir, index), and the live solve flow reuses one
	// attempt directory across Run Tests and Submit — so without this a case
	// that wrote `3` on an earlier run is still on disk when a later, broken
	// program writes nothing, and the stale file grades **green**. Measured:
	// pass 1 with working code and pass 2 with `console.log("I compute
	// nothing")` both reported `true "3"`. It also removes the other half of
	// the same hole: the attempt tree is open in the solver's editor, so a file
	// they create by hand is otherwise indistinguishable from one their program
	// wrote. "A program that writes no file fails" is only true if nothing
	// else can have left one there.
	await fs.rm(outPath, { force: true });

	const [command, ...baseArgs] = plan.run;
	const args = 'argv' in input ? [...baseArgs, ...input.argv] : [...baseArgs];

	const started = Date.now();
	const outcome = await spawn(command, args, {
		cwd: ctx.runDir,
		env: { ...ctx.childEnv, [LEET_OUT_ENV_VAR]: outPath },
		// The case's own budget, clipped so it can never run past the suite's
		// deadline — the per-case clock is what stops one slow case starving
		// the next, and the clip is what bounds the suite as a whole.
		// Clipped to what the suite has left. Floored at the spawn allowance
		// rather than at 1 ms: a child given 1 ms is killed before it can do
		// anything and would be labelled `timeout`, blaming the solver's code
		// for the *suite* running out of budget. A case with less than one
		// process start left is refused above instead, by name.
		timeoutMs: Math.min(
			ctx.parsed.test.timeoutMs + PROGRAM_SPAWN_OVERHEAD_MS,
			Math.max(PROGRAM_SPAWN_OVERHEAD_MS, ctx.deadline - Date.now()),
		),
		...('stdin' in input ? { stdin: input.stdin } : {}),
	});
	const ms = Date.now() - started;

	// A timeout is reported as such rather than as "no $LEET_OUT file": both
	// leave no file behind, and the solver needs to know which happened.
	if (!outcome.ok && outcome.timedOut) {
		return { index, ms, error: 'timeout' };
	}
	// A crash still reads the file back first — a program that wrote its answer
	// and *then* threw on the way out has produced a gradeable value, and the
	// exit status alone would throw it away.
	const read = await readOutChannel(outPath, index, ms);
	if (read.error !== undefined && !outcome.ok) {
		return { index, ms, error: outcome.message || read.error };
	}
	return read;
}

/** What a finished child tells the caller. */
type SpawnOutcome =
	| { ok: true }
	| { ok: false; timedOut: boolean; message: string };

/**
 * Run one child process with an argv **array** — never a command string, and
 * never `shell: true`. Case data reaches the child as argv elements, stdin
 * bytes and one environment variable; nothing is ever interpolated into a
 * command line for a shell to re-parse.
 *
 * @param command  - Executable name, owned by the env's runner selection.
 * @param args     - Argv elements: the plan's own, then the case's.
 * @param opts     - Working directory, environment, budget, optional stdin.
 * @returns Whether the child succeeded, and why not when it did not.
 */
function spawn(
	command: string,
	args: readonly string[],
	opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; stdin?: string },
): Promise<SpawnOutcome> {
	return new Promise<SpawnOutcome>(resolve => {
		const child = execFile(
			command, [...args],
			{ cwd: opts.cwd, env: opts.env, timeout: opts.timeoutMs, maxBuffer: 1024 * 1024 },
			(err, _stdout, stderr) => {
				if (!err) { resolve({ ok: true }); return; }
				const timedOut = err.killed === true || err.signal === 'SIGTERM';
				resolve({ ok: false, timedOut, message: (stderr || err.message || '').trim() });
			},
		);
		if (opts.stdin !== undefined) { child.stdin?.end(opts.stdin); }
	});
}
