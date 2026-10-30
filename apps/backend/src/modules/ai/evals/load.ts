import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { EvalCase } from './case.js';

/** apps/backend/evals, the same path from src/ (tests, tsx) and dist/. */
export const EVALS_DIR = fileURLToPath(new URL('../../../../evals/', import.meta.url));

function yamlFiles(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return yamlFiles(path);
      return name.endsWith('.yaml') ? [path] : [];
    });
}

/** Parses and validates one case file; the error names the file. */
export function parseCase(source: string, file = 'case'): EvalCase {
  let raw: unknown;
  try {
    raw = parse(source);
  } catch (error) {
    throw new Error(`${file}: invalid YAML (${error instanceof Error ? error.message : error})`);
  }
  const result = EvalCase.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`${file}: ${issues}`);
  }
  return result.data;
}

/** Every case under `dir`, in file order. Throws on an invalid file or a duplicate id. */
export function loadCases(dir = EVALS_DIR): EvalCase[] {
  const seen = new Map<string, string>();
  return yamlFiles(dir).map((path) => {
    const file = relative(dir, path);
    const parsed = parseCase(readFileSync(path, 'utf8'), file);
    const first = seen.get(parsed.id);
    if (first) throw new Error(`${file}: duplicate case id "${parsed.id}" (also in ${first})`);
    seen.set(parsed.id, file);
    return parsed;
  });
}
