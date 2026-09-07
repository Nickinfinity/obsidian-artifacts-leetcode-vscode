#!/usr/bin/env node
// Artifact format v1 → v2 migrator — moves execution config out of YAML
// frontmatter into ```yaml leetcode body fences.
//
//   node scripts/migrate-artifact-format.mjs <dir|file>
//       → DRY RUN (the default): print a unified diff per file, write nothing.
//   node scripts/migrate-artifact-format.mjs <dir|file> --write
//       → apply the rewrite in place.
//
// Exit 0 when every eligible file migrated (or would migrate), 1 if any file
// failed, 2 on bad input. A file that is not `type: leetcode` is SKIPPED, not
// failed — a vault holds ordinary notes (`CoderByte/Tests/README.md` is `.md`
// and is not an exercise), and one of them must not abort a run over 70 files.
//
// This is a THIN CLI. Every rule lives in the compiled, vscode-free
// `artifact-migrator.helpers.ts` and is unit-tested there; this file owns only
// the filesystem walk and the reporting, exactly as `verify-exercise.mjs` is a
// shell over `exercise-verify.helpers.ts`. It therefore asserts the build
// exists FIRST — there is no `pnpm compile` in front of it, so a missing build
// must fail loud rather than half-run over the user's vault.
//
// Security, because this rewrites the user's vault:
//   - Dry run is the DEFAULT and `--write` is an exact match. An unrecognised
//     argv is refused outright (`parseMigrateArgs`), so a typo can never fall
//     through to the writing path.
//   - Every path is resolved and containment-asserted against the root, on a
//     separator boundary, so `/vault-evil` cannot pass a `/vault` check.
//   - Symlinks are REFUSED, not followed — `lstat`/`withFileTypes` before every
//     read and before every write. A vault is plain files, so refusing costs
//     nothing and removes the realpath-then-TOCTOU question rather than
//     answering it.
//   - No path or argument is ever built from artifact content, and there is no
//     subprocess at all.

import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const helpers = join(here, '..', 'dist', 'src', 'services', 'artifact-migrator.helpers.js');

/** Print to stderr and exit. */
function die(msg, code = 1) {
	console.error(msg);
	process.exit(code);
}

if (!existsSync(helpers)) {
	die(`missing build: ${helpers}\nRun \`pnpm compile\` first — this CLI imports the compiled helpers.`, 2);
}

const {
	isContained, isLeetCodeArtifact, migrateArtifact, parseMigrateArgs, unifiedDiff,
} = await import(pathToFileURL(helpers).href);

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

	const counts = { migrated: 0, unchanged: 0, skipped: 0, failed: 0 };
	const skip = (why) => { console.error(`skipped (${why})`); counts.skipped++; };
	const files = rootStat.isDirectory() ? collectMarkdown(root, skip) : [root];

	for (const file of files) {
		const label = relative(root, file) || file;
		if (lstatSync(file).isSymbolicLink()) { skip(`symlink, not followed: ${label}`); continue; }

		const before = readFileSync(file, 'utf8');
		// The discriminator, not `*.md` — a vault holds plain notes too.
		if (!isLeetCodeArtifact(before)) { skip(`not type: leetcode: ${label}`); continue; }

		let after;
		try { after = migrateArtifact(before); }
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
		`\n${verb} ${counts.migrated} · already v2 ${counts.unchanged} · `
		+ `skipped ${counts.skipped} · failed ${counts.failed}`,
	);
	if (!args.write) {
		console.error('DRY RUN — nothing was written. Re-run with --write to apply.');
	}
	return counts.failed > 0 ? 1 : 0;
}

process.exit(main());
