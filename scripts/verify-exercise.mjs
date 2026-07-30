#!/usr/bin/env node
// Artifact verification CLI — the uniform harness over one vault `.md`.
//
// Two modes over one migrated `.md`:
//   node scripts/verify-exercise.mjs "<file.md>"
//       → run the uniform harness `verifyExercise`; exit 0 green, non-zero with reason.
//   node scripts/verify-exercise.mjs "<file.md>" --expecteds <recomputed.json>
//       → expecteds cross-check: diff the artifact's stored expecteds against an
//         independently recomputed positional array ([...## Tests, ...## Final Tests]
//         order); exit 0 if they agree, non-zero listing each mismatch.
//   node scripts/verify-exercise.mjs "<file.md>" --starter-red
//       → `project`/`service` only: grade `## Files` WITHOUT the `# Solutions`
//         overlays and require at least one red check. Exit 0 = correctly red,
//         1 = the exercise ships pre-solved. `verifyExercise` already refuses a
//         project that is green with *no* overlay at all; this catches the
//         residual case — overlays exist, but the starter passes anyway.
//
// It imports the COMPILED, vscode-free harness from `dist/` and therefore asserts
// the build exists FIRST — unlike the gate, this CLI has no `rm -rf dist && pnpm
// compile` in front of it, so a stale/missing build must fail loud, never silently.
//
// Security: the `.md` path and the `--expecteds` path come from argv (operator
// input), never from artifact content — no path is built from a title. Execution
// of the reference solutions is delegated to `runSuite`, which owns the subprocess
// containment (temp-dir cwd, fixed-literal commands, capped suite timeout).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist', 'src', 'services');
const distHelper = join(dist, 'exercise-verify.helpers.js');

/** Print a message to stderr and exit with `code` (default 1). */
function die(msg, code = 1) {
	console.error(msg);
	process.exit(code);
}

/**
 * First few lines of a check's detail, so one chatty subprocess cannot bury the
 * result. A `build` check's detail is its tool's whole stderr — a misconfigured
 * `tsc` prints its entire help text, which drowned every other check's verdict.
 * The full output stays available by running the check's own argv.
 */
function firstLines(detail, max = 3) {
	const lines = String(detail).split('\n');
	if (lines.length <= max) { return detail; }
	return `${lines.slice(0, max).join('\n  ')}\n  … ${lines.length - max} more line(s) suppressed`;
}

// ── Precondition: the build must exist (no implicit compile) ──────────────────
if (!existsSync(distHelper)) {
	die('verify-exercise: dist/ not built — run `pnpm compile` first.', 2);
}

const { verifyExercise, compareExpecteds } = await import(pathToFileURL(distHelper).href);
const { parseLeetCode } = await import(pathToFileURL(join(dist, 'leetcode-parser.service.js')).href);
const { languagesForType } = await import(
	pathToFileURL(join(dist, 'test-envs', 'env.registry.js')).href);

// ── argv ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let mdPath = null;
let expectedsPath = null;
let starterRed = false;
for (let i = 0; i < args.length; i++) {
	const a = args[i];
	if (a === '--expecteds') { expectedsPath = args[++i]; }
	else if (a === '--starter-red') { starterRed = true; }
	else if (!a.startsWith('--')) { mdPath ??= a; }
}

if (!mdPath) {
	die('usage: verify-exercise <file.md> [--expecteds <recomputed.json>] [--starter-red]', 2);
}
if (!existsSync(mdPath)) { die(`verify-exercise: no such file: ${mdPath}`, 2); }

const md = readFileSync(mdPath, 'utf-8');

// Author-facing parse problems that degraded to a default — an unknown check
// `kind`, a rejected lib, a near-miss key. They were invisible here, which let a
// partially-parsed artifact read as fully verified: the `service` spikes declare
// `http` checks that are DROPPED, so "OK" covered only the checks that survived.
for (const warning of parseLeetCode(md).warnings ?? []) {
	console.error(`WARN ${mdPath}: ${warning}`);
}

// ── Mode: expecteds cross-check ──────────────────────────────────────────────
if (expectedsPath) {
	if (!existsSync(expectedsPath)) { die(`verify-exercise: no such file: ${expectedsPath}`, 2); }
	let recomputed;
	try {
		recomputed = JSON.parse(readFileSync(expectedsPath, 'utf-8'));
	} catch (e) {
		die(`verify-exercise: --expecteds is not valid JSON: ${e.message}`, 2);
	}
	if (!Array.isArray(recomputed)) { die('verify-exercise: --expecteds must be a JSON array', 2); }

	const parsed = parseLeetCode(md);
	const cases = [...parsed.tests, ...parsed.finalTests];
	const mismatches = compareExpecteds(cases, recomputed);
	if (mismatches.length === 0) {
		console.log(`AGREE ${mdPath} (${cases.length} cases)`);
		process.exit(0);
	}
	console.error(`MISMATCH ${mdPath}: ${mismatches.length} case(s) disagree`);
	for (const m of mismatches) {
		console.error(`  [${m.index}] input=${JSON.stringify(m.input)} artifact=${JSON.stringify(m.artifact)} recomputed=${JSON.stringify(m.recomputed)}`);
	}
	process.exit(1);
}

// ── Mode: starter must be red ────────────────────────────────────────────────
if (starterRed) {
	const parsed = parseLeetCode(md);
	if (parsed.test.type !== 'project' && parsed.test.type !== 'service') {
		die(`verify-exercise: --starter-red needs a project/service artifact, got '${parsed.test.type}'`, 2);
	}
	const { runProjectChecks } = await import(
		pathToFileURL(join(dist, 'test-envs', 'project', 'project.runner.js')).href);

	// This mode grades by check **kind**, so it runs whatever machinery exists for
	// the kinds declared — independently of whether the `test.type` has an env.
	// Naming the kinds keeps that explicit: a reserved `service` whose `http`
	// checks were dropped is graded only on the `build` check that survived, and
	// the plain verify mode does not grade its checks at all.
	const outcomes = await runProjectChecks(parsed, { withSolutions: false });
	const kinds = [...new Set((parsed.checks ?? []).map(c => c.kind))]
		.sort((a, b) => a.localeCompare(b)).join(', ');
	const red = outcomes.filter(o => !o.passed);
	if (red.length > 0) {
		console.log(`RED  ${mdPath} — starter fails ${red.length}/${outcomes.length} check(s) [${kinds}], as it must`);
		for (const o of red) { console.log(`  ${o.name}: ${firstLines(o.detail ?? '(no detail)')}`); }
		process.exit(0);
	}
	die(`PRE-SOLVED ${mdPath}: every check passes against the starter [${kinds}] — a solver `
		+ 'would be marked solved without writing anything', 1);
}

// ── Mode: full harness verify ────────────────────────────────────────────────
const result = await verifyExercise(md, mdPath);
if (result.ok) {
	// `ok` for a reserved `test.type` means well-formed, NOT verified green: no env
	// is registered, so this mode ran neither its solutions nor its checks. Say
	// exactly that. "nothing executed" over-claimed — it read as a property of the
	// artifact, when `--starter-red` will happily grade whatever check kinds it
	// declares, reserved type or not.
	const parsedType = parseLeetCode(md).test.type;
	const note = languagesForType(parsedType).length === 0
		? ` (structure only — no environment for test.type '${parsedType}', so this mode ran`
			+ ' neither its solutions nor its checks; --starter-red does grade the checks)'
		: '';
	console.log(`OK   ${mdPath}${note}`);
	process.exit(0);
}
die(`FAIL ${result.reason}`, 1);
