#!/usr/bin/env node
// Artifact verification CLI — the uniform harness over one vault `.md`.
//
// Two modes over one migrated `.md`:
//   node scripts/verify-exercise.mjs "<file.md>"
//       → run the uniform harness `verifyExercise`; exit 0 green, non-zero with reason.
//   node scripts/verify-exercise.mjs "<file.md>" --expecteds <recomputed.json>
//       → §D.7 cross-check: diff the artifact's stored expecteds against an
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

// ── Mode: §D.7 expecteds cross-check ─────────────────────────────────────────
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

	const outcomes = await runProjectChecks(parsed, { withSolutions: false });
	const red = outcomes.filter(o => !o.passed);
	if (red.length > 0) {
		console.log(`RED  ${mdPath} — starter fails ${red.length}/${outcomes.length} check(s), as it must`);
		for (const o of red) { console.log(`  ${o.name}: ${o.detail ?? '(no detail)'}`); }
		process.exit(0);
	}
	die(`PRE-SOLVED ${mdPath}: every check passes against the starter — a solver `
		+ 'would be marked solved without writing anything', 1);
}

// ── Mode: full harness verify ────────────────────────────────────────────────
const result = await verifyExercise(md, mdPath);
if (result.ok) {
	// `ok` for a reserved `test.type` means well-formed, NOT executed — no env is
	// registered for it, so no check and no solution was ever run. Printing a bare
	// `OK` there reads as "verified green" and over-claims.
	const type = parseLeetCode(md).test.type;
	const note = languagesForType(type).length === 0
		? ` (structure only — reserved test.type '${type}', nothing executed)`
		: '';
	console.log(`OK   ${mdPath}${note}`);
	process.exit(0);
}
die(`FAIL ${result.reason}`, 1);
