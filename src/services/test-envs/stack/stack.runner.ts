import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PackageSpec } from '../../../types/leetcode.types.js';
import { resolveContained } from '../project/files.writer.js';
import { bootServer, substitutePort, type BootedGroupRegistry } from '../http/server.lifecycle.js';

const execFileAsync = promisify(execFile);

/**
 * Boot a `leetcodeType: stack`'s whole `packages:` list as one group (T4.1,
 * VSX-178): concurrent installs, `dependsOn`-ordered boots with each
 * package's `exposeAs` wired from its already-booted dependencies, and one
 * teardown for the lot.
 *
 * **Scope.** `packages-parser.helpers.ts` already refuses a `dependsOn`
 * cycle, a duplicate `name`, and more than `MAX_PACKAGES` entries at *parse*
 * time — this module trusts that a `readonly PackageSpec[]` reaching
 * {@link bootStack} already satisfies all three and does not re-check any of
 * them.
 * A `dependsOn` naming a package this artifact never declares is **not**
 * refused at parse time, though (`findCycle`'s own doc: "a dead end for this
 * walk, not a cycle") — {@link bootStack} treats that name as permanently
 * unresolved, failing the package that named it, same as a real dependency
 * that never boots.
 *
 * **Ordering (item 3).** `install-all` runs every package's `install`
 * concurrently, independent of `dependsOn` — installing a dependency needs
 * none of its dependents' or dependencies' processes running. Booting is
 * then a wave over the dependency graph: each wave's packages have every
 * `dependsOn` name already resolved (booted **or** failed), so a wave with no
 * unresolved dependencies among `dependsOn: []` packages boots first
 * ("backends"), a later wave computes its environment from the *already-
 * assigned ports* of the dependencies it names — the "build frontends" step,
 * pure data, no subprocess — then boots ("boots frontends"). Every wave
 * boots concurrently within itself.
 *
 * **Failure propagates, it does not fail the whole boot (the Test First).**
 * When a dependency never boots (a failed install, a failed `bootServer`, or
 * a name this artifact never declares), every package that names it in
 * `dependsOn` is marked failed too, **carrying the dependency's own reason**
 * — never attempted — rather than a symptom-only "web never booted" that
 * hides which package actually broke. The shape mirrors `gradeProjectDir`'s
 * existing lib-install failure: one reason, mapped over every check it
 * disables.
 *
 * **Teardown (item 4).** Every package that does boot is passed the same
 * `opts.registry`, so `bootServer`'s own S12 registration covers each one
 * individually — N servers is N chances to orphan one, and each gets its own
 * registry entry rather than the group being registered as a unit.
 * {@link StackBoot.teardownAll} additionally tears down every booted server
 * in one call, for the normal end-of-grading path.
 *
 * **Env composition (item 5) is not this module's job.** `bootServer`
 * composes the child's actual environment (`composeChildEnv`,
 * `server.lifecycle.ts`) by spreading the inherited `process.env` and
 * assigning only allowlisted names — this module only *computes* the
 * `exposeAs` values (already-known dependency ports, `${PORT}` resolved) and
 * hands them to `bootServer` as `env`, which re-filters them before a spawn
 * ever sees them.
 */

/** Wall-clock budget for one package's `install` argv. Installs are slower than a build check's compile step, so this sits above `build.check.ts`'s `BUILD_TIMEOUT_MS`. */
const INSTALL_TIMEOUT_MS = 180_000;

/**
 * One package's outcome once {@link bootStack} has resolved it — booted and
 * reachable, or never attempted/never became ready, either way with a reason.
 *
 * `pid` is exposed on success (mirroring `BootedServer`'s own shape) so a
 * caller — chiefly a test — can verify S12 registration and teardown
 * directly against a specific process, the same rigor
 * `http-server-lifecycle.test.ts` already holds a single `bootServer` call
 * to; grading code has no use for it and reads `port` alone.
 */
export type PackageBootOutcome =
	| { readonly ok: true; readonly port: number; readonly pid: number }
	| { readonly ok: false; readonly reason: string };

/** {@link bootStack}'s result: every package's outcome, plus one teardown for the whole group. */
export interface StackBoot {
	/** Keyed by `PackageSpec.name` — one entry per package this artifact declared. */
	readonly outcomes: ReadonlyMap<string, PackageBootOutcome>;
	/** Tear down every package that did boot. Idempotent — safe to call more than once, and safe when nothing booted. */
	teardownAll(): Promise<void>;
}

/** Optional knobs for {@link bootStack} — forwarded to every {@link bootServer} call verbatim. */
export interface StackBootOptions {
	/** A session's registry, so `endChallenge()` covers every booted package (S12) — omit for a run with no session (the CLI/harness path). */
	readonly registry?: BootedGroupRegistry;
	/** Overrides `bootServer`'s own boot-timeout default — a test-only escape hatch. */
	readonly bootTimeoutMs?: number;
}

/** A resolved boot outcome plus the {@link BootedServer.stop} needed to tear it down — internal only; {@link PackageBootOutcome} (the public shape) never carries a live handle. */
interface Resolved {
	readonly outcome: PackageBootOutcome;
	readonly stop?: () => Promise<void>;
}

/**
 * Boot every package a `stack` declares, respecting `dependsOn` and wiring
 * `exposeAs`, and hand back one outcome per package plus a single teardown.
 *
 * @param packages - The artifact's `packages:` list — already parsed, so no
 *   cycle, no duplicate name, and at most `MAX_PACKAGES` entries.
 * @param runDir   - Run directory every `pkg.dir` resolves inside.
 * @param opts     - Registry, timeout and port-minting overrides.
 * @returns Every package's outcome and one `teardownAll()` for the group.
 *
 * @example
 * const stack = await bootStack(parsed.packages ?? [], runDir, { registry });
 * const api = stack.outcomes.get('api'); // → { ok: true, port: 54321 }
 * await stack.teardownAll();
 */
export async function bootStack(
	packages: readonly PackageSpec[], runDir: string, opts: StackBootOptions = {},
): Promise<StackBoot> {
	if (packages.length === 0) { return { outcomes: new Map(), teardownAll: async () => { /* nothing booted */ } }; }

	const byName = new Map(packages.map(p => [p.name, p]));
	const resolved = new Map<string, Resolved>();

	try {
		const installOutcomes = await installAll(packages, runDir, INSTALL_TIMEOUT_MS);
		await bootWaves(packages, byName, installOutcomes, resolved, runDir, opts);
	} catch (e) {
		// A boot that fails halfway through a set must still tear down whatever
		// already booted, before this function reports the failure upward —
		// never leave a partial stack running because the *loop* threw.
		await teardownResolved(resolved);
		throw e;
	}

	const outcomes = new Map<string, PackageBootOutcome>();
	for (const [name, entry] of resolved) { outcomes.set(name, entry.outcome); }
	return { outcomes, teardownAll: () => teardownResolved(resolved) };
}

/** Tear down every package that actually booted (silently skips one that only ever failed). */
async function teardownResolved(resolved: ReadonlyMap<string, Resolved>): Promise<void> {
	await Promise.all([...resolved.values()].map(entry => entry.stop?.()).filter((p): p is Promise<void> => p !== undefined));
}

// ── install-all ──────────────────────────────────────────────────────────────

/** One package's `install` outcome — `ok: false` propagates to every dependent, same as a failed boot. */
type InstallOutcome = { ok: true } | { ok: false; reason: string };

/** Run every package's `install` argv concurrently, independent of `dependsOn` — a dependency's own install needs nothing else running. */
async function installAll(
	packages: readonly PackageSpec[], runDir: string, timeoutMs: number,
): Promise<ReadonlyMap<string, InstallOutcome>> {
	const outcomes = new Map<string, InstallOutcome>();
	await Promise.all(packages.map(async pkg => {
		outcomes.set(pkg.name, await runInstall(pkg, runDir, timeoutMs));
	}));
	return outcomes;
}

/** Run one package's `install` argv — never a shell, `execFile` on the declared array as-is. */
async function runInstall(pkg: PackageSpec, runDir: string, timeoutMs: number): Promise<InstallOutcome> {
	const [command, ...args] = pkg.install;
	if (command === undefined) { return { ok: false, reason: `packages: '${pkg.name}' install is an empty argv` }; }

	let cwd: string;
	try {
		cwd = resolveContained(runDir, pkg.dir);
	} catch (e) {
		return { ok: false, reason: e instanceof Error ? e.message : String(e) };
	}

	try {
		await execFileAsync(command, args, { cwd, timeout: timeoutMs });
		return { ok: true };
	} catch (e) {
		return { ok: false, reason: installFailureText(e) };
	}
}

/** Prefer a failed installer's own output over the wrapper's generic "Command failed" line — mirrors `build.check.ts`'s `failureText`. */
function installFailureText(error: unknown): string {
	if (typeof error === 'object' && error !== null) {
		const { stderr, stdout } = error as { stderr?: string; stdout?: string };
		const output = `${stderr ?? ''}${stdout ?? ''}`.trim();
		if (output !== '') { return output.length > 500 ? `${output.slice(0, 500)}…` : output; }
	}
	if (error instanceof Error) { return error.message; }
	try {
		return JSON.stringify(error) ?? 'unknown error';
	} catch {
		return 'unknown error';
	}
}

// ── boot waves (dependsOn ordering, exposeAs wiring) ─────────────────────────

/**
 * Boot every package in dependency order: a wave is every not-yet-resolved
 * package whose `dependsOn` names are all already resolved (booted, failed,
 * or unknown to this artifact). Each wave boots concurrently; a later wave's
 * environment is computed from the *already-assigned ports* of the
 * dependencies the earlier wave just booted (item 2 — the "build frontends"
 * step named in the ordering is exactly this computation, not a subprocess).
 */
async function bootWaves(
	packages: readonly PackageSpec[], byName: ReadonlyMap<string, PackageSpec>,
	installOutcomes: ReadonlyMap<string, InstallOutcome>, resolved: Map<string, Resolved>,
	runDir: string, opts: StackBootOptions,
): Promise<void> {
	let pending = [...packages];
	while (pending.length > 0) {
		const wave = pending.filter(p => (p.dependsOn ?? []).every(dep => isResolvable(dep, byName, resolved)));
		if (wave.length === 0) {
			// Unreachable given packages-parser.helpers.ts's own guarantees (no
			// cycle among known packages) plus the unknown-dependency handling in
			// `isResolvable` below — kept as a bounded exit so a hostile direct
			// caller (bypassing the parser) cannot hang this loop forever.
			for (const p of pending) {
				resolved.set(p.name, { outcome: { ok: false, reason: `packages: '${p.name}' never booted — its dependencies never resolved` } });
			}
			break;
		}

		await Promise.all(wave.map(pkg => bootOnePackage(pkg, byName, installOutcomes, resolved, runDir, opts)));
		pending = pending.filter(p => !resolved.has(p.name));
	}
}

/** Whether `dep` is already decided (booted or failed) — or names a package this artifact never declared, which can never resolve and is treated as decided (failed) on sight. */
function isResolvable(dep: string, byName: ReadonlyMap<string, PackageSpec>, resolved: ReadonlyMap<string, Resolved>): boolean {
	return resolved.has(dep) || !byName.has(dep);
}

/** Resolve one package: propagate a failed/unknown dependency, propagate a failed install, or actually boot it. */
async function bootOnePackage(
	pkg: PackageSpec, byName: ReadonlyMap<string, PackageSpec>, installOutcomes: ReadonlyMap<string, InstallOutcome>,
	resolved: Map<string, Resolved>, runDir: string, opts: StackBootOptions,
): Promise<void> {
	const badDep = (pkg.dependsOn ?? []).find(dep => !byName.has(dep) || resolved.get(dep)?.outcome.ok === false);
	if (badDep !== undefined) {
		resolved.set(pkg.name, { outcome: { ok: false, reason: dependencyFailureReason(pkg.name, badDep, byName, resolved) } });
		return;
	}

	const install = installOutcomes.get(pkg.name);
	if (install && !install.ok) {
		resolved.set(pkg.name, { outcome: { ok: false, reason: `packages: '${pkg.name}' install failed: ${install.reason}` } });
		return;
	}

	const env = envFromDependencies(pkg, byName, resolved);
	const result = await bootServer(pkg, runDir, {
		registry: opts.registry, bootTimeoutMs: opts.bootTimeoutMs, env,
	});
	resolved.set(pkg.name, result.ok
		? { outcome: { ok: true, port: result.server.port, pid: result.server.pid }, stop: result.server.stop }
		: { outcome: { ok: false, reason: result.reason } });
}

/**
 * The Test First's exact requirement: `web`'s failure reason must **carry**
 * `api`'s own reason, not a generic "a dependency failed" — a solver reading
 * `web`'s failure must be able to see *why*, without having to separately
 * inspect `api`'s own outcome.
 */
function dependencyFailureReason(
	pkgName: string, badDep: string, byName: ReadonlyMap<string, PackageSpec>, resolved: ReadonlyMap<string, Resolved>,
): string {
	if (!byName.has(badDep)) {
		return `packages: '${pkgName}' depends on '${badDep}', which this artifact does not declare`;
	}
	const depOutcome = resolved.get(badDep)?.outcome;
	const depReason = depOutcome && !depOutcome.ok ? depOutcome.reason : 'never booted';
	return `packages: '${pkgName}' never booted — its dependency '${badDep}' failed: ${depReason}`;
}

/** `pkg`'s environment from its already-resolved dependencies' `exposeAs` templates, `${PORT}` substituted for each dependency's own assigned port (item 2). */
function envFromDependencies(
	pkg: PackageSpec, byName: ReadonlyMap<string, PackageSpec>, resolved: ReadonlyMap<string, Resolved>,
): Record<string, string> {
	const env: Record<string, string> = {};
	for (const depName of pkg.dependsOn ?? []) {
		const depSpec = byName.get(depName);
		const depOutcome = resolved.get(depName)?.outcome;
		// Both guaranteed by the caller (`bootOnePackage` already refused a
		// missing/failed dependency before this runs) — checked again here
		// rather than asserted, since a `Record` lookup is one comparison and a
		// wrong assumption here would silently boot with a half-built environment.
		if (!depSpec || !depOutcome?.ok) { continue; }
		for (const [key, template] of Object.entries(depSpec.exposeAs ?? {})) {
			env[key] = substitutePort(template, depOutcome.port);
		}
	}
	return env;
}
