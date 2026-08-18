import { resolveLangId, runnableLangId } from '../language-map.service.js';
import { isLangId, LANGUAGES } from '../../types/languages.js';

/**
 * Which toolchain resolves an artifact's `libs:`, and therefore which grammar
 * its specs are written in.
 *
 * Named after the **tool**, uniformly: `pnpm`, not `npm`, because pnpm is what
 * this extension actually invokes — it shells `npm` nowhere, and an id saying
 * otherwise made the one thing a reader checks disagree with the one thing the
 * code does. The packages still come from registry.npmjs.org, and a spec is
 * still written in that registry's notation; the id names the client, the way
 * `pip`, `cargo` and `maven` already did.
 */
export const LIB_ECOSYSTEMS = ['pnpm', 'pip', 'cargo', 'maven'] as const;

/**
 * Derived from {@link LIB_ECOSYSTEMS}, never written out beside it.
 *
 * The inversion is the point: a consumer that needs to *iterate* the
 * ecosystems (`packages-parser.helpers.ts` derives the library-seam variable
 * names by asking `libEnvVars` for each) cannot reflect over a union type, so
 * it used to hand-list the four ids with a comment conceding the copy could go
 * stale. Declaring the array first and taking the type from it means a fifth
 * ecosystem is added in exactly one place and every consumer follows.
 */
export type LibEcosystem = typeof LIB_ECOSYSTEMS[number];

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
 * ecosystemFor('typescriptreact'); // → 'pnpm'
 * ecosystemFor('cobol');           // → undefined
 */
export function ecosystemFor(languageKey: string): LibEcosystem | undefined {
	const langId = runnableLangId(resolveLangId(languageKey));
	return isLangId(langId) ? LANGUAGES[langId].ecosystem : undefined;
}

/** An npm-registry spec: a scoped or unscoped package name with an optional range. */
export interface PnpmLibSpec {
	readonly ecosystem: 'pnpm';
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
export type ParsedLibSpec = PnpmLibSpec | PipLibSpec | CargoLibSpec | MavenLibSpec;

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
	 * Whether a finished install can be built elsewhere and moved into place.
	 *
	 * `true` for everything whose product is position-independent, which lets
	 * the cache service build in a tmp sibling and `rename` — atomic against a
	 * second window racing the same key. `false` for pip: a venv's console
	 * scripts carry an **absolute** shebang, so a moved venv has a dead
	 * `bin/pip`, `pytest` and `uvicorn`.
	 */
	readonly relocatable: boolean;
	/** What to say when the toolchain is not installed at all (`ENOENT`). */
	readonly missingTool: string;
	/**
	 * Relative paths that must all exist for a previous install to count as
	 * warm, e.g. `['node_modules/react']`.
	 *
	 * Per-spec rather than one fixed product path, because that granularity is
	 * load-bearing: macOS prunes `/var/folders` by age, and a swept cache that
	 * kept its marker over an emptied tree read warm forever.
	 */
	warmPaths(specs: readonly S[]): readonly string[];
	/**
	 * Optional deeper warm probe, run only after every `warmPaths` entry exists.
	 *
	 * `warmPaths` can name a file but cannot express a claim *about* one, and
	 * the difference is load-bearing: macOS prunes `/var/folders` file by file,
	 * so a package's `package.json` can survive while the executable it declares
	 * does not. That entry passes a path probe and then fails the moment a
	 * `build` check spawns it — observed as `Cannot find module
	 * '…/typescript/bin/tsc'` on an entry that read warm, and it needed a manual
	 * `rm -rf` of the cache to clear.
	 *
	 * Implement it where a package is more than the sum of the paths a spec can
	 * name up front. pip has the same shape of problem waiting (a venv's console
	 * scripts carry absolute shebangs).
	 *
	 * @param dir   - The cache directory for this set.
	 * @param specs - The parsed specs it was built for.
	 * @returns `true` when the install may still be trusted.
	 */
	verifyWarm?(dir: string, specs: readonly S[]): Promise<boolean>;
	/** Validate and parse one raw spec into fields, or explain the refusal. */
	parseSpec(raw: string): LibSpecParse<S>;
	/** Install `specs` into `dir` (already created). Argv only, no shell. */
	install(dir: string, specs: readonly S[], run: RunArgv): Promise<void>;
}
