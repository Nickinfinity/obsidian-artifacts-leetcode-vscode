import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { escHtml } from '../../utils/html.helpers.js';
import type { LibInstaller, MavenLibSpec, RunArgv } from './lib-ecosystem.js';
import { parseMavenSpec } from './lib-spec.helpers.js';

/** Where `dependency:copy-dependencies` drops the jars, relative to the cache dir. */
export const JARS_SUBDIR = 'jars';

/** Coordinates of the generated project itself. Constants, never artifact-derived. */
const SELF = { groupId: 'dev.obsidianartifacts', artifactId: 'leet-libenv', version: '0.0.0' };

/**
 * One `<dependency>` element, every value escaped.
 *
 * Each segment already matched an anchored pattern that admits no `<`, `>`,
 * `&` or quote, so the escape can never fire — it is kept because a renderer
 * that *relies* on its input having been validated elsewhere is one refactor
 * away from being an injection point.
 *
 * @param spec - One parsed coordinate.
 * @returns The XML element, indented for the generated pom.
 *
 * @example
 * dependencyElement({ ecosystem: 'maven', groupId: 'com.google.guava',
 *   artifactId: 'guava', version: '33.3.1' });
 * // → '\t\t<dependency>\n\t\t\t<groupId>com.google.guava</groupId>…'
 */
function dependencyElement(spec: MavenLibSpec): string {
	const rows = [
		['groupId', spec.groupId],
		['artifactId', spec.artifactId],
		['version', spec.version],
		...(spec.packaging === undefined ? [] : [['type', spec.packaging]]),
		...(spec.classifier === undefined ? [] : [['classifier', spec.classifier]]),
	];
	const body = rows.map(([tag, value]) => `\t\t\t<${tag}>${escHtml(value)}</${tag}>`).join('\n');
	return `\t\t<dependency>\n${body}\n\t\t</dependency>`;
}

/**
 * Render a complete `pom.xml` declaring exactly these dependencies.
 *
 * No `<repositories>` element is ever emitted: an artifact cannot add a
 * registry, so resolution stays with whatever the developer's own Maven is
 * configured to trust.
 *
 * @param specs - Parsed coordinates, in declaration order.
 * @returns The pom text.
 *
 * @example
 * renderPomXml([{ ecosystem: 'maven', groupId: 'com.google.guava',
 *   artifactId: 'guava', version: '33.3.1' }]);
 * // → '<?xml version="1.0" encoding="UTF-8"?>\n<project …'
 */
export function renderPomXml(specs: readonly MavenLibSpec[]): string {
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<project xmlns="http://maven.apache.org/POM/4.0.0">',
		'\t<modelVersion>4.0.0</modelVersion>',
		`\t<groupId>${SELF.groupId}</groupId>`,
		`\t<artifactId>${SELF.artifactId}</artifactId>`,
		`\t<version>${SELF.version}</version>`,
		'\t<dependencies>',
		specs.map(dependencyElement).join('\n'),
		'\t</dependencies>',
		'</project>',
		'',
	].join('\n');
}

/**
 * The extension `dependency:copy-dependencies` gives a copied jar.
 *
 * Maven derives this from a coordinate's `type` through its own
 * `ArtifactHandler` registry, which for a handful of types (`test-jar`,
 * `java-source`, `javadoc`, `ejb-client`) rewrites both the extension *and*
 * the classifier rather than using the type text verbatim — e.g. a bare
 * `type: java-source` resolves to extension `jar` with an auto-added
 * `sources` classifier. Every other type resolves to itself (`jar` — the
 * default — plus `war`, `ear`, `pom`, `rar`, `par`, …), which is how a
 * sources/javadoc jar is actually addressed as a *dependency* in practice:
 * declared type `jar` with an explicit `sources`/`javadoc` classifier, the
 * same shape this installer's own fixture (`org.x:y:1.0:jar:sources`) uses.
 * Those four aliasing types are not resolved correctly here — declaring one
 * leaves the entry permanently cold rather than silently wrong, since the
 * probed filename is never the one Maven actually wrote.
 *
 * @param spec - One parsed coordinate.
 * @returns The extension `copy-dependencies` writes the jar with.
 */
function extensionFor(spec: MavenLibSpec): string {
	return spec.packaging ?? 'jar';
}

/**
 * The exact filename `dependency:copy-dependencies` writes for one
 * coordinate, under the plugin's own defaults — `stripVersion=false`,
 * `stripClassifier=false`, `prependGroupId=false` — confirmed against the
 * goal's parameter reference rather than assumed.
 *
 * @param spec - One parsed coordinate.
 * @returns e.g. `guava-33.3.1-jre.jar`, or `y-1.0-sources.jar` with a classifier.
 *
 * @example
 * jarFileName({ ecosystem: 'maven', groupId: 'com.google.guava',
 *   artifactId: 'guava', version: '33.3.1-jre' });
 * // → 'guava-33.3.1-jre.jar'
 */
function jarFileName(spec: MavenLibSpec): string {
	const classifier = spec.classifier === undefined ? '' : `-${spec.classifier}`;
	return `${spec.artifactId}-${spec.version}${classifier}.${extensionFor(spec)}`;
}

/**
 * The maven ecosystem's installer: a generated pom, resolved once, its jars
 * copied into one flat directory a `CLASSPATH` can point at.
 *
 * Maven rather than a hand-rolled Maven Central fetch, because a stock JDK
 * resolves nothing transitive: a direct fetch works until the first dependency
 * has dependencies of its own, after which you are writing a POM resolver.
 *
 * @example
 * await mavenInstaller.install('/cache/maven-9f2c', [guavaSpec], run);
 */
export const mavenInstaller: LibInstaller<MavenLibSpec> = {
	ecosystem: 'maven',
	relocatable: true,
	missingTool: 'mvn not found — install Maven to run library-backed Java exercises',

	// One path per copied jar, not the bare `jars/` directory: macOS prunes
	// `/var/folders` file by file, so a swept entry can keep the directory
	// while every jar inside it is gone — a directory probe proved nothing.
	warmPaths: specs => specs.map(spec => path.join(JARS_SUBDIR, jarFileName(spec))),

	parseSpec: parseMavenSpec,

	async install(dir: string, specs: readonly MavenLibSpec[], run: RunArgv): Promise<void> {
		const pom = path.join(dir, 'pom.xml');
		await fs.writeFile(pom, renderPomXml(specs), 'utf-8');
		await run(
			'mvn',
			['-q', '-f', pom, 'dependency:copy-dependencies',
				`-DoutputDirectory=${path.join(dir, JARS_SUBDIR)}`],
			dir,
		);
	},
};
