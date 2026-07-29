import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { BuildCheck, ProjectCheckOutcome } from '../../../types/leetcode.types.js';
import { resolveContained } from './files.writer.js';

const execFileAsync = promisify(execFile);

/** Per-build budget. A type-check is slower than a test case but must not hang a run. */
const BUILD_TIMEOUT_MS = 120_000;

/** Trim a child's output to something a results table can show. */
const MAX_DETAIL = 2_000;

/**
 * Run a `build` check: the declared argv must exit 0.
 *
 * Two untrusted inputs, both bounded here. The **argv is an array** passed
 * straight to `execFile`, so no shell parses it and metacharacters inside an
 * argument stay inert data. The optional **`dir` is containment-asserted before
 * anything is spawned** — a `..` never becomes a working directory, and the
 * failure is a red check with a readable reason rather than an exception.
 *
 * A missing binary, a non-zero exit and a timeout are all the same kind of
 * answer — the check failed — so none of them escape as a throw.
 *
 * The child's `PATH` is the caller's own `PATH` with `runDir`'s
 * `node_modules/.bin` **prepended** (see `modules.linker.ts`), so a bare
 * `argv: ['tsc']` resolves the run's own linked toolchain first without
 * losing anything already on `PATH`.
 *
 * @param check  - The declared build check.
 * @param runDir - Absolute run directory; `check.dir` resolves inside it.
 * @returns Pass/fail plus the child's output on failure.
 *
 * @example
 * await runBuildCheck({ name: 'app builds', kind: 'build', argv: ['npx', 'tsc', '--noEmit'], cases: [] }, '/tmp/run');
 * // → { name: 'app builds', passed: true }
 */
export async function runBuildCheck(check: BuildCheck, runDir: string): Promise<ProjectCheckOutcome> {
	const [command, ...args] = check.argv;
	if (!command) {
		return { name: check.name, passed: false, detail: 'build check declares an empty argv' };
	}

	let cwd = runDir;
	if (check.dir !== undefined) {
		try {
			cwd = resolveContained(runDir, check.dir);
		} catch (e) {
			return { name: check.name, passed: false, detail: e instanceof Error ? e.message : String(e) };
		}
	}

	// ponytail: POSIX-only. libuv resolves PATH from the child's own environ
	// before execvp, so prepending here reaches `execFile`'s lookup. On Windows,
	// `process.env` is case-insensitive for property access but the object
	// spread below produces a plain case-sensitive object, so the child would
	// receive both the original `Path` and this prepended `PATH` as two distinct
	// keys — which spelling wins is unspecified there. `.bin` entries are also
	// `.cmd` shims `execFile` cannot run without a shell, so Windows coverage is
	// unproven either way. No `shell: true` to compensate; that would hand
	// artifact-authored argv to a command interpreter.
	const binDir = path.join(runDir, 'node_modules', '.bin');
	const env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}` };

	try {
		const { stdout } = await execFileAsync(command, args, { cwd, env, timeout: BUILD_TIMEOUT_MS });
		return { name: check.name, passed: true, detail: truncate(stdout) };
	} catch (e) {
		return { name: check.name, passed: false, detail: truncate(failureText(e)) };
	}
}

/** Prefer a failed child's own output over the wrapper's "Command failed" line. */
function failureText(error: unknown): string {
	if (typeof error === 'object' && error !== null) {
		const { stderr, stdout } = error as { stderr?: string; stdout?: string };
		const output = `${stderr ?? ''}${stdout ?? ''}`.trim();
		if (output !== '') { return output; }
	}
	return error instanceof Error ? error.message : String(error);
}

/** Keep a results table readable — a compiler can print megabytes. */
function truncate(text: string): string | undefined {
	const trimmed = text.trim();
	if (trimmed === '') { return undefined; }
	return trimmed.length > MAX_DETAIL ? `${trimmed.slice(0, MAX_DETAIL)}…` : trimmed;
}
