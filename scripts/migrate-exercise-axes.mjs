#!/usr/bin/env node
// Migrate vault artifacts from the v2 format to the **two-axis** format (T1.13).
//
//   node scripts/migrate-exercise-axes.mjs <vault-or-file>            # dry run
//   node scripts/migrate-exercise-axes.mjs <vault-or-file> --write    # apply
//
// Four rewrites, all line-scoped, and nothing else:
//   1. frontmatter `type:` → `artifactType:`
//   2. frontmatter gains the derived `leetcodeType:`
//   3. the retained frontmatter keys are put in canonical order; every unknown
//      key keeps its own slot
//   4. inside a ```yaml leetcode fence, a `test:` block that declares `checks:`
//      loses its legacy `type:` line (D14), and a `services:` block becomes
//      `packages:`
//
// **`kind:` values are never touched.** An earlier revision of this plan called
// `kind: function` → `kind: call` required; re-measured after T1.16, `call` has
// no registered environment, and an artifact declaring an unimplemented kind is
// now refused *as a whole*. That rewrite belongs to wave 3.D, with the narrowing
// that registers the envs under `call`.
//
// Safety, mirroring `migrate-artifact-format.mjs` — deliberately the same shape:
//   - Dry run is the default. `--write` is the only way to touch a file.
//   - Symlinks are skipped, never followed, which removes the realpath-TOCTOU
//     question rather than answering it.
//   - Every path is containment-asserted against the root before any write.
//   - No path or argument is ever built from artifact content, and there is no
//     subprocess at all.

import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const services = join(here, '..', 'dist', 'src', 'services');
const migratorHelpers = join(services, 'artifact-migrator.helpers.js');
const axesHelpers = join(services, 'exercise-axes-migrator.helpers.js');

/** Print to stderr and exit. */
function die(msg, code = 1) {
	console.error(msg);
	process.exit(code);
}

for (const path of [migratorHelpers, axesHelpers]) {
	if (!existsSync(path)) {
		die(`missing build: ${path}\nRun \`pnpm compile\` first — this CLI imports the compiled helpers.`, 2);
	}
}

// `isLeetCodeArtifact` accepts BOTH spellings on purpose: it answers "is this
// file mine to rewrite?", which is how the migrator finds the very files that
// still say `type:`. `verifyExercise` asks the different question.
const {
	isContained, isLeetCodeArtifact, parseMigrateArgs, unifiedDiff,
} = await import(pathToFileURL(migratorHelpers).href);
const { migrateExerciseAxes } = await import(pathToFileURL(axesHelpers).href);

/** Directory names never descended into. */
const SKIP_DIRS = new Set(['.obsidian', '.git', '.trash', 'node_modules']);

/** Resolve `candidate` and refuse it if it escapes `root`. */
function assertContained(root, candidate) {
	if (!isContained(relative(root, candidate), sep)) {
		die(`refusing a path outside the root: ${candidate}`);
	}
	return candidate;
}

/**
 * Collect every `.md` under `root`, refusing symlinks rather than following
 * them. Dotfiles and the skip list are never descended into.
 */
function collectMarkdown(root, onSkip) {
	const out = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) { continue; }
			const full = assertContained(root, resolve(dir, entry.name));
			if (entry.isSymbolicLink()) { onSkip(`symlink, not followed: ${relative(root, full)}`); continue; }
			if (entry.isDirectory()) { walk(full); }
			else if (entry.isFile() && entry.name.endsWith('.md')) { out.push(full); }
		}
	};
	walk(root);
	return out;
}

function main() {
	let args;
	try { args = parseMigrateArgs(process.argv.slice(2)); }
	catch (err) { die(err instanceof Error ? err.message : String(err), 2); return 2; }

	const root = resolve(args.target);
	if (!existsSync(root)) { die(`no such path: ${root}`, 2); return 2; }
	const rootStat = lstatSync(root);
	if (rootStat.isSymbolicLink()) { die(`refusing a symlinked root: ${root}`, 2); return 2; }

	const counts = { migrated: 0, unchanged: 0, skipped: 0, failed: 0, seen: 0 };
	const skip = (why) => { console.error(`skipped (${why})`); counts.skipped++; };
	const files = rootStat.isDirectory() ? collectMarkdown(root, skip) : [root];
	counts.seen = files.length;

	for (const file of files) {
		const label = relative(root, file) || file;
		if (lstatSync(file).isSymbolicLink()) { skip(`symlink, not followed: ${label}`); continue; }

		const before = readFileSync(file, 'utf8');
		// The discriminator, not `*.md` — a vault holds plain notes too.
		if (!isLeetCodeArtifact(before)) { skip(`not a leetcode artifact: ${label}`); continue; }

		let after;
		try { after = migrateExerciseAxes(before); }
		catch (err) {
			console.error(`FAILED ${label}: ${err instanceof Error ? err.message : String(err)}`);
			counts.failed++;
			continue;
		}

		if (after === before) { counts.unchanged++; continue; }

		if (args.write) {
			writeFileSync(assertContained(root, file), after, 'utf8');
			console.log(`migrated: ${label}`);
		} else {
			console.log(unifiedDiff(before, after, label));
			console.log('');
		}
		counts.migrated++;
	}

	const verb = args.write ? 'migrated' : 'would migrate';
	console.error(
		`\n.md seen ${counts.seen} · ${verb} ${counts.migrated} · already two-axis ${counts.unchanged} · `
		+ `skipped ${counts.skipped} · failed ${counts.failed}`,
	);
	if (!args.write) {
		console.error('DRY RUN — nothing was written. Re-run with --write to apply.');
	}
	return counts.failed > 0 ? 1 : 0;
}

process.exit(main());
