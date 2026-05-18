import * as path from 'node:path';
import type { LangRunner } from './runner.types.js';

/**
 * `LangRunner` for Java.
 *
 * The source file is always written as `Main.java` so that `class Main` (the
 * conventional class in our generated boilerplate) compiles cleanly. The `run`
 * command sets `-cp` to the file's directory so `java Main` resolves to the
 * compiled artifact regardless of the caller's `cwd`.
 *
 * @example
 * javaRunner.compile('/tmp/leet/Main.java'); // 'javac /tmp/leet/Main.java'
 * javaRunner.run('/tmp/leet/Main.java');     // 'java -cp /tmp/leet Main'
 */
export const javaRunner: LangRunner = {
	id:            'java',
	displayName:   'Java',
	fileExtension: '.java',
	fileName:      'Main.java',
	compile:       (filePath: string) => `javac ${filePath}`,
	run:           (filePath: string) => `java -cp ${path.dirname(filePath)} Main`,
	detectCmd:     'java --version',
};
