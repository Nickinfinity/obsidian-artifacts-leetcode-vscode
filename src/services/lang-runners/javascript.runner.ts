import type { LangRunner } from './runner.types.js';

/**
 * `LangRunner` for JavaScript executed via the system `node` binary.
 *
 * @example
 * jsRunner.run('/tmp/leet/sol.js'); // 'node /tmp/leet/sol.js'
 */
export const jsRunner: LangRunner = {
	id:            'javascript',
	displayName:   'JavaScript',
	fileExtension: '.js',
	run:           (filePath: string) => `node ${filePath}`,
	detectCmd:     'node --version',
};
