import AdmZip from 'adm-zip';

export interface ExtractedSkillPreview {
  name: string;
  description: string;
  body: string;
}

export class ExtractionError extends Error {}

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);
const MAX_BYTES = 256 * 1024;

function stripFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return text;
  const after = text.indexOf('\n', end + 4);
  return after === -1 ? '' : text.slice(after + 1);
}

/** A null byte anywhere in the first 8KB is a strong "this isn't text" signal. */
function looksBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8192).includes(0);
}

/**
 * Extract a skill preview (name/description/body) from a raw markdown/text
 * buffer. Pure — does not persist anything. Only the CORE content is kept:
 * an optional YAML frontmatter block is stripped, the first `# Heading`
 * becomes the default name, and the first non-empty paragraph after it
 * becomes the default description.
 */
export function extractFromText(buf: Buffer): ExtractedSkillPreview {
  if (buf.length > MAX_BYTES) throw new ExtractionError('File is too large (max 256KB)');
  if (looksBinary(buf)) throw new ExtractionError('File does not look like text');

  const raw = buf.toString('utf8');
  const body = stripFrontmatter(raw).trim();
  if (!body) throw new ExtractionError('File has no content after removing frontmatter');

  const headingMatch = body.match(/^#\s+(.+)$/m);
  const name = headingMatch ? headingMatch[1]!.trim() : 'Imported skill';

  const afterHeading = headingMatch
    ? body.slice(body.indexOf(headingMatch[0]) + headingMatch[0].length)
    : body;
  const firstParagraph = afterHeading
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p.length > 0 && !p.startsWith('#'));
  const description = firstParagraph ? firstParagraph.slice(0, 300) : '';

  return { name, description, body };
}

/**
 * Extract a skill preview from an uploaded archive. Only the FIRST
 * markdown/text entry found is read; every other entry (scripts, binaries,
 * anything executable) is ignored and never read, extracted to disk, or
 * executed — the archive is parsed entirely in memory and only text content
 * is returned to the caller for preview.
 */
export function extractFromArchive(buf: Buffer): ExtractedSkillPreview {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buf);
  } catch {
    throw new ExtractionError('Could not read archive');
  }
  const textEntry = zip
    .getEntries()
    .filter((e) => !e.isDirectory && !e.entryName.includes('..'))
    .find((e) => TEXT_EXTENSIONS.has(e.entryName.slice(e.entryName.lastIndexOf('.')).toLowerCase()));
  if (!textEntry) throw new ExtractionError('Archive has no markdown/text file to import');
  return extractFromText(textEntry.getData());
}
