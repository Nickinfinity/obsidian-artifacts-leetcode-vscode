#!/usr/bin/env node
// Coverage sweep — every IMPLEMENTED cell of the capability matrix has an artifact.
//
//   node scripts/coverage-sweep.mjs "$VAULT"
//       → print the (leetcodeType × testType) matrix tallied over the vault;
//         exit 0 when every implemented cell has at least one artifact behind it,
//         1 when an implemented cell is empty, 2 on bad input.
//
// The vault sweep in `CLAUDE.md` answers "does every artifact still verify?".
// It says nothing about a cell **no artifact exercises**, which is how a cell ends
// up implemented, documented, and never once run against a real file. This is the
// second gate: an implemented cell with a count of zero is a failure.
//
// **This is a CLI sweep, not a unit test**, for the reason `CLAUDE.md` gives: a test
// in `test/` must never walk a vault directory or depend on a machine-local path, or
// it passes or fails depending on whose checkout ran it. Inline fixtures cannot
// answer "does the vault contain an example", so the question belongs to a script.
//
// Security: the vault root comes from argv (operator input), never from artifact
// content. Nothing here executes an artifact — it parses and tallies only, so a
// hostile `.md` reaches no subprocess, no path join, and no `eval`.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist', 'src');
const distServices = join(dist, 'services');

/** Print a message to stderr and exit with `code` (default 1). */
function die(msg, code = 1) {
	console.error(msg);
	process.exit(code);
}

// ── Precondition: the build must exist (no implicit compile) ──────────────────
const distParser = join(distServices, 'leetcode-parser.service.js');
if (!existsSync(distParser)) {
	die('coverage-sweep: dist/ not built — run `pnpm compile` first.', 2);
}

const { parseLeetCode } = await import(pathToFileURL(distParser).href);
const { languagesForType } = await import(
	pathToFileURL(join(distServices, 'test-envs', 'env.registry.js')).href);
const { unimplementedCheckKindsFromContent } = await import(
	pathToFileURL(join(distServices, 'project-parser.helpers.js')).href);
const { isProgramSuite } = await import(
	pathToFileURL(join(distServices, 'test-envs', 'program', 'program.runner.js')).href);
const { TEST_TYPES, SHAPE_TEST_TYPE_IDS, isMultiFile } = await import(
	pathToFileURL(join(dist, 'types', 'constants.js')).href);
const { LEETCODE_TYPES } = await import(
	pathToFileURL(join(dist, 'types', 'leetcode-type.js')).href);

// ── Which cells are implemented? Asked of the code, never listed here ─────────

/**
 * The check kinds `runOneCheck` can actually dispatch, derived by **asking the
 * parser** rather than by keeping a second list.
 *
 * There is no exported set to read: `CHECK_KINDS` is module-private to
 * `project-parser.helpers.ts`, deliberately, and a copy of it here is precisely
 * the drift this plan keeps paying for (`TEST_TYPES` vs `VALID_KINDS` was one
 * such copy, and the two disagreed about what `function` meant). So each
 * candidate id is probed against the real grammar: build a minimal artifact
 * declaring one check of that kind, parse it, and see whether the check
 * **survived**. A reserved kind is dropped as unimplemented and an unknown kind
 * is dropped as a typo — either way it does not come back, and only a kind the
 * parser keeps is one a check runner can dispatch.
 *
 * @returns The set of test-type ids usable as a `checks[].kind`.
 *
 * @example
 * dispatchableKinds().has('build');   // → true
 * dispatchableKinds().has('http');    // → false, until an environment implements it
 */
function dispatchableKinds() {
	const probe = (kind) => `---
artifactType: leetcode
leetcodeType: package
title: probe
---

Probe.

\`\`\`yaml leetcode
test:
  checks:
    - name: probe
      kind: ${kind}
      argv: ["true"]
      file: src/probe.js
      function: probe
\`\`\`

## Files

\`\`\`javascript path=src/probe.js
export function probe() { return 1; }
\`\`\`
`;
	const dispatchable = new Set();
	for (const { id } of TEST_TYPES) {
		const parsed = parseLeetCode(probe(id));
		if ((parsed.checks ?? []).some(check => check.kind === id)) { dispatchable.add(id); }
	}
	return dispatchable;
}

const DISPATCHABLE = dispatchableKinds();

/**
 * Is `(leetcodeType × testType)` implemented **today**?
 *
 * Two authorities, because the matrix has two halves and only one of them goes
 * through the registry: a single-suite `test.type` resolves an environment per
 * language, while a check `kind:` is dispatched per check against an
 * already-written directory and has no registry entry at all
 * (`languagesForType('build')` is `[]`).
 *
 * @param leetcodeType - One of the three axis ids.
 * @param testType     - A test-type id.
 * @returns True when something in the tree can execute that pair.
 *
 * @example
 * cellImplemented('function', 'function'); // → true
 * cellImplemented('package', 'build');     // → true — a dispatchable check kind
 * cellImplemented('function', 'build');    // → false — a buffer has no checks
 */
function cellImplemented(leetcodeType, testType) {
	// A legacy shape id is not an authorable test type, so it can never be
	// covered and must never be demanded. `project` still resolves an
	// environment — it is the key the directory-grading path goes through — but
	// no artifact declares it: the migration deleted that line from every
	// check-graded file, and a check may not name it as a `kind:` either. Left
	// in, it is a permanently unsatisfiable gap that would make this gate
	// impossible to ever pass.
	if (SHAPE_TEST_TYPE_IDS.has(testType)) { return false; }
	if (languagesForType(testType, leetcodeType).length > 0) { return true; }
	return isMultiFile(leetcodeType) && DISPATCHABLE.has(testType);
}

// ── The vault walk — same filter as the §J sweep ──────────────────────────────

const SKIP_DIRS = new Set(['.obsidian', '.git', '.trash', 'node_modules']);

/**
 * Every `.md` file under `root`, skipping the directories a vault sweep must
 * never descend into.
 *
 * @param root - Absolute vault path.
 * @returns Absolute paths of candidate files.
 *
 * @example
 * markdownFiles('/vault'); // → ['/vault/CoderByte/two-sum.md', …]
 */
function markdownFiles(root) {
	const found = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isSymbolicLink()) { continue; }
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) { walk(full); }
			} else if (entry.isFile() && entry.name.endsWith('.md')) {
				found.push(full);
			}
		}
	};
	walk(root);
	return found;
}

/**
 * The test types one artifact **declares**, which is not the same as the ones it
 * can run.
 *
 * A check whose kind nothing implements is dropped at parse time, so
 * `parsed.checks` alone would report the four `kind: http` artifacts as covering
 * nothing — and the cell would read as uncovered on the very day `http` lands.
 * The dropped kinds are therefore added back from the parser's own record of
 * them. Coverage counts what an author wrote; whether it runs is the other axis
 * of this report.
 *
 * **A multi-file artifact is not always check-graded.** A `program` suite is a
 * tree with cases and *no* `checks:` (the D14 mirror rule keeps the two
 * exclusive), so the check branch below reports it as declaring nothing at all
 * and `package × program` reads as an uncovered cell however many program
 * artifacts the vault holds. The fork is asked of `isProgramSuite` — the one
 * authority every other caller uses — rather than re-derived from a
 * `program:` block plus an empty check list here.
 *
 * @param md     - Raw artifact text.
 * @param parsed - Its parse result.
 * @returns The declared test-type ids, deduplicated.
 *
 * @example
 * declaredTestTypes(md, parsed); // → ['build', 'http']
 */
function declaredTestTypes(md, parsed) {
	const checks = parsed.checks ?? [];
	if (isProgramSuite(parsed)) { return ['program']; }
	if (checks.length > 0 || isMultiFile(parsed.leetcodeType)) {
		const kinds = new Set(checks.map(check => check.kind));
		for (const dropped of unimplementedCheckKindsFromContent(md)) { kinds.add(dropped); }
		return [...kinds];
	}
	return [parsed.test.type];
}

// ── argv ──────────────────────────────────────────────────────────────────────

const vault = process.argv[2];
if (!vault) { die('usage: coverage-sweep <vault-root>', 2); }
if (!existsSync(vault) || !statSync(vault).isDirectory()) {
	die(`coverage-sweep: not a directory: ${vault}`, 2);
}

// ── Tally ─────────────────────────────────────────────────────────────────────

/** `"<leetcodeType>::<testType>"` → count. */
const tally = new Map();
const keyFor = (leetcodeType, testType) => `${leetcodeType}::${testType}`;

let artifacts = 0;
let unreadable = 0;

for (const file of markdownFiles(vault)) {
	let md;
	try {
		md = readFileSync(file, 'utf-8');
	} catch {
		unreadable += 1;
		continue;
	}
	// The same discriminator the vault sweep filters on — a vault holds ordinary
	// notes, and one of them is a README that is `.md` without being an exercise.
	if (!/^artifactType:[ \t]*leetcode[ \t]*$/m.test(md)) { continue; }

	artifacts += 1;
	const parsed = parseLeetCode(md);
	const leetcodeType = parsed.leetcodeType ?? 'function';
	for (const testType of declaredTestTypes(md, parsed)) {
		const key = keyFor(leetcodeType, testType);
		tally.set(key, (tally.get(key) ?? 0) + 1);
	}
}

// ── Report ────────────────────────────────────────────────────────────────────

const testTypeIds = TEST_TYPES.map(t => t.id);
const leetcodeTypeIds = LEETCODE_TYPES.map(l => l.id);
const width = Math.max(...testTypeIds.map(id => id.length)) + 2;

console.log(`coverage sweep · ${artifacts} artifacts · ${vault}\n`);
console.log(`${'test type'.padEnd(width)}${leetcodeTypeIds.map(id => id.padStart(10)).join('')}`);

const gaps = [];
for (const testType of testTypeIds) {
	const cells = leetcodeTypeIds.map((leetcodeType) => {
		if (!cellImplemented(leetcodeType, testType)) { return '—'.padStart(10); }
		const count = tally.get(keyFor(leetcodeType, testType)) ?? 0;
		if (count === 0) { gaps.push(`${leetcodeType} × ${testType}`); }
		return String(count).padStart(10);
	});
	console.log(`${testType.padEnd(width)}${cells.join('')}`);
}

console.log('\n—  = not implemented for that leetcode type; nothing is demanded of it.');
if (unreadable > 0) { console.log(`${unreadable} file(s) could not be read and were skipped.`); }

if (gaps.length > 0) {
	console.error(`\nUNCOVERED IMPLEMENTED CELL(S): ${gaps.join(' · ')}`);
	console.error('An implemented cell with no artifact behind it is a gate failure —');
	console.error('write the example, or stop reporting the cell as implemented.');
	process.exit(1);
}

console.log('\nevery implemented cell has an artifact behind it.');
