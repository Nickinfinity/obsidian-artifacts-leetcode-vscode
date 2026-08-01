import { resolveLangId, runnableLangId } from '../language-map.service.js';
import { isLangId, LANGUAGES } from '../../types/languages.js';

/**
 * A package registry an artifact's `libs:` can be resolved against.
 *
 * `'npm'` names the **registry** (registry.npmjs.org), not the tool: the
 * installer behind it is pnpm, and this extension invokes `npm` nowhere.
 * Renaming the id to match the tool would misdescribe what a `libs:` entry
 * is — a spec written in that registry's own notation.
 */
export type LibEcosystem = 'npm' | 'pip' | 'cargo' | 'maven';

/**
 * The registry that serves a `libs:` language key, or `undefined` when no
 * installer can serve it.
 *
 * The key comes from untrusted `.md` text, so it is resolved the same way a
 * fence info-string is (`py` → `python`, `TypeScript` → `typescript`) and then
 * folded onto its runnable pair (`tsx` → `typescriptreact` → `typescript`),
 * because an author may reasonably declare React libs under a display id and
 * npm serves those packages either way.
 *
 * @param languageKey - Language key exactly as written in `libs:`.
 * @returns Its registry, or `undefined` for a language nothing here installs.
 *
 * @example
 * ecosystemFor('python');          // → 'pip'
 * ecosystemFor('typescriptreact'); // → 'npm'
 * ecosystemFor('cobol');           // → undefined
 */
export function ecosystemFor(languageKey: string): LibEcosystem | undefined {
	const langId = runnableLangId(resolveLangId(languageKey));
	return isLangId(langId) ? LANGUAGES[langId].ecosystem : undefined;
}

/** An npm spec: a scoped or unscoped package name with an optional range. */
export interface NpmLibSpec {
	readonly ecosystem: 'npm';
	/** Package name, **including** any `@scope/` — the form npm addresses it by. */
	readonly name: string;
	/** Version range as written, e.g. `^19.0.0`. Absent means "latest". */
	readonly range?: string;
}

/** A pip requirement: a name, optional extras, and optional version predicates. */
export interface PipLibSpec {
	readonly ecosystem: 'pip';
	readonly name: string;
	/** Extras from `name[a,b]`, without the brackets. */
	readonly extras: readonly string[];
	/** Predicates from `name>=2,<3`, each with its operator, e.g. `>=2`. */
	readonly predicates: readonly string[];
}

/** A cargo dependency: a crate, an optional req, and optional features. */
export interface CargoLibSpec {
	readonly ecosystem: 'cargo';
	readonly name: string;
	/** Version requirement as written, e.g. `^1`. Absent means "latest". */
	readonly req?: string;
	/** Features from `crate@1+derive+std`. */
	readonly features: readonly string[];
}

/** A maven coordinate: `groupId:artifactId:version[:packaging[:classifier]]`. */
export interface MavenLibSpec {
	readonly ecosystem: 'maven';
	readonly groupId: string;
	readonly artifactId: string;
	readonly version: string;
	readonly packaging?: string;
	readonly classifier?: string;
}

/**
 * One validated library spec, parsed into the fields its manifest or argv is
 * rendered from.
 *
 * A discriminated union rather than one bag of optional fields: every renderer
 * then narrows to exactly the fields its ecosystem has, and a maven coordinate
 * can never be handed to the pip installer without the compiler saying so.
 */
export type ParsedLibSpec = NpmLibSpec | PipLibSpec | CargoLibSpec | MavenLibSpec;

/**
 * The result of validating one raw spec: the parsed fields, or the reason it
 * was refused.
 *
 * Discriminated on `ok` so a caller narrows without a null check, and the
 * refusal carries a sentence a warning can show the author verbatim.
 */
export type LibSpecParse<S extends ParsedLibSpec = ParsedLibSpec> =
	| { readonly ok: true; readonly spec: S }
	| { readonly ok: false; readonly reason: string };

/**
 * Injectable subprocess runner — the seam every installer test observes
 * instead of the network.
 *
 * An **argv array**, never a command string: artifact-derived text reaches a
 * package manager as one inert argument, so no shell can reinterpret a spec
 * that slipped past validation.
 *
 * @param file - Executable name, resolved from `PATH`.
 * @param args - Argument vector; every element is passed through untouched.
 * @param cwd  - Working directory for the child.
 * @param env  - Extra environment, already merged by the caller.
 */
export type RunArgv = (
	file: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv,
) => Promise<void>;

/**
 * One ecosystem's installer: how to validate its specs, and how to build a
 * cache directory from them.
 *
 * `ensureLibEnv` is the only caller. It pairs `parseSpec` and `install` from
 * the *same* installer, which is what makes the spec type parameter safe —
 * nothing else assembles a spec list.
 */
export interface LibInstaller<S extends ParsedLibSpec = ParsedLibSpec> {
	readonly ecosystem: LibEcosystem;
	/**
	 * Relative path proving a completed install, e.g. `'node_modules'`.
	 *
	 * Probed alongside the warm marker, because a marker over an
	 * OS-swept directory reads warm forever otherwise.
	 */
	readonly product: string;
	/** Validate and parse one raw spec into fields, or explain the refusal. */
	parseSpec(raw: string): LibSpecParse<S>;
	/** Install `specs` into `dir` (already created). Argv only, no shell. */
	install(dir: string, specs: readonly S[], run: RunArgv): Promise<void>;
}
