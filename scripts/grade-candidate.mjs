#!/usr/bin/env node
// Arbitrary-candidate grader (eval-fixes TA.1, gap G3) — the sibling of
// `verify-exercise.mjs`. Where that CLI grades an artifact's OWN reference
// solutions, this one grades an EXTERNAL candidate file against the artifact's
// public + hidden final suite:
//
//   node scripts/grade-candidate.mjs "<file.md>" <language> <candidate-file>
//
// Exit codes: 0 solved · 1 not solved · 2 bad input · 3 no environment
// (reserved `test.type`, unknown language, or the runtime is not installed).
//
// It imports the COMPILED, vscode-free services from `dist/` and therefore
// asserts the build exists FIRST — a stale/missing build must fail loud.
//
// Blind-solve integrity: a failing **final** case reports only `hidden`, never
// its input or expected value, so an operator iterating against this CLI cannot
// reverse-engineer the hidden grading suite from its output.
//
// Security: the `.md` path, the language and the candidate path all come from
// argv (operator input) — no path is ever built from artifact content. The
// candidate reaches the child process as FILE CONTENTS written into a temp dir
// by `runSuite`, never as part of a command string; `runSuite` owns the
// subprocess containment (temp-dir cwd, fixed-literal commands, capped timeout).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist', 'src');
const distRunner = join(dist, 'services', 'leetcode-runner.service.js');

/** Print a message to stderr and exit with `code` (default 1). */
function die(msg, code = 1) {
	console.error(msg);
	process.exit(code);
}

/** Import a compiled module from `dist/src/<rel>`. */
function load(rel) {
	return import(pathToFileURL(join(dist, rel)).href);
}

// ── Precondition: the build must exist (no implicit compile) ──────────────────
if (!existsSync(distRunner)) {
	die('grade-candidate: dist/ not built — run `pnpm compile` first.', 2);
}

const { detectRuntime, runSuite } = await load('services/leetcode-runner.service.js');
const { parseLeetCode } = await load('services/leetcode-parser.service.js');
const { buildExecutable } = await load('services/leetcode-candidate.helpers.js');
const { publicCount, submitSuite, tagSuiteKinds } = await load('services/leetcode-suite.helpers.js');
const { testEnvFor } = await load('services/test-envs/env.registry.js');
const { LANGUAGES } = await load('types/languages.js');

// ── argv (operator input only) ───────────────────────────────────────────────
const [mdPath, language, candidatePath] = process.argv.slice(2);

if (!mdPath || !language || !candidatePath) {
	die('usage: grade-candidate <file.md> <language> <candidate-file>', 2);
}
if (!existsSync(mdPath)) { die(`grade-candidate: no such file: ${mdPath}`, 2); }
if (!existsSync(candidatePath)) { die(`grade-candidate: no such candidate: ${candidatePath}`, 2); }

const parsed = parseLeetCode(readFileSync(mdPath, 'utf-8'));

// ── Environment gate (exit 3 — distinct from a wrong answer) ─────────────────
const env = testEnvFor(parsed.test.type, language);
if (!env) {
	die(`grade-candidate: no environment for test.type '${parsed.test.type}' in '${language}'`, 3);
}

const detectCmd = LANGUAGES[language]?.detectCmd;
if (!detectCmd || !await detectRuntime(detectCmd)) {
	die(`grade-candidate: ${language} runtime not available (\`${detectCmd ?? '?'}\` failed)`, 3);
}
if (env.detect && !await env.detect()) {
	die(`grade-candidate: ${language} runtime does not meet ${env.requires ?? 'this env\'s requirements'}`, 3);
}

// ── Grade: public + final, one suite ─────────────────────────────────────────
const suite = submitSuite(parsed);
const candidate = buildExecutable(parsed, language, readFileSync(candidatePath, 'utf-8'));
const results = tagSuiteKinds(await runSuite(candidate, suite, parsed, env), publicCount(parsed));

for (const r of results) {
	const verdict = r.passed ? 'PASS' : 'FAIL';
	const detail = r.passed ? '' : ` — ${detailFor(r)}`;
	console.log(`[${r.index}] ${r.kind.padEnd(6)} ${verdict}${detail}`);
}

/** Failure detail for one case — masked for a `final` case (blind-solve integrity). */
function detailFor(r) {
	if (r.kind === 'final') { return r.error ? 'hidden (error)' : 'hidden'; }
	return r.error ?? `expected ${JSON.stringify(r.expected)}, got ${r.actual}`;
}

const passedIn = kind => results.filter(r => r.kind === kind && r.passed).length;
const totalIn = kind => results.filter(r => r.kind === kind).length;
const solved = results.length > 0 && results.every(r => r.passed);

console.log(`VERDICT ${JSON.stringify({
	file: mdPath,
	language,
	solved,
	public: `${passedIn('public')}/${totalIn('public')}`,
	final: `${passedIn('final')}/${totalIn('final')}`,
})}`);

process.exit(solved ? 0 : 1);
