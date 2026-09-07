/**
 * Classifies a `--starter-red` failure detail as **infrastructure** (the
 * toolchain broke) or **candidate** (the starter genuinely failed) — the
 * distinction `verify-exercise.mjs`'s `--starter-red` mode could not make
 * before this (ledger C14).
 *
 * `--starter-red`'s whole pass condition is "some check/case failed", so a
 * swept library cache producing `Cannot find module 'jsdom'` satisfied it
 * exactly as an incomplete starter does — a false RED that reads as proof an
 * exercise ships unsolved, when the toolchain never actually graded it.
 *
 * Deliberately text-pattern matching, not a second table of error strings:
 * every pattern below is the literal shape a real infrastructure failure in
 * this codebase already produces (`lib-cache.service.ts`'s `reasonFor`, the
 * four installers' `missingTool` sentences, `program.runner.ts`'s
 * `compilation timed out`, `runProgramArtifact`'s `program: …` one-element
 * "never ran" reasons, `server.lifecycle.ts`'s boot-readiness timeout) plus —
 * as of VSX-230 — each runtime's own missing-dependency vocabulary: Python's
 * `ModuleNotFoundError`, Java's `NoClassDefFoundError` and "Could not find or
 * load main class", and cargo's "no matching package named". The original set
 * only covered Node's; a missing Python dependency at boot
 * (`ModuleNotFoundError: No module named 'flask'`) classified `candidate` and
 * printed a false RED with nothing having actually run.
 * A failure detail is untrusted-ish text (it can echo a subprocess's own
 * stderr), so every pattern is anchored, holds a single quantifier over a
 * single class, and is checked with a plain substring/regex test — never
 * `eval` or a regex built from the text itself.
 *
 * **`compilation error: …` is deliberately NOT a pattern here**, and that is
 * a measured reversal, not an oversight: a starter that genuinely does not
 * compile is the canonical ships-unsolved state for java/rust/typescript, and
 * a rust starter calling an undefined `add` produced
 * `compilation error: error[E0425]: cannot find function 'add' in this
 * scope` — a real compiler diagnostic, printed directly beneath a claim that
 * it is "a broken toolchain, not the starter." A genuinely missing compiler
 * still classifies correctly: it arrives as `compilation error: spawn rustc
 * ENOENT`, which the `spawn \S+ ENOENT` pattern below already catches on its
 * own. **Accepted trade:** a swept-jar `javac` failure (a real compiler
 * invoked against a cache with a jar missing) now reads RED instead of
 * INCONCLUSIVE — rarer than a missing binary, never silent, and the
 * compiler's own message prints either way.
 */

/** One classification a starter failure can carry. */
export type StarterFailureKind = 'infrastructure' | 'candidate';

/**
 * Regex patterns whose match means "the toolchain broke", not "the starter is
 * wrong". Order does not matter — the first match wins and that is the only
 * thing consumed.
 */
const INFRASTRUCTURE_PATTERNS: readonly RegExp[] = [
	// `runProgramArtifact`'s one-element "never ran" reasons — a program suite
	// that never executed a single case: no `program:` block, no runnable
	// language, or no registered environment for one.
	/^program: /,
	// Node's own missing-module error — the exact shape a swept `pnpm`/`pip`
	// cache produces (`Cannot find module 'jsdom'`). Narrowed to a name NOT
	// starting with `.` or `/`: a candidate's own bad `require('./helper.js')`
	// or `require('/abs/path')` reaches a case's error as verbatim child
	// stderr (`program.runner.ts`'s `error: outcome.message`) in the exact
	// same `Cannot find module '…'` shape, and that one is the starter's own
	// defect, not the toolchain's. A bare package-name miss
	// (`Cannot find module 'lodash'`) is still genuinely ambiguous — it could
	// be an uninstalled dependency (infrastructure) or a candidate importing
	// something that was never going to be there (candidate) — and this
	// classifies it infrastructure rather than widening the exclusion further.
	/Cannot find module '[^'./]/,
	/MODULE_NOT_FOUND/,
	// `lib-cache.service.ts`'s `reasonFor`: an install subprocess failed, or
	// the ecosystem has no registered installer at all.
	/install failed:/,
	/no installer for/,
	// The four installers' `missingTool` sentences all share this shape —
	// `'python3 not found — install Python …'`, `'mvn not found — install
	// Maven …'`, etc.
	/not found — install/,
	// `program.runner.ts`'s `runBuild`: the suite's own compile step hung
	// before a single case ran. `compilation error: …` is deliberately absent
	// — see the module doc.
	/compilation timed out/,
	// The registry has no environment for this (testType, language) pair —
	// "no runtime detected" for the triple being graded.
	/no (call|program) environment for/,
	// Node's own `child_process.spawn` failure when the interpreter binary
	// does not exist on `PATH` at all (`program.runner.ts`'s `spawn()`, whose
	// `message` becomes a case's `error` verbatim when the child never
	// started) — e.g. `spawn python3 ENOENT`. Deliberately narrower than a
	// bare `ENOENT`: a candidate's own failure to open a file surfaces as its
	// language's own error text (a Node `Error: ENOENT: no such file or
	// directory, open '…'`, a Python `FileNotFoundError`), never this exact
	// `spawn <cmd> ENOENT` sentence — so a bare `ENOENT` inside otherwise
	// candidate-shaped text must not flip it. The one honest exception: a
	// javascript/typescript candidate that itself shells out via
	// `child_process` to a binary that does not exist would also print this
	// exact sentence on its own stderr, and would be misclassified
	// infrastructure. Accepted: the shape is overwhelmingly the runner's own
	// spawn (a missing language interpreter), not a candidate re-spawning a
	// missing tool as part of its solution.
	/spawn \S+ ENOENT/,
	// `server.lifecycle.ts`'s boot-readiness timeout — the package's server
	// never came up inside `BOOT_TIMEOUT_MS`. Deliberately narrower than every
	// boot failure: a server that starts and then exits (or throws) is the
	// starter's own incomplete code, a genuine candidate failure.
	/server never became ready/,
	// Python's own missing-module error (VSX-230) — `program.runner.ts`'s
	// `spawn()` hands a crashed `python3 <entry>`'s stderr through verbatim
	// (`outcome.message`), and `server.lifecycle.ts`'s `exitedReason` embeds the
	// same text when a Flask/FastAPI boot dies on a missing import. Measured:
	// `python3 -c "import nosuchmodule_xyz"` →
	// "ModuleNotFoundError: No module named 'nosuchmodule_xyz'". Python has no
	// `./`-style syntax distinguishing a local sibling file from a third-party
	// package — `import helper` and `import flask` produce the identical shape
	// — so this is the same accepted ambiguity as the bare `Cannot find module
	// 'lodash'` case below, not a narrower rule. A candidate's own broken
	// **relative** import (`from . import helper` with no parent package) is
	// textually distinct — `ImportError: attempted relative import with no
	// known parent package` — and does not match this pattern.
	//
	// **Do NOT "fix" this by excluding dotted names.** The obvious analogue of
	// Node's `[^'./]` narrowing would be `'[^'.]+'`, and it is wrong: a
	// candidate's own `from .models import Thing` inside a package reports
	// `No module named 'app.models'` (its defect, would classify candidate),
	// but a swept transitive dependency reports `No module named 'flask.json'`
	// (the toolchain's, must classify infrastructure) — and Python spells both
	// with a bare `.`, having no `./`-versus-`/` separator to tell them apart.
	// So a dotted exclusion trades one false-`infrastructure` for one
	// false-`candidate`, and false-`candidate` is the worse direction: it is
	// the false RED this whole module exists to remove. Measured and rejected
	// during the VSX-230 review; the laundering it leaves open buys an artifact
	// author only exit 3, a refusal to certify, never a false green.
	/ModuleNotFoundError: No module named/,
	// Java's runtime classpath miss (VSX-230) — a library class present at
	// `javac` time but absent from the runtime classpath (a swept jar in the
	// shared lib cache). Measured: compile `UsesLib.java` against `lib.jar`,
	// delete the compiled `Lib.class`, run `java -cp . UsesLib` →
	// `Exception in thread "main" java.lang.NoClassDefFoundError: Lib`.
	/NoClassDefFoundError/,
	// Java's `run` step naming a class `java` cannot find at all (VSX-230). The
	// class named here is always `runner-select.ts`'s own generated entry
	// class, never solver-authored, so this shape is unambiguously the
	// toolchain's fault. Measured: `java -cp . ThisClassDoesNotExist` →
	// "Error: Could not find or load main class ThisClassDoesNotExist".
	/Could not find or load main class/,
	// Cargo's offline dependency resolution failing to find a crate in the
	// local registry cache (VSX-230) — the rust `program`/`function` `compile`
	// step is `cargo build --offline …`, so this reaches a case exactly like
	// the existing `compilation error: spawn rustc ENOENT` shape. Measured: a
	// `Cargo.toml` dependency absent from the offline cache, `cargo build
	// --offline` → "error: no matching package named `totally_nonexistent_
	// crate_xyz123` found", followed by "location searched: crates.io index".
	/no matching package named/,
];

/**
 * Classify one failure detail as infrastructure or candidate.
 *
 * @param detail - A check outcome's `detail`, or a case result's `error`;
 *   `undefined` (a failure with no message) classifies as `candidate` — there
 *   is no evidence of a broken toolchain to point to.
 * @returns `'infrastructure'` when the text matches a known toolchain-broke
 *   shape, else `'candidate'`.
 *
 * @example
 * classifyStarterFailure("Cannot find module 'jsdom'"); // → 'infrastructure'
 * @example
 * classifyStarterFailure('case 0: expected 3, got 0'); // → 'candidate'
 */
export function classifyStarterFailure(detail: string | undefined): StarterFailureKind {
	if (detail === undefined) { return 'candidate'; }
	return INFRASTRUCTURE_PATTERNS.some(pattern => pattern.test(detail)) ? 'infrastructure' : 'candidate';
}

/**
 * Whether every failure in a `--starter-red` run is infrastructure — the
 * condition that must print `INCONCLUSIVE` instead of `RED`, because nothing
 * observed here is evidence the starter itself is incomplete.
 *
 * `false` for an empty list: no failures means the starter passed, which is
 * `--starter-red`'s separate `PRE-SOLVED` outcome, not this one.
 *
 * @param details - Every failed check's `detail` / failed case's `error`.
 * @returns `true` only when there is at least one failure and none of them
 *   are attributable to the starter's own code.
 *
 * @example
 * allInfrastructure(["Cannot find module 'jsdom'"]); // → true
 * @example
 * allInfrastructure(['case 0: expected 3, got 0']); // → false
 */
export function allInfrastructure(details: readonly (string | undefined)[]): boolean {
	return details.length > 0 && details.every(d => classifyStarterFailure(d) === 'infrastructure');
}

/**
 * How many of a `--starter-red` run's failures are infrastructure — printed
 * on a RED verdict so a human reading a mixed result knows some of what they
 * see is toolchain noise, not starter incompleteness.
 *
 * @param details - Every failed check's `detail` / failed case's `error`.
 * @returns Count of failures classifying as `'infrastructure'`.
 *
 * @example
 * infrastructureCount(["Cannot find module 'jsdom'", 'case 0: expected 3, got 0']); // → 1
 */
export function infrastructureCount(details: readonly (string | undefined)[]): number {
	return details.filter(d => classifyStarterFailure(d) === 'infrastructure').length;
}
