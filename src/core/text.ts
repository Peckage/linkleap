/** Pure helpers for finding URLs, file paths and custom-pattern matches on a line of text. */

import { LinePosition, Span } from './markdown';

export interface PathMatch extends Span {
  /** Candidate paths to try, most likely first. */
  candidates: string[];
  position?: LinePosition;
}

export interface PatternRule {
  name?: string;
  pattern: string;
  flags?: string;
  target: string;
  languages?: string[];
}

export interface PatternMatch extends Span {
  target: string;
  name?: string;
}

const URL_RE = /\b(?:(?:https?|ftp|file|vscode|vscode-insiders):\/\/|mailto:|www\.)[^\s<>"'`]+/gi;
const PATH_CHARS = /[^\s"'`<>|()[\]{},;*?]/;
const TRAILING_PUNCTUATION = /[.,:;!?]+$/;

function spanAt(regex: RegExp, line: string, ch: number): RegExpExecArray | undefined {
  regex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(line))) {
    if (m.index <= ch && ch < m.index + m[0].length) {
      return m;
    }
    if (m[0].length === 0) {
      regex.lastIndex++;
    }
  }
  return undefined;
}

/** Drops trailing sentence punctuation and closing brackets that have no opening partner. */
function trimUrl(url: string): string {
  let result = url.replace(TRAILING_PUNCTUATION, '');
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
    while (result.endsWith(close) && count(result, open) < count(result, close)) {
      result = result.slice(0, -1).replace(TRAILING_PUNCTUATION, '');
    }
  }
  return result;
}

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

export function findUrlAt(line: string, ch: number): (Span & { url: string }) | undefined {
  const m = spanAt(URL_RE, line, ch);
  if (!m) {
    return undefined;
  }
  const raw = trimUrl(m[0]);
  if (ch >= m.index + raw.length) {
    return undefined;
  }
  const url = /^www\./i.test(raw) ? `https://${raw}` : raw;
  return { start: m.index, end: m.index + raw.length, url };
}

/**
 * Finds something that looks like a file path around `ch`, e.g. `src/app.ts`, `./a/b.md:12:5`,
 * `C:\x\y.cs(10,3)`, `~/notes.txt` or `a/src/x.ts` from a git diff. The caller decides
 * which candidate actually exists.
 */
export function findPathAt(line: string, ch: number): PathMatch | undefined {
  if (ch < 0 || ch >= line.length || !PATH_CHARS.test(line[ch])) {
    return undefined;
  }
  let start = ch;
  let end = ch + 1;
  while (start > 0 && PATH_CHARS.test(line[start - 1])) {
    start--;
  }
  while (end < line.length && PATH_CHARS.test(line[end])) {
    end++;
  }
  let token = line.slice(start, end);
  if (/^[a-z][\w+.-]*:\/\//i.test(token)) {
    return undefined;
  }

  // Drop sentence punctuation, but keep a trailing `:12` line suffix intact.
  const trimmed = token.replace(/[.,:;!?]+$/, '');
  end -= token.length - trimmed.length;
  token = trimmed;

  let position: LinePosition | undefined;
  // file.ts:12:5 / file.ts:12 / file.ts#L12
  const suffix = /^(.+?)(?::(\d+)(?::(\d+))?|#L(\d+)(?:C(\d+))?)$/.exec(token);
  if (suffix && !/^[A-Za-z]$/.test(suffix[1])) {
    token = suffix[1];
    position = {
      line: Number(suffix[2] ?? suffix[4]),
      column: suffix[3] ?? suffix[5] ? Number(suffix[3] ?? suffix[5]) : undefined,
    };
  } else {
    // file.cs(12,5) / file.py(12) — MSBuild and friends
    const paren = /^\((\d+)(?:,(\d+))?\)/.exec(line.slice(end));
    if (paren) {
      position = { line: Number(paren[1]), column: paren[2] ? Number(paren[2]) : undefined };
    }
  }

  const looksLikePath = /[\\/]/.test(token) || /\.[A-Za-z0-9]{1,10}$/.test(token);
  if (!looksLikePath || /^[.\\/]+$/.test(token) || ch >= end) {
    return undefined;
  }

  const candidates = [token];
  // git diff headers: `--- a/src/x.ts` / `+++ b/src/x.ts`
  const diffPrefix = /^[ab]\/(.+)$/.exec(token);
  if (diffPrefix) {
    candidates.push(diffPrefix[1]);
  }
  return { start, end, candidates, position: position && position.line > 0 ? position : undefined };
}

export interface TemplateVariables {
  workspaceFolder?: string;
  file?: string;
  fileDirname?: string;
}

/** Expands `$0`–`$9`, `${1}` and `${workspaceFolder}`-style variables in a pattern target. */
export function expandTemplate(template: string, groups: readonly (string | undefined)[], vars: TemplateVariables): string {
  return template.replace(/\$\{(\w+)\}|\$(\d)/g, (whole, name: string | undefined, digit: string | undefined) => {
    const key = name ?? digit!;
    if (/^\d+$/.test(key)) {
      return groups[Number(key)] ?? '';
    }
    const value = vars[key as keyof TemplateVariables];
    return value ?? whole;
  });
}

export function compileRule(rule: PatternRule): RegExp {
  const flags = new Set((rule.flags ?? '').replace(/[gy]/g, ''));
  flags.add('g');
  return new RegExp(rule.pattern, [...flags].join(''));
}

export function findPatternAt(
  line: string,
  ch: number,
  rules: readonly { rule: PatternRule; regex: RegExp }[],
  vars: TemplateVariables,
): PatternMatch | undefined {
  for (const { rule, regex } of rules) {
    const m = spanAt(regex, line, ch);
    if (m) {
      return {
        start: m.index,
        end: m.index + m[0].length,
        target: expandTemplate(rule.target, [...m], vars),
        name: rule.name,
      };
    }
  }
  return undefined;
}

/** Every URL and custom-pattern match on a line, for listing links in a file. */
export function textSpans(line: string, rules: readonly { regex: RegExp }[]): Span[] {
  const spans: Span[] = [];
  for (const regex of [URL_RE, ...rules.map((r) => r.regex)]) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(line))) {
      if (m[0].length === 0) {
        regex.lastIndex++;
        continue;
      }
      const end = regex === URL_RE ? m.index + trimUrl(m[0]).length : m.index + m[0].length;
      spans.push({ start: m.index, end });
    }
  }
  return spans;
}

/** Drops spans that sit inside a longer one, and sorts the rest by position. */
export function outermostSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const result: Span[] = [];
  for (const span of sorted) {
    const last = result[result.length - 1];
    if (last && span.start >= last.start && span.end <= last.end) {
      continue;
    }
    result.push(span);
  }
  return result;
}
