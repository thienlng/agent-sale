import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanUntrustedText } from './safety.js';

/**
 * Platform skills shipped with this package: assistant-skills/<name>/SKILL.md
 * (works from src/agent and dist/agent, like PROMPTS_DIR).
 */
export const ASSISTANT_SKILLS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'assistant-skills',
);

export interface SkillDoc {
  name: string;
  description: string;
  toolsets: string[];
  version: number;
  body: string;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const NAME_MAX = 64;
const DESCRIPTION_MAX = 120;
const BODY_MAX = 8000;

function invalid(reason: string): Error {
  return new Error(`invalid_skill: ${reason}`);
}

function unquote(value: string): string {
  const v = value.trim();
  if (
    v.length >= 2 &&
    ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

function parseList(value: string): string[] {
  const v = value.trim();
  if (v === '') return [];
  if (!v.startsWith('[') || !v.endsWith(']')) throw invalid('toolsets must be an inline list');
  return v
    .slice(1, -1)
    .split(',')
    .map((s) => unquote(s))
    .filter((s) => s.length > 0);
}

/** Parses a SKILL.md: `---` front matter (name, description, toolsets, version), then the body. */
export function parseSkill(source: string): SkillDoc {
  const text = source.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') throw invalid('missing front matter');
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (end < 0) throw invalid('unterminated front matter');

  const fields = new Map<string, string>();
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) throw invalid(`bad front matter line "${line.trim()}"`);
    fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }

  const required = (key: string): string => {
    const value = fields.get(key);
    if (value === undefined) throw invalid(`missing ${key}`);
    return value;
  };
  const name = unquote(required('name'));
  const description = unquote(required('description'));
  const toolsets = parseList(required('toolsets'));
  const versionText = unquote(required('version'));
  if (!/^\d+$/.test(versionText)) throw invalid('version must be an integer');
  if (name === '') throw invalid('missing name');
  if (description === '') throw invalid('missing description');

  const body = lines
    .slice(end + 1)
    .join('\n')
    .trim();
  return { name, description, toolsets, version: Number(versionText), body };
}

/**
 * Neutralises in-app paths (`/app/...`), the only links a skill may contain.
 * The path ends at whitespace, quotes, brackets and at `?`, `=`, `:`, `@`,
 * `#`, `&`, so a query string or anything glued after it is still scanned.
 * The path segments stay in the text (split on `/`), so a phone number or an
 * email hidden in a segment is still flagged.
 */
function stripAppPaths(text: string): string {
  return text.replace(
    /(^|[\s(`'"[])\/app((?:\/[^\s)`'"\]?=:@#&]*)?)/g,
    (_match, lead: string, path: string) => `${lead}${path.split('/').join(' ')}`,
  );
}

/** Returns the problems with a skill; empty when it is clean. */
export function lintSkill(doc: SkillDoc): string[] {
  const problems: string[] = [];
  if (!NAME_RE.test(doc.name)) problems.push('name must match ^[a-z0-9][a-z0-9-]*$');
  if (doc.name.length > NAME_MAX) problems.push(`name longer than ${NAME_MAX} chars`);
  if (doc.description.length < 1 || doc.description.length > DESCRIPTION_MAX) {
    problems.push(`description must be 1-${DESCRIPTION_MAX} chars`);
  }
  if (doc.body.length > BODY_MAX) problems.push(`body longer than ${BODY_MAX} chars`);
  const scanned = stripAppPaths(
    [doc.name, doc.description, doc.toolsets.join(' '), doc.body].join('\n'),
  );
  const { issues } = scanUntrustedText(scanned);
  for (const issue of issues) problems.push(`safety: ${issue}`);
  return problems;
}

/** `- <name>: <description>` lines sorted by name; byte-stable for prompt caching. */
export function renderSkillIndex(skills: Pick<SkillDoc, 'name' | 'description'>[]): string {
  return [...skills]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((s) => `- ${s.name}: ${s.description}`)
    .join('\n');
}

/** Loads `<dir>/<name>/SKILL.md` for every subfolder, sorted by folder name. Throws on any bad skill. */
export async function loadSkillDir(dir: string): Promise<SkillDoc[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const folders = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const skills: SkillDoc[] = [];
  for (const folder of folders) {
    const source = await readFile(path.join(dir, folder, 'SKILL.md'), 'utf8');
    let doc: SkillDoc;
    try {
      doc = parseSkill(source);
    } catch (err) {
      throw invalid(`${folder}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (doc.name !== folder)
      throw invalid(`${folder}: name "${doc.name}" does not match its folder`);
    const problems = lintSkill(doc);
    if (problems.length > 0) throw invalid(`${folder}: ${problems.join('; ')}`);
    skills.push(doc);
  }
  return skills;
}
