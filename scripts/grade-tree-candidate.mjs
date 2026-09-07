#!/usr/bin/env node
// Arbitrary-candidate-TREE grader — the multi-file sibling of
// `grade-candidate.mjs`. Where that CLI grades an external candidate BUFFER
// against a `function` artifact's suite, this one grades an external
// candidate DIRECTORY against a `package`/`stack` artifact's declared
// `checks:`:
//
//   node scripts/grade-tree-candidate.mjs "<file.md>" <candidate-dir>
//
// Exit codes: 0 solved (every check passed) · 1 not solved · 2 bad input
// (missing dist/, missing paths, a candidate path that escapes the run
// directory, or the artifact is not multi-file per `isMultiFile`) · 3 no
// environment (no `checks:` declared, or `projectGradeRefusal` refuses the
// artifact for an unimplemented check kind).
//
// It imports the COMPILED, vscode-free services from `dist/` and therefore
// asserts the build exists FIRST — a stale/missing build must fail loud.
//
// Grading itself is never reimplemented: the starter tree is materialised by
// the same `writeProjectFiles` the extension uses, and graded by the same
// `gradeProjectDir` — never `runProjectChecks`, which materialises its own
// tree and would discard the candidate entirely.
//
// Blind-solve integrity: a failing check's `detail` naming a **final** case
// (`case <N>: …` where `N` is past the check's `publicCount`) reports only
// `hidden`, never its input or expected value, so an operator iterating
// against this CLI cannot reverse-engineer the hidden grading suite from its
// output. A detail naming no case (a server that never started, a missing
// file) is a structural/infrastructure reason, not a case result, and passes
// through verbatim — as does every `build` detail, which is raw child output
// that can carry `case N:` as ordinary source text while never holding a case.
//
// Security: the `.md` path and the candidate directory both come from argv
// (operator input). Every path that reaches the filesystem — the artifact's
// own `## Files` entries and every candidate file's path alike — is resolved
// through `resolveContained` before any write, so neither an artifact-declared
// path nor a candidate path can escape the run directory or write through a
// linked `node_modules` into the shared package cache. A candidate path
// landing on a `role: readonly` file the artifact declares is refused outright
// rather than silently skipped or overwritten — see `overlayCandidateDir`.
// Candidate files reach the graded process as file contents, never as part of
// a command string — `gradeProjectDir` owns that containment exactly as it
// does for an artifact's own tree.

import { existsSync, readFileSync, statSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { dirname, join } = path;

const here = dirname(fileURLToPath(import.meta.url));
const distSrc = join(here, '..', 'dist', 'src');
const distRunner = join(distSrc, 'services', 'test-envs', 'project', 'project.runner.js');

/** Print a message to stderr and exit with `code` (default 1). */
function die(msg, code = 1) {
	console.error(msg);
	process.exit(code);
}

/** Import a compiled module from `dist/src/<rel>`. */
function load(rel) {
	return import(pathToFileURL(join(distSrc, rel)).href);
}

// ── Precondition: the build must exist (no implicit compile) ──────────────────
if (!existsSync(distRunner)) {
	die('grade-tree-candidate: dist/ not built — run `pnpm compile` first.', 2);
}

const { parseLeetCode } = await load('services/leetcode-parser.service.js');
const { writeProjectFiles, resolveContained } = await load('services/test-envs/project/files.writer.js');
const { gradeProjectDir } = await load('services/test-envs/project/project.runner.js');
const { isMultiFile } = await load('types/constants.js');
const { projectGradeRefusal } = await load('commands/leetcode-run.helpers.js');
// A `stack` grading run boots real server process groups; without this, a
// Ctrl-C landing between a boot's `spawn` and its own `finally` orphans a
// detached, still-listening process — the same backstop `verify-exercise.mjs`
// arms for its own `--starter-red`/full-harness modes over the same machinery.
const { createGroupRegistry, installSignalTeardown } = await load('services/test-envs/http/server.lifecycle.js');

// ── argv (operator input only) ───────────────────────────────────────────────
const [mdPath, candidateDir] = process.argv.slice(2);

if (!mdPath || !candidateDir) {
	die('usage: grade-tree-candidate <file.md> <candidate-dir>', 2);
}
if (!existsSync(mdPath)) { die(`grade-tree-candidate: no such file: ${mdPath}`, 2); }
if (!existsSync(candidateDir) || !statSync(candidateDir).isDirectory()) {
	die(`grade-tree-candidate: no such candidate directory: ${candidateDir}`, 2);
}

const rawContent = readFileSync(mdPath, 'utf-8');
const parsed = parseLeetCode(rawContent);

// ── Shape gate (exit 2) — this harness grades a TREE, not a buffer ──────────
if (!isMultiFile(parsed.leetcodeType)) {
	die(
		`grade-tree-candidate: '${mdPath}' is leetcodeType '${parsed.leetcodeType ?? 'function'}', `
			+ 'not package/stack — use grade-candidate.mjs for a single-buffer exercise',
		2,
	);
}

// ── Environment gate (exit 3 — distinct from a wrong answer) ────────────────
const checks = parsed.checks ?? [];
if (checks.length === 0) {
	die('grade-tree-candidate: artifact declares no checks: — nothing to grade', 3);
}
const refusal = projectGradeRefusal(rawContent, parsed);
if (refusal) { die(`grade-tree-candidate: ${refusal}`, 3); }

// `role: readonly` starter files are part of what grades the candidate (a
// `build` check's own `tsconfig.json`, a pytest spec file, `hello-stack.md`'s
// `web/server.js` relay) — a candidate overlaying one of these paths is
// refused in `overlayCandidateDir` below, never silently skipped or written.
const readonlyPaths = new Set((parsed.files ?? []).filter((f) => f.role === 'readonly').map((f) => f.path));

/**
 * List every regular file under `dir`, recursively, as slash-joined paths
 * relative to `dir` — the same shape `## Files`/`resolveContained` paths are
 * always written in, regardless of host OS. A directory entry that is
 * neither a file nor a directory (a symlink, a socket, …) is skipped rather
 * than followed, so a candidate tree can only ever contribute paths that
 * genuinely live inside it.
 *
 * @param dir - Root to walk.
 * @returns Relative file paths, in readdir order.
 *
 * @example
 * await walk('/tmp/candidate'); // -> ['src/App.jsx', 'src/app.css']
 */
async function walk(dir) {
	const out = [];
	for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			const nested = await walk(join(dir, entry.name));
			out.push(...nested.map((p) => `${entry.name}/${p}`));
		} else if (entry.isFile()) {
			out.push(entry.name);
		}
	}
	return out;
}

/**
 * Overlay every file under `candidateDir` onto the already-materialised
 * starter tree in `runDir`.
 *
 * Each candidate file's path relative to `candidateDir` is resolved through
 * `resolveContained` — the single containment authority the artifact's own
 * `## Files` writer uses — so a candidate tree is held to the same rule: no
 * escaping the run directory, no writing through a `node_modules` segment
 * into the shared package cache.
 *
 * A path the artifact declares `role: readonly` is refused outright, never
 * silently skipped: that file IS part of what grades the candidate (a `build`
 * check's own `tsconfig.json`, a pytest spec file, `hello-stack.md`'s
 * `web/server.js` relay) — writing over it (or quietly keeping the artifact's
 * own copy while pretending the candidate supplied one) would grade a tree
 * the solver never actually wrote. A previously-reported version of this
 * function made the destination writable first and overwrote it — a working
 * false-`solved`: a no-op candidate spec file passed a `build` check that
 * only ever ran the artifact's own reference spec.
 *
 * @param runDir           - Already-materialised run directory.
 * @param candidateDirRoot - Root of the external candidate tree (operator input).
 * @param readonlyPaths    - `role: readonly` paths the artifact declares — refused, not overlaid.
 * @throws Error when a candidate path escapes the run directory or targets a `role: readonly` file.
 *
 * @example
 * await overlayCandidateDir('/tmp/run', '/tmp/candidate', new Set(['web/server.js']));
 * // writes /tmp/run/src/App.jsx, …; throws if the candidate also has web/server.js
 */
async function overlayCandidateDir(runDir, candidateDirRoot, readonlyPaths) {
	for (const relPath of await walk(candidateDirRoot)) {
		if (readonlyPaths.has(relPath)) {
			throw new Error(`candidate path '${relPath}' overlays a read-only file the artifact declares — refused`);
		}
		const dest = resolveContained(runDir, relPath);
		await fs.mkdir(path.dirname(dest), { recursive: true });
		await fs.writeFile(dest, await fs.readFile(join(candidateDirRoot, relPath)));
	}
}

/**
 * Decide whether a failing check's `detail` must be masked to protect the
 * blind-solve final suite.
 *
 * A `case <N>: <reason>` marker names which of the check's `cases` failed
 * (the shape every check kind composes it in — `check.dispatcher.ts` for
 * `call`, `http/http.check.ts` for `http`, `project/checks.ts` for the render
 * kinds); `N` at or past `publicCount` came from `## Final Tests`, so only the
 * literal string `'hidden'` may reach stdout. A detail with no such marker
 * (`server never started: …`, a missing file, build output) is a
 * structural/infrastructure reason rather than a case result and passes
 * through verbatim — a trial needs to read those to classify a failure as
 * infrastructure rather than a grading defect. A check whose `publicCount`
 * cannot be determined masks every case-shaped detail, fail-closed.
 *
 * The marker search is **unanchored** deliberately: a render check's own
 * `validateRenderCheck` composes its failures as
 * `${kind} '${name}' case ${index}: …` (`project/checks.ts`), so `case N:`
 * is not always at index 0 — an anchored `^case` missed those and let two of
 * them (an unknown step `op`, a rejected layout property) print their case's
 * own input verbatim past `publicCount`.
 *
 * @param detail - The check outcome's own `detail`, if any.
 * @param check  - The check this outcome came from, for its `publicCount`
 *   (cases before that index are public) and its `kind`.
 * @returns The detail to print, replaced with `'hidden'` when it named a
 *   hidden case.
 *
 * @example
 * maskDetail('case 0: expected 3, got 4', { kind: 'call', publicCount: 2 }); // -> 'case 0: …'
 * maskDetail('case 2: expected 3, got 4', { kind: 'call', publicCount: 2 }); // -> 'hidden'
 * maskDetail('app.ts(9,3): case 3:', { kind: 'build', publicCount: 0 }); // -> unchanged
 */
function maskDetail(detail, check) {
	// `build` is the one kind whose detail is unstructured child output — raw
	// compiler stdout/stderr (`build.check.ts`). It cannot leak a case, because
	// `runBuildCheck` never reads `check.cases`; but a toolchain quoting an
	// offending source line back does print ordinary `switch` syntax, and
	// masking on that replaced a whole diagnostic with `hidden` — destroying
	// the infrastructure channel a trial needs to tell a broken toolchain from
	// a wrong answer. Exempt by **kind**, not by `cases.length`: `bindCases`
	// matches a fence to a check by name without filtering on kind, so a bound
	// fence would re-open the over-mask.
	if (check.kind === 'build') { return detail; }
	const match = /case (\d+):/.exec(detail);
	if (!match) { return detail; }
	return Number(match[1]) >= (check.publicCount ?? 0) ? 'hidden' : detail;
}

// ── Materialise starter + overlay candidate, then grade — one run dir ───────
// A `stack` boots real server process groups (S12) — the registry plus signal
// teardown is what stops a Ctrl-C landing mid-boot from orphaning one, the
// same backstop `verify-exercise.mjs` arms for its own CLI-only modes.
const registry = createGroupRegistry();
const uninstallSignals = installSignalTeardown(registry);

const runDir = await fs.mkdtemp(join(os.tmpdir(), 'leet-tree-candidate-'));
let outcomes;
let failReason;
try {
	await writeProjectFiles(runDir, parsed.files ?? []);
	await overlayCandidateDir(runDir, candidateDir, readonlyPaths);
	outcomes = await gradeProjectDir(parsed, runDir, { registry });
} catch (e) {
	failReason = e instanceof Error ? e.message : String(e);
} finally {
	uninstallSignals();
	await fs.rm(runDir, { recursive: true, force: true }).catch(() => { /* ignore cleanup errors */ });
}

if (failReason !== undefined) {
	die(`grade-tree-candidate: ${failReason}`, 2);
}

// Outcomes are index-aligned with `checks` on every return path of
// `gradeProjectDir` (a lib-install failure maps every check in order; the
// main loop pushes one outcome per check in declaration order) — indexing
// directly is simpler and safer than a by-name lookup, which a duplicate
// check name would mis-attribute.
for (const [index, outcome] of outcomes.entries()) {
	const verdict = outcome.passed ? 'PASS' : 'FAIL';
	const detail = outcome.passed || outcome.detail === undefined
		? ''
		: ` — ${maskDetail(outcome.detail, checks[index])}`;
	console.log(`[${index}] ${outcome.name} ${verdict}${detail}`);
}

const solved = outcomes.length > 0 && outcomes.every((o) => o.passed);

console.log(`VERDICT ${JSON.stringify({
	file: mdPath,
	candidate: candidateDir,
	solved,
	checks: `${outcomes.filter((o) => o.passed).length}/${outcomes.length}`,
})}`);

process.exit(solved ? 0 : 1);
