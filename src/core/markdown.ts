/** Pure helpers for finding Markdown and wiki links on a line of text. */

export interface Span {
  start: number;
  end: number;
}

export interface WikiLink extends Span {
  /** Note name or path, without the `#heading` and `|alias` parts. May be empty for `[[#Heading]]`. */
  target: string;
  heading?: string;
}

export interface MarkdownLink extends Span {
  href: string;
}

export interface ReferenceLink extends Span {
  ref: string;
}

const WIKI_LINK = /!?\[\[([^\[\]|#]*)(?:#([^\[\]|]*))?(?:\|[^\[\]]*)?\]\]/g;
// [text](href "title") — text may contain one level of nested brackets, href may contain balanced parens.
const INLINE_LINK =
  /!?\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\(\s*(<[^>\n]*>|(?:[^\s()]|\([^\s()]*\))*)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const AUTOLINK = /<((?:[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)|(?:[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+))>/g;
const FULL_REFERENCE = /!?\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\[([^\[\]]*)\]/g;
const SHORTCUT_REFERENCE = /(?<![\]\\])\[([^\[\]]+)\](?![\[(:])/g;
const REFERENCE_DEFINITION = /^ {0,3}\[([^\]]+)\]:\s*(<[^>\n]*>|\S+)/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

function* matchesAt(regex: RegExp, line: string, ch: number): Generator<RegExpExecArray> {
  regex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(line))) {
    if (m.index <= ch && ch < m.index + m[0].length) {
      yield m;
    }
    if (m[0].length === 0) {
      regex.lastIndex++;
    }
  }
}

function first<T>(gen: Generator<T>): T | undefined {
  for (const value of gen) {
    return value;
  }
  return undefined;
}

export function findWikiLinkAt(line: string, ch: number): WikiLink | undefined {
  const m = first(matchesAt(WIKI_LINK, line, ch));
  if (!m) {
    return undefined;
  }
  const target = m[1].trim();
  const heading = m[2]?.trim();
  if (!target && !heading) {
    return undefined;
  }
  return { start: m.index, end: m.index + m[0].length, target, heading: heading || undefined };
}

/** `[text](href)`, `![alt](src)` and `<https://autolinks>` — anywhere on the link, including its text. */
export function findMarkdownLinkAt(line: string, ch: number): MarkdownLink | undefined {
  const m = first(matchesAt(INLINE_LINK, line, ch));
  let best: MarkdownLink | undefined = m && { start: m.index, end: m.index + m[0].length, href: stripAngles(m[2]) };
  // In `[![badge](img)](url)` the outer match swallows the image, so look inside it for the innermost link.
  if (best) {
    const inner = findMarkdownLinkAt(line.slice(best.start + 1, best.end), ch - best.start - 1);
    if (inner) {
      best = { start: inner.start + best.start + 1, end: inner.end + best.start + 1, href: inner.href };
    }
  }
  if (best && best.href) {
    return best;
  }
  const auto = first(matchesAt(AUTOLINK, line, ch));
  if (auto) {
    const href = auto[1].includes(':') ? auto[1] : `mailto:${auto[1]}`;
    return { start: auto.index, end: auto.index + auto[0].length, href };
  }
  return undefined;
}

/** `[text][ref]`, `[ref][]` and shortcut `[ref]` references. */
export function findReferenceLinkAt(line: string, ch: number): ReferenceLink | undefined {
  const full = first(matchesAt(FULL_REFERENCE, line, ch));
  if (full) {
    return { start: full.index, end: full.index + full[0].length, ref: full[2] || full[1] };
  }
  const shortcut = first(matchesAt(SHORTCUT_REFERENCE, line, ch));
  if (shortcut) {
    return { start: shortcut.index, end: shortcut.index + shortcut[0].length, ref: shortcut[1] };
  }
  return undefined;
}

/** The URL of a `[ref]: url` definition line, when the click is on that line. */
export function findReferenceDefinitionOnLine(line: string): string | undefined {
  const m = REFERENCE_DEFINITION.exec(line);
  return m ? stripAngles(m[2]) : undefined;
}

export function findReferenceDefinition(text: string, ref: string): string | undefined {
  const wanted = normalizeLabel(ref);
  for (const line of text.split(/\r?\n/)) {
    const m = REFERENCE_DEFINITION.exec(line);
    if (m && normalizeLabel(m[1]) === wanted) {
      return stripAngles(m[2]);
    }
  }
  return undefined;
}

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

function stripAngles(href: string): string {
  return href.startsWith('<') && href.endsWith('>') ? href.slice(1, -1) : href;
}

/** GitHub-style heading slug: `## Hello, World!` → `hello-world`. */
export function slugify(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/**
 * Finds the 0-based line of the heading a fragment refers to. Accepts GitHub slugs
 * (`#my-heading`, `#my-heading-1` for duplicates) and raw heading text (`[[Note#My Heading]]`).
 */
export function findHeadingLine(text: string, fragment: string): number | undefined {
  let decoded = fragment;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    // keep the raw fragment
  }
  const wantedSlug = slugify(decoded);
  const wantedText = decoded.trim().toLowerCase();
  const seen = new Map<string, number>();
  let fence: string | undefined;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const fenceMatch = FENCE.exec(lines[i]);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) {
        fence = marker;
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = undefined;
      }
      continue;
    }
    if (fence) {
      continue;
    }
    const m = HEADING.exec(lines[i]);
    if (!m) {
      continue;
    }
    const title = m[2];
    const base = slugify(title);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const slug = count === 0 ? base : `${base}-${count}`;
    if (slug === wantedSlug || title.trim().toLowerCase() === wantedText) {
      return i;
    }
  }
  return undefined;
}

export interface LinePosition {
  /** 1-based. */
  line: number;
  /** 1-based. */
  column?: number;
}

/** Parses `L10`, `L10C5`, `L10-L20`, `10`, `10:5` and `10,5` fragments. */
export function parseLineFragment(fragment: string): LinePosition | undefined {
  const m = /^L?(\d+)(?:[,:]|C)?(\d+)?(?:-L?\d+(?:C\d+)?)?$/i.exec(fragment);
  if (!m) {
    return undefined;
  }
  const line = Number(m[1]);
  if (line < 1) {
    return undefined;
  }
  return { line, column: m[2] ? Number(m[2]) : undefined };
}

function* allMatches(regex: RegExp, line: string): Generator<Span> {
  regex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(line))) {
    if (m[0].length === 0) {
      regex.lastIndex++;
      continue;
    }
    yield { start: m.index, end: m.index + m[0].length };
  }
}

/** Every Markdown/wiki link on a line, for listing links in a file. */
export function markdownSpans(line: string): Span[] {
  const definition = REFERENCE_DEFINITION.exec(line);
  return [
    ...allMatches(WIKI_LINK, line),
    ...allMatches(INLINE_LINK, line),
    ...allMatches(AUTOLINK, line),
    ...allMatches(FULL_REFERENCE, line),
    ...(definition ? [{ start: 0, end: definition[0].length }] : []),
  ];
}

export interface ExtractedLink {
  /** 0-based line. */
  line: number;
  start: number;
  end: number;
  /** `path` for Markdown hrefs and reference definitions, `wiki` for `[[wiki links]]`. */
  kind: 'path' | 'wiki';
  /** The href without its `#fragment`, or the wiki note name. */
  target: string;
}

/** All links to local files in a Markdown document, skipping fenced code blocks and external URLs. */
export function extractLinks(text: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  let fence: string | undefined;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) {
        fence = marker;
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = undefined;
      }
      continue;
    }
    if (fence) {
      continue;
    }
    const addPath = (start: number, end: number, href: string) => {
      const target = stripAngles(href).split('#')[0];
      if (target && !/^[a-z][\w+.-]*:/i.test(target)) {
        links.push({ line: i, start, end, kind: 'path', target });
      }
    };
    WIKI_LINK.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKI_LINK.exec(line))) {
      if (m[1].trim()) {
        links.push({ line: i, start: m.index, end: m.index + m[0].length, kind: 'wiki', target: m[1].trim() });
      }
    }
    INLINE_LINK.lastIndex = 0;
    while ((m = INLINE_LINK.exec(line))) {
      addPath(m.index, m.index + m[0].length, m[2]);
      // An image nested in a link's text: [![alt](img.png)](page.md)
      const inner = /!\[[^\]]*\]\(([^)\s]+)/.exec(m[1]);
      if (inner) {
        addPath(m.index, m.index + m[0].length, inner[1]);
      }
    }
    const definition = REFERENCE_DEFINITION.exec(line);
    if (definition) {
      addPath(0, definition[0].length, definition[2]);
    }
  }
  return links;
}
