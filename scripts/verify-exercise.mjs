#!/usr/bin/env node
// CoderByte-migration verification CLI (plan §D, T0.2).
//
// Two modes over one migrated `.md`:
//   node scripts/verify-exercise.mjs "<file.md>"
//       → run the uniform harness `verifyExercise`; exit 0 green, non-zero with reason.
//   node scripts/verify-exercise.mjs "<file.md>" --expecteds <recomputed.json>
//       → §D.7 cross-check: diff the artifact's stored expecteds against an
//         independently recomputed positional array ([...## Tests, ...## Final Tests]
//         order); exit 0 if they agree, non-zero listing each mismatch.
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

// ── argv ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let mdPath = null;
let expectedsPath = null;
for (let i = 0; i < args.length; i++) {
	const a = args[i];
	if (a === '--expecteds') { expectedsPath = args[++i]; }
	else if (!a.startsWith('--')) { mdPath ??= a; }
}

if (!mdPath) { die('usage: verify-exercise <file.md> [--expecteds <recomputed.json>]', 2); }
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

// ── Mode: full harness verify ────────────────────────────────────────────────
const result = await verifyExercise(md, mdPath);
if (result.ok) {
	console.log(`OK   ${mdPath}`);
	process.exit(0);
}
die(`FAIL ${result.reason}`, 1);
