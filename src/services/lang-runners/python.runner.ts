import type { LangRunner } from './runner.types.js';

/**
 * `LangRunner` for Python executed via the system `python3` binary.
 *
 * @example
 * pythonRunner.run('/tmp/leet/sol.py'); // 'python3 /tmp/leet/sol.py'
 */
export const pythonRunner: LangRunner = {
	id:            'python',
	displayName:   'Python',
	fileExtension: '.py',
	run:           (filePath: string) => `python3 ${filePath}`,
	detectCmd:     'python3 --version',
};
