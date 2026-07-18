import { FENCE } from '../types/constants.js';
import { sectionBounds, type SectionBounds } from './leetcode-section-bounds.helpers.js';
import { resolveLangId } from './language-map.service.js';

const ATTEMPTS_HEADING_RE  = /^# Attempts\s*$/m;
const SOLUTIONS_HEADING_RE = /^# Solutions\s*$/m;
const TOP_BOUNDARY_RE      = /^# /m;
const SUB_HEADING_RE       = /^## (.+)\r?\n/gm;

/**
 * One run to append to an artifact's `# Attempts` section — the writer-side
 * counterpart of `Attempt` (no `language`; that comes from the `langId`
 * argument to `appendAttempt`, resolved to canonical the same way).
 */
export interface AttemptEntry {
	/** ISO-8601 timestamp of the run */
	at: string;
	/** Human-readable elapsed time, e.g. `'8m22s'` */
	duration: string;
	/** True when every case (public + final) passed on this run */
	passed: boolean;
	/** Big-O notation from `estimateBigO`, when computed for this run */
	bigO?: string;
	/** Confidence tier of the Big-O estimate, when computed */
	confidence?: string;
	/** The submitted buffer, verbatim */
	code: string;
}

/**
 * Appends one attempt entry to an artifact's `# Attempts` section — newest
 * entry first, one `## <Language>` subsection per canonical language id.
 *
 * Creates the `# Attempts` section when absent, placed immediately after
 * `# Solutions` (or at end of file when there is no `# Solutions` section).
 * When the section already exists, the entry is prepended under the matching
 * `## <Language>` heading, created fresh if this is the language's first
 * recorded attempt. Existing headings are matched by resolving both sides
 * through `resolveLangId`, so an aliased heading (`## JS`) still receives a
 * `javascript` attempt rather than spawning a duplicate `## javascript`
 * heading alongside it.
 *
 * Every edit is a pure index splice bracketing the `# Attempts` section (or
 * one `## <Language>` chunk within it) — `# Setup`, `# Solutions`, and
 * `## Tests` are never read past their bounds and come back byte-identical.
 *
 * @param raw    - Full `.md` artifact content.
 * @param langId - Language id for the run; resolved to canonical via `resolveLangId`.
 * @param entry  - The attempt to record.
 * @returns The patched `.md` content.
 *
 * @example
 * appendAttempt(raw, 'python', {
 *   at: '2026-07-10T14:32:00Z', duration: '8m22s', passed: true, code: 'def f(): ...',
 * });
 */
export function appendAttempt(raw: string, langId: string, entry: AttemptEntry): string {
	const canonical = resolveLangId(langId);
	const block = renderEntryBlock(canonical, entry);

	const section = sectionBounds(raw, ATTEMPTS_HEADING_RE, TOP_BOUNDARY_RE);
	if (!section) { return insertNewAttemptsSection(raw, canonical, block); }
	return insertIntoAttemptsSection(raw, section, canonical, block);
}

// ── Inserting a brand-new `# Attempts` section ─────────────────────────────────

/** Build the whole-file result when no `# Attempts` section exists yet. */
function insertNewAttemptsSection(raw: string, canonical: string, block: string): string {
	const solutions = sectionBounds(raw, SOLUTIONS_HEADING_RE, TOP_BOUNDARY_RE);
	const atIndex = solutions ? solutions.bodyEnd : raw.length;
	const sectionText = `# Attempts\n\n## ${canonical}\n${block}`;
	return spliceIn(raw, atIndex, sectionText);
}

// ── Extending an existing `# Attempts` section ─────────────────────────────────

/** Build the whole-file result when a `# Attempts` section already exists. */
function insertIntoAttemptsSection(raw: string, section: SectionBounds, canonical: string, block: string): string {
	const body  = raw.slice(section.headingEnd, section.bodyEnd);
	const chunk = findLanguageChunk(body, canonical);

	if (!chunk) {
		const newChunk = `## ${canonical}\n${block}`;
		return spliceIn(raw, section.bodyEnd, newChunk);
	}

	const insertAt = section.headingEnd + chunk.entriesStart;
	const before = raw.slice(0, insertAt);
	const after  = raw.slice(insertAt);
	const glue   = chunk.hasEntries ? '\n' : '';
	return `${before}${block}${glue}${after}`;
}

/** Bounds of one `## <Language>` chunk within an Attempts-section body. */
interface LangChunk {
	/** Offset (relative to the section body) right after the heading line — where entries start */
	entriesStart: number;
	/** Whether the chunk already carries at least one attempt entry */
	hasEntries: boolean;
}

/**
 * Find the `## <Language>` chunk matching `canonical`, comparing headings
 * through `resolveLangId` so an aliased heading (`## JS`) is still recognised
 * as the same language as a canonical `langId` of `'javascript'`.
 *
 * @param body      - Attempts-section body (between its heading and the next top-level heading).
 * @param canonical - Canonical language id to match.
 * @returns The chunk's bounds, or `null` when no heading matches.
 *
 * @example
 * findLanguageChunk('## JS\n```javascript\n…\n```\n', 'javascript');
 * // → { entriesStart: 6, hasEntries: true }
 */
function findLanguageChunk(body: string, canonical: string): LangChunk | null {
	const headings: { start: number; entriesStart: number; lang: string }[] = [];
	const re = new RegExp(SUB_HEADING_RE.source, SUB_HEADING_RE.flags);
	for (let m = re.exec(body); m !== null; m = re.exec(body)) {
		headings.push({ start: m.index, entriesStart: m.index + m[0].length, lang: resolveLangId(m[1].trim()) });
	}

	const idx = headings.findIndex(h => h.lang === canonical);
	if (idx === -1) { return null; }

	const end = idx + 1 < headings.length ? headings[idx + 1].start : body.length;
	const hasEntries = body.slice(headings[idx].entriesStart, end).trim().length > 0;
	return { entriesStart: headings[idx].entriesStart, hasEntries };
}

// ── Rendering ─────────────────────────────────────────────────────────────────

/** Render one `<!-- attempt: … --> + fence` block; ends with a single trailing newline. */
function renderEntryBlock(canonical: string, entry: AttemptEntry): string {
	const comment = renderAttemptComment(entry);
	const code = entry.code.trimEnd();
	return `${comment}\n${FENCE}${canonical}\n${code}\n${FENCE}\n`;
}

/** Render the `<!-- attempt: { … } -->` comment; optional fields are omitted, never `null`-padded. */
function renderAttemptComment(entry: AttemptEntry): string {
	const meta: Record<string, unknown> = { at: entry.at, duration: entry.duration, passed: entry.passed };
	if (entry.bigO !== undefined)       { meta.bigO = entry.bigO; }
	if (entry.confidence !== undefined) { meta.confidence = entry.confidence; }
	return `<!-- attempt: ${JSON.stringify(meta)} -->`;
}

// ── Splicing ──────────────────────────────────────────────────────────────────

/**
 * Insert `text` at `atIndex`, adding a blank line before it (unless one is
 * already there) and a newline after it (unless the following content already
 * starts with one) — so a newly inserted section/chunk never collides with
 * its neighbours.
 *
 * @param raw     - Full file content.
 * @param atIndex - Byte offset to insert at.
 * @param text    - Text to insert (already newline-terminated internally).
 * @returns The spliced content.
 *
 * @example
 * spliceIn('# Solutions\n…\n', 12, '# Attempts\n\n## java\n…\n');
 */
function spliceIn(raw: string, atIndex: number, text: string): string {
	const before = raw.slice(0, atIndex);
	const after  = raw.slice(atIndex);
	return `${before}${leadingSeparator(before)}${text}${trailingSeparator(after)}${after}`;
}

/** Blank line before inserted text, unless `before` already ends in one (or is empty). */
function leadingSeparator(before: string): string {
	if (before.length === 0 || before.endsWith('\n\n')) { return ''; }
	return before.endsWith('\n') ? '\n' : '\n\n';
}

/** Single newline after inserted text, unless `after` already starts with one (or is empty). */
function trailingSeparator(after: string): string {
	if (after.length === 0 || after.startsWith('\n')) { return ''; }
	return '\n';
}
