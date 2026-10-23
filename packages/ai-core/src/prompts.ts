import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Prompts are versioned files: prompts/<name>@<version>.md. Changing a prompt
 * means a new version + running the evals (Rule 05). The registry never
 * silently picks "latest" in production — callers pin a version.
 */
export interface PromptRef {
  name: string;
  version: number;
}

export class PromptRegistry {
  readonly #cache = new Map<string, string>();

  constructor(private readonly dir: string) {}

  key(ref: PromptRef): string {
    return `${ref.name}@${ref.version}`;
  }

  async load(ref: PromptRef): Promise<string> {
    const key = this.key(ref);
    const cached = this.#cache.get(key);
    if (cached !== undefined) return cached;
    const file = path.join(this.dir, `${key}.md`);
    const text = await readFile(file, 'utf8');
    this.#cache.set(key, text);
    return text;
  }

  /** Simple `{{placeholder}}` substitution; missing values throw (no silent blanks). */
  render(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, name: string) => {
      const value = vars[name];
      if (value === undefined) throw new Error(`prompt placeholder not provided: ${name}`);
      return value;
    });
  }
}
