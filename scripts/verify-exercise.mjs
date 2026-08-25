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
//       → `package`/`stack` only (isMultiFile): grade `## Files` WITHOUT the
//         `# Solutions` overlays and require at least one red check. Exit 0 = correctly
//         red, 1 = the exercise ships pre-solved. `verifyExercise` already refuses a
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
// `isMultiFile` lives under `types/`, a sibling of `services/` — `dist` above
// already descends into `services`, so this one otherwise-unused root is
// resolved from `here` directly rather than climbing back out of `dist`.
const { isMultiFile } = await import(
	pathToFileURL(join(here, '..', 'dist', 'src', 'types', 'constants.js')).href);
// The same authority `leetcode-run.handlers.ts` consults before grading a
// directory (VSX-153 / T1.16): did the artifact declare a check kind nothing
// implements (S3)? Reused here rather than reimplemented so the CLI and the
// extension can never disagree about what "gradeable" means.
const { projectGradeRefusal } = await import(
	pathToFileURL(join(here, '..', 'dist', 'src', 'commands', 'leetcode-run.helpers.js')).href);
const { unimplementedCheckKindsFromContent } = await import(
	pathToFileURL(join(dist, 'project-parser.helpers.js')).href);

/**
 * The parenthetical after `OK` explaining what this mode did **not** run.
 *
 * Two different artifacts reach `OK` without being executed, and D13 requires
 * both to say so rather than printing a bare `OK`:
 *
 * - a `function` artifact whose `test.type` has no registered environment —
 *   nothing ran at all;
 * - a `package`/`stack` artifact that declared a check kind nothing
 *   implements. `buildCheck` drops such a check at parse time, so the checks
 *   that *did* run are only the survivors, and a green `OK` on the strength
 *   of a surviving `build` check is exactly the impression S3 exists to
 *   prevent. Verification still reports `ok` (D13: well-formed and executable
 *   are different questions) — it just stops implying the whole artifact was
 *   graded.
 *
 * @param md         - Full `.md` artifact text.
 * @param parsed     - The same artifact, parsed.
 * @param parsedType - Its resolved `test.type`, for the function-shape message.
 * @returns The note to append to `OK`, or `''` when everything declared ran.
 *
 * @example
 * structureOnlyNote(md, parsed, 'call'); // → ''
 */
function structureOnlyNote(md, parsed, parsedType) {
	if (isMultiFile(parsed.leetcodeType)) {
		const dropped = unimplementedCheckKindsFromContent(md);
		return dropped.length === 0
			? ''
			: ` (structure only for kind(s) ${dropped.join(', ')} — no environment implements them,`
				+ ' so those checks were dropped at parse time and never graded)';
	}
	return languagesForType(parsedType, parsed.leetcodeType).length === 0
		? ` (structure only — no environment for test.type '${parsedType}', so this mode ran`
			+ ' neither its solutions nor its checks; --starter-red does grade the checks)'
		: '';
}

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

// ── P6: a `stack` is not swept by default ────────────────────────────────────
//
// T3.5 made `kind: http` dispatchable, which changed what a sweep *does* to the
// four vault artifacts that declare one: they stop being refused by name and
// start installing ecosystems and booting real servers. A gate that goes from
// seconds to minutes and needs a network is a gate that stops being run — the
// same reasoning that already makes the render E2E tests opt-in. Exit **0**, so
// a skip is not a failure, and say so on stdout so a sweep's log shows which
// artifacts went unexamined rather than silently counting them as green.
//
// Scoped to `stack` deliberately, per the plan's §J: a `package` declaring an
// `http` check boots one small server and stays in the default sweep, which is
// what keeps the T3.6 smoke artifact and T3.7's `inventory-api.md` honest.
if (parseLeetCode(md).leetcodeType === 'stack' && process.env.LEET_STACK_E2E !== '1') {
	console.log(`SKIP ${mdPath} — stack, LEET_STACK_E2E not set`);
	process.exit(0);
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
	// Shape-driven (`isMultiFile`/`leetcodeType`), not `test.type === 'project'
	// || 'service'`: the wave-1.E migration deletes the `type:` line from a
	// check-graded artifact's `test:` block (D14), so a migrated artifact's
	// `test.type` no longer names either legacy shape — the old string
	// comparison would refuse every artifact the migration just wrote.
	if (!isMultiFile(parsed.leetcodeType)) {
		die(`verify-exercise: --starter-red needs a package/stack artifact, got leetcodeType '${parsed.leetcodeType}'`, 2);
	}
	// Same authority the run handlers' project dispatch consults (VSX-153 /
	// T1.16): `isMultiFile` alone would grade any multi-file artifact
	// unconditionally, so this asks whether the artifact declares a check kind
	// nothing implements (S3) before writing or running anything.
	const refusal = projectGradeRefusal(md, parsed);
	if (refusal) { die(`verify-exercise: ${refusal}`, 2); }

	const { runProjectChecks, runProgramArtifact } = await import(
		pathToFileURL(join(dist, 'test-envs', 'project', 'project.runner.js')).href);
	const { isProgramSuite } = await import(
		pathToFileURL(join(dist, 'test-envs', 'program', 'program.runner.js')).href);

	// A `program` suite is graded by **cases**, not checks. Without this fork it
	// fell into the check path, found an empty check list, and reported
	// `PRE-SOLVED … every check passes` — a confident wrong answer about an
	// artifact that declares no checks at all.
	if (isProgramSuite(parsed)) {
		const results = await runProgramArtifact(parsed, { withSolutions: false });
		const failed = results.filter(r => !r.passed);
		if (failed.length > 0) {
			console.log(`RED  ${mdPath} — starter fails ${failed.length}/${results.length} case(s), as it must`);
			for (const r of failed) {
				const detail = r.error ?? `got ${r.actual}`;
				console.log(`  case ${r.index}: ${firstLines(detail)}`);
			}
			process.exit(0);
		}
		die(`PRE-SOLVED ${mdPath}: every case passes against the starter — a solver `
			+ 'would be marked solved without writing anything', 1);
	}

	// This mode grades by check **kind**, so it runs whatever machinery exists for
	// the kinds declared — independently of whether the `test.type` has an env.
	// The `projectGradeRefusal` call above already refused an artifact declaring
	// an unimplemented kind (e.g. `http`) outright, so every check reaching this
	// line is one an environment actually dispatches — no survivor-only grading.
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
	// `ok` here means well-formed, NOT verified green. Which parts went ungraded
	// differs by shape, so `structureOnlyNote` owns that decision — see its
	// docblock, which is the authority. "nothing executed" over-claimed: it read
	// as a property of the artifact, when `--starter-red` will happily grade
	// whatever check kinds it declares.
	const reparsed = parseLeetCode(md);
	const parsedType = reparsed.test.type;
	console.log(`OK   ${mdPath}${structureOnlyNote(md, reparsed, parsedType)}`);
	process.exit(0);
}
die(`FAIL ${result.reason}`, 1);
