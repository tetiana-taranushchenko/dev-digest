import AdmZip from 'adm-zip';

export interface ExtractedSkillPreview {
  name: string;
  description: string;
  body: string;
}

export class ExtractionError extends Error {}

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);
const MAX_BYTES = 256 * 1024;

interface ParsedText {
  body: string;
  name?: string;
  description?: string;
}

function unquoteYamlScalar(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function frontmatterScalar(frontmatter: string, key: 'name' | 'description'): string | undefined {
  const lines = frontmatter.split(/\r?\n/);
  const prefix = `${key}:`;
  const index = lines.findIndex((line) => line.startsWith(prefix));
  if (index === -1) return undefined;

  const raw = lines[index]!.slice(prefix.length).trim();
  if (/^[>|][+-]?$/.test(raw)) {
    const block: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor]!;
      if (!line.trim()) {
        block.push('');
        continue;
      }
      const indented = line.match(/^[ \t]+(.*)$/);
      if (!indented) break;
      block.push(indented[1]!.trimEnd());
    }
    const value = raw.startsWith('>')
      ? block.join(' ').replace(/\s+/g, ' ').trim()
      : block.join('\n').trim();
    return value || undefined;
  }

  const value = unquoteYamlScalar(raw).trim();
  return value || undefined;
}

function parseText(text: string): ParsedText {
  const normalized = text.replace(/^\uFEFF/, '');
  const match = normalized.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return { body: normalized };
  const frontmatter = match[1] ?? '';
  return {
    body: normalized.slice(match[0].length),
    name: frontmatterScalar(frontmatter, 'name'),
    description: frontmatterScalar(frontmatter, 'description'),
  };
}

/** A null byte anywhere in the first 8KB is a strong "this isn't text" signal. */
function looksBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8192).includes(0);
}

/**
 * Extract a skill preview (name/description/body) from a raw markdown/text
 * buffer. Pure — does not persist anything. Only the CORE content is kept:
 * an optional YAML frontmatter block is parsed and stripped. Its `name` and
 * `description` fields win; a first `# Heading` and first body paragraph are
 * used only as fallbacks for ordinary markdown files without metadata.
 */
export function extractFromText(buf: Buffer): ExtractedSkillPreview {
  if (buf.length > MAX_BYTES) throw new ExtractionError('File is too large (max 256KB)');
  if (looksBinary(buf)) throw new ExtractionError('File does not look like text');

  const parsed = parseText(buf.toString('utf8'));
  const body = parsed.body.trim();
  if (!body) throw new ExtractionError('File has no content after removing frontmatter');

  const headingMatch = body.match(/^#\s+(.+)$/m);
  const name = parsed.name ?? (headingMatch ? headingMatch[1]!.trim() : 'Imported skill');

  const afterHeading = headingMatch
    ? body.slice(body.indexOf(headingMatch[0]) + headingMatch[0].length)
    : body;
  const firstParagraph = afterHeading
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p.length > 0 && !p.startsWith('#'));
  const description = parsed.description ?? (firstParagraph ? firstParagraph.slice(0, 300) : '');

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
