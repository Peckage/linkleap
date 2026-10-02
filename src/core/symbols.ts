/** Pure helpers for spotting code symbols mentioned in prose, like `parseConfig()` or `UserService`. */

import { Span } from './markdown';

export interface SymbolRef extends Span {
  name: string;
  /** The qualifier before the name, e.g. `UserService` in `UserService.find`. */
  container?: string;
}

const BACKTICKS = /`([^`\n]+)`/g;
const IDENTIFIER_PATH = /^[A-Za-z_$][\w$]*(?:(?:\.|::|#|->)[A-Za-z_$][\w$]*)*$/;
const IDENTIFIER = /[A-Za-z_$][\w$]*/g;

/** Words that are code-shaped enough to be worth a symbol lookup outside backticks. */
export function looksLikeCode(word: string, followedByParen: boolean): boolean {
  return (
    followedByParen ||
    /[a-z][A-Z]/.test(word) || // camelCase / PascalCase with two humps
    /^[A-Z]{2,}[a-z]/.test(word) || // HTTPServer
    /[A-Za-z0-9]_[A-Za-z0-9]/.test(word) // snake_case
  );
}

function fromPath(path: string, strict: boolean): Pick<SymbolRef, 'name' | 'container'> | undefined {
  const trimmed = path.trim();
  const cleaned = trimmed.replace(/\(.*\)$/, '').replace(/<.*>$/, '');
  if (!IDENTIFIER_PATH.test(cleaned)) {
    return undefined;
  }
  const parts = cleaned.split(/\.|::|#|->/);
  const name = parts[parts.length - 1];
  // In code, backticks are also template strings and shell commands, so a lone plain word isn't enough.
  if (strict && parts.length === 1 && !looksLikeCode(name, cleaned !== trimmed)) {
    return undefined;
  }
  return { name, container: parts.length > 1 ? parts[parts.length - 2] : undefined };
}

/**
 * Finds a symbol reference at `ch`. In prose (Markdown, plain text) any identifier in backticks
 * counts, and so do code-shaped words outside them. In code, only code-shaped text in backticks counts.
 */
export function findSymbolRefAt(line: string, ch: number, prose: boolean): SymbolRef | undefined {
  BACKTICKS.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BACKTICKS.exec(line))) {
    if (m.index <= ch && ch < m.index + m[0].length) {
      const symbol = fromPath(m[1], !prose);
      return symbol && { start: m.index, end: m.index + m[0].length, ...symbol };
    }
  }
  if (!prose) {
    return undefined;
  }
  IDENTIFIER.lastIndex = 0;
  while ((m = IDENTIFIER.exec(line))) {
    const end = m.index + m[0].length;
    if (m.index <= ch && ch < end) {
      return looksLikeCode(m[0], line[end] === '(') ? { start: m.index, end, name: m[0] } : undefined;
    }
  }
  return undefined;
}

const DECLARATION_KEYWORDS =
  'function|class|interface|type|enum|struct|trait|impl|def|fn|func|sub|module|namespace|object|record|protocol|const|let|var|val';

/**
 * Matches a line that declares `name` in most C-like, scripting and functional languages,
 * e.g. `export async function name(`, `class Name`, `def name(`, `fn name<`, `func (r *R) Name(`.
 */
export function declarationPattern(name: string): RegExp {
  const escaped = name.replace(/[$]/g, '\\$');
  return new RegExp(
    `(?:\\b(?:${DECLARATION_KEYWORDS})\\s+\\*?|\\bfunc\\s*\\([^)]*\\)\\s*)${escaped}(?![\\w$])`,
  );
}
