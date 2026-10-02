import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { patternRules, PROSE_LANGUAGES, settings, TargetKind } from './config';
import { findIssueRefAt, issueUrl } from './core/issues';
import {
  findMarkdownLinkAt,
  findReferenceDefinition,
  findReferenceDefinitionOnLine,
  findReferenceLinkAt,
  findWikiLinkAt,
  LinePosition,
  parseLineFragment,
} from './core/markdown';
import { declarationPattern, findSymbolRefAt } from './core/symbols';
import { findPathAt, findPatternAt, findUrlAt } from './core/text';
import { remoteFor } from './git';

interface LeapBase {
  /** Which target kind found it. */
  source: TargetKind;
}

/** Something a double-click can open. */
export type Leap = LeapBase &
  (
    | { kind: 'uri'; uri: vscode.Uri; position?: LinePosition; heading?: string; name?: string }
    | { kind: 'definitions'; locations: vscode.Location[] }
    /** A link VS Code knows about but hasn't resolved; let `editor.action.openLink` handle it. */
    | { kind: 'builtin' }
    | { kind: 'missingNote'; name: string; folder: vscode.Uri }
  );

type Resolver = (
  document: vscode.TextDocument,
  position: vscode.Position,
  options: ResolveOptions,
) => Promise<Leap | undefined>;

export interface ResolveOptions {
  /** Only consider these kinds; defaults to the configured `linkleap.targets` for the document. */
  targets?: readonly TargetKind[];
  /** Skip slow fallbacks (scanning source files) because this is only for a hover. */
  quick?: boolean;
}

export async function resolveLeap(
  document: vscode.TextDocument,
  position: vscode.Position,
  options: ResolveOptions = {},
): Promise<Leap | undefined> {
  const targets = options.targets ?? settings(document).targets;
  for (const target of targets) {
    try {
      const leap = await RESOLVERS[target](document, position, options);
      if (leap) {
        return leap;
      }
    } catch (err) {
      console.error(`[LinkLeap] ${target} resolver failed`, err);
    }
  }
  return undefined;
}

const RESOLVERS: Record<TargetKind, Resolver> = {
  async patterns(document, position) {
    const rules = patternRules(document);
    if (!rules.length) {
      return undefined;
    }
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    const match = findPatternAt(document.lineAt(position.line).text, position.character, rules, {
      workspaceFolder: folder?.uri.fsPath,
      file: document.uri.scheme === 'file' ? document.uri.fsPath : undefined,
      fileDirname: document.uri.scheme === 'file' ? path.dirname(document.uri.fsPath) : undefined,
    });
    if (!match || !match.target) {
      return undefined;
    }
    const leap = hrefToLeap(match.target, document, { relativeTo: 'workspace', source: 'patterns' });
    return leap && leap.kind === 'uri' ? { ...leap, name: match.name } : leap;
  },

  async markdown(document, position) {
    const line = document.lineAt(position.line).text;
    const ch = position.character;
    const inline = findMarkdownLinkAt(line, ch);
    if (inline) {
      return hrefToLeap(inline.href, document, { relativeTo: 'document', source: 'markdown' });
    }
    const definition = findReferenceDefinitionOnLine(line);
    if (definition) {
      return hrefToLeap(definition, document, { relativeTo: 'document', source: 'markdown' });
    }
    const reference = findReferenceLinkAt(line, ch);
    if (reference) {
      const href = findReferenceDefinition(document.getText(), reference.ref);
      if (href) {
        return hrefToLeap(href, document, { relativeTo: 'document', source: 'markdown' });
      }
    }
    return undefined;
  },

  async wikiLinks(document, position) {
    const link = findWikiLinkAt(document.lineAt(position.line).text, position.character);
    if (!link) {
      return undefined;
    }
    if (!link.target) {
      return { kind: 'uri', source: 'wikiLinks', uri: document.uri, heading: link.heading };
    }
    const uri = await findNote(link.target, document);
    if (uri) {
      return { kind: 'uri', source: 'wikiLinks', uri, heading: link.heading };
    }
    return { kind: 'missingNote', source: 'wikiLinks', name: link.target, folder: baseFolder(document, 'document') };
  },

  async documentLinks(document, position) {
    const links = await documentLinksFor(document);
    const link = links?.find((l) => l.range.contains(position));
    if (!link) {
      return undefined;
    }
    if (!link.target || link.target.scheme === 'command') {
      return { kind: 'builtin', source: 'documentLinks' };
    }
    return uriToLeap(link.target, 'documentLinks');
  },

  async urlsAndPaths(document, position) {
    const line = document.lineAt(position.line).text;
    const url = findUrlAt(line, position.character);
    if (url) {
      return hrefToLeap(url.url, document, { relativeTo: 'document', source: 'urlsAndPaths' });
    }
    const match = findPathAt(line, position.character);
    if (!match) {
      return undefined;
    }
    for (const candidate of match.candidates) {
      for (const uri of pathCandidates(candidate, document)) {
        if (await exists(uri)) {
          return { kind: 'uri', source: 'urlsAndPaths', uri, position: match.position };
        }
      }
    }
    return undefined;
  },

  async issues(document, position) {
    // `#123` is a colour in stylesheets, not an issue.
    if (/^(css|scss|sass|less|stylus)$/.test(document.languageId)) {
      return undefined;
    }
    const line = document.lineAt(position.line).text;
    // Cheap check first so we only look for the git remote when something issue-like is under the cursor.
    const prose = PROSE_LANGUAGES.has(document.languageId);
    if (!findIssueRefAt(line, position.character, { forge: 'gitlab', commits: prose })) {
      return undefined;
    }
    const remote = await remoteFor(document);
    if (!remote) {
      return undefined;
    }
    const ref = findIssueRefAt(line, position.character, { forge: remote.kind, commits: prose });
    return ref && { kind: 'uri', source: 'issues', uri: vscode.Uri.parse(issueUrl(remote, ref), true) };
  },

  async symbols(document, position, options) {
    const ref = findSymbolRefAt(
      document.lineAt(position.line).text,
      position.character,
      PROSE_LANGUAGES.has(document.languageId),
    );
    if (!ref) {
      return undefined;
    }
    const symbols =
      (await vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', ref.name)) ??
      [];
    const seen = new Set<string>();
    const matches = symbols
      .filter((s) => s.name === ref.name || s.name.startsWith(`${ref.name}(`))
      .sort((a, b) => symbolRank(a, ref.container) - symbolRank(b, ref.container))
      .filter((s) => {
        const key = `${s.location.uri.toString()}:${s.location.range.start.line}`;
        return !seen.has(key) && !!seen.add(key);
      });
    if (!matches.length) {
      // No language server answered (e.g. none is running yet), so look for a declaration ourselves.
      const declarations = options.quick ? [] : await findDeclarations(ref.name);
      return declarations.length ? { kind: 'definitions', source: 'symbols', locations: declarations } : undefined;
    }
    // When the reference names its container (`Foo.bar`), only keep symbols that live in it, if any do.
    const inContainer = ref.container ? matches.filter((s) => s.containerName === ref.container) : [];
    const locations = (inContainer.length ? inContainer : matches).slice(0, 20).map((s) => s.location);
    return { kind: 'definitions', source: 'symbols', locations };
  },

  async definition(document, position) {
    const results =
      (await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
        'vscode.executeDefinitionProvider',
        document.uri,
        position,
      )) ?? [];
    const locations = results
      .map((r) => ('targetUri' in r ? new vscode.Location(r.targetUri, r.targetSelectionRange ?? r.targetRange) : r))
      // Double-clicking the declaration itself is a plain word selection, not a jump.
      .filter((loc) => !(loc.uri.toString() === document.uri.toString() && loc.range.contains(position)));
    return locations.length ? { kind: 'definitions', source: 'definition', locations } : undefined;
  },
};

// ---------------------------------------------------------------------------------------------

const DECLARATION_KINDS = new Set([
  vscode.SymbolKind.Class,
  vscode.SymbolKind.Interface,
  vscode.SymbolKind.Function,
  vscode.SymbolKind.Method,
  vscode.SymbolKind.Enum,
  vscode.SymbolKind.Struct,
  vscode.SymbolKind.Module,
  vscode.SymbolKind.Namespace,
]);

const SOURCE_GLOB =
  '**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py,go,rs,java,kt,kts,scala,cs,fs,rb,php,swift,c,cc,cpp,h,hpp,m,lua,dart,ex,exs,erl,hs,ml,clj,vue,svelte}';
const SOURCE_EXCLUDE = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**,**/target/**,**/vendor/**,**/*.min.js}';
const MAX_SOURCE_FILES = 3000;

/** Text search for `name`'s declaration across the workspace's source files. */
async function findDeclarations(name: string): Promise<vscode.Location[]> {
  const pattern = declarationPattern(name);
  const uris = await vscode.workspace.findFiles(SOURCE_GLOB, SOURCE_EXCLUDE, MAX_SOURCE_FILES);
  const locations: vscode.Location[] = [];
  const decoder = new TextDecoder();
  for (let i = 0; i < uris.length && locations.length < 20; i += 50) {
    await Promise.all(
      uris.slice(i, i + 50).map(async (uri) => {
        let text: string;
        try {
          text = decoder.decode(await vscode.workspace.fs.readFile(uri));
        } catch {
          return;
        }
        if (!text.includes(name)) {
          return;
        }
        const lines = text.split(/\r?\n/);
        for (let line = 0; line < lines.length; line++) {
          const m = pattern.exec(lines[line]);
          if (m) {
            const start = m.index + m[0].length - name.length;
            locations.push(new vscode.Location(uri, new vscode.Range(line, start, line, start + name.length)));
          }
        }
      }),
    );
  }
  return locations.sort((a, b) => a.uri.path.localeCompare(b.uri.path) || a.range.start.line - b.range.start.line);
}

/** Lower is better: matching container first, then declarations over variables and properties. */
function symbolRank(symbol: vscode.SymbolInformation, container: string | undefined): number {
  return (container && symbol.containerName === container ? 0 : 2) + (DECLARATION_KINDS.has(symbol.kind) ? 0 : 1);
}

const linkCache = new Map<string, { version: number; links: Thenable<vscode.DocumentLink[] | undefined> }>();

export function documentLinksFor(document: vscode.TextDocument): Thenable<vscode.DocumentLink[] | undefined> {
  const key = document.uri.toString();
  const cached = linkCache.get(key);
  if (cached && cached.version === document.version) {
    return cached.links;
  }
  const links = vscode.commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', document.uri);
  linkCache.set(key, { version: document.version, links });
  return links;
}

export function forgetDocument(document: vscode.TextDocument): void {
  linkCache.delete(document.uri.toString());
}

/** Turns a URI that may carry a `#L10` / `#heading` fragment into a leap. */
function uriToLeap(uri: vscode.Uri, source: TargetKind): Leap {
  if (!isWorkspaceScheme(uri.scheme) || !uri.fragment) {
    return { kind: 'uri', source, uri };
  }
  const position = parseLineFragment(uri.fragment);
  return {
    kind: 'uri',
    source,
    uri: uri.with({ fragment: '' }),
    position,
    heading: position ? undefined : uri.fragment,
  };
}

function hrefToLeap(
  href: string,
  document: vscode.TextDocument,
  options: { relativeTo: 'document' | 'workspace'; source: TargetKind },
): Leap | undefined {
  href = href.trim();
  if (!href) {
    return undefined;
  }
  if (/^[a-z][\w+.-]*:/i.test(href) && !/^[a-z]:[\\/]/i.test(href)) {
    try {
      return uriToLeap(vscode.Uri.parse(href, true), options.source);
    } catch {
      return undefined;
    }
  }
  const hash = href.indexOf('#');
  const pathPart = hash >= 0 ? href.slice(0, hash) : href;
  const fragment = hash >= 0 ? href.slice(hash + 1) : '';
  let decoded = pathPart;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    // use as-is
  }
  const uri = decoded ? resolvePath(decoded, document, options.relativeTo) : document.uri;
  const position = fragment ? parseLineFragment(fragment) : undefined;
  return { kind: 'uri', source: options.source, uri, position, heading: fragment && !position ? fragment : undefined };
}

function resolvePath(p: string, document: vscode.TextDocument, relativeTo: 'document' | 'workspace'): vscode.Uri {
  if (p.startsWith('~/')) {
    return vscode.Uri.file(path.join(os.homedir(), p.slice(2)));
  }
  if (/^[a-z]:[\\/]/i.test(p) || p.startsWith('\\\\')) {
    return vscode.Uri.file(p);
  }
  if (p.startsWith('/')) {
    // In Markdown, `/docs/x.md` means "from the workspace root"; elsewhere it's an absolute path.
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    return relativeTo === 'document' && folder ? vscode.Uri.joinPath(folder.uri, p) : vscode.Uri.file(p);
  }
  return vscode.Uri.joinPath(baseFolder(document, relativeTo), p);
}

function baseFolder(document: vscode.TextDocument, relativeTo: 'document' | 'workspace'): vscode.Uri {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri) ?? vscode.workspace.workspaceFolders?.[0];
  if (relativeTo === 'document' && !document.isUntitled) {
    return vscode.Uri.joinPath(document.uri, '..');
  }
  return folder?.uri ?? (document.isUntitled ? vscode.Uri.file(os.homedir()) : vscode.Uri.joinPath(document.uri, '..'));
}

/** Where a bare path in text might live: absolute, next to the file, or in any workspace folder. */
function pathCandidates(p: string, document: vscode.TextDocument): vscode.Uri[] {
  if (p.startsWith('~/') || /^[a-z]:[\\/]/i.test(p) || p.startsWith('\\\\')) {
    return [resolvePath(p, document, 'workspace')];
  }
  const uris: vscode.Uri[] = [];
  if (p.startsWith('/')) {
    uris.push(vscode.Uri.file(p));
  }
  const relative = p.replace(/^\/+/, '');
  if (!document.isUntitled) {
    uris.push(vscode.Uri.joinPath(document.uri, '..', relative));
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    uris.push(vscode.Uri.joinPath(folder.uri, relative));
  }
  return uris;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** Finds a note by name the way Obsidian/Foam do: case-insensitive, closest to the current file wins. */
async function findNote(name: string, document: vscode.TextDocument): Promise<vscode.Uri | undefined> {
  const extensions = settings(document).wikiExtensions.map((e) => e.replace(/^\./, '')).filter(Boolean);
  const hasExtension = extensions.some((ext) => name.toLowerCase().endsWith(`.${ext.toLowerCase()}`));
  const fileNames = hasExtension ? [name] : extensions.map((ext) => `${name}.${ext}`);

  // Path-like names ([[docs/setup]]) are tried relative to the note and to the workspace first.
  if (name.includes('/')) {
    for (const fileName of fileNames) {
      for (const uri of pathCandidates(fileName, document)) {
        if (await exists(uri)) {
          return uri;
        }
      }
    }
  }

  const wanted = new Set(fileNames.map((f) => path.posix.basename(f).toLowerCase()));
  const globs = fileNames.map((f) => `**/${caseInsensitiveGlob(path.posix.basename(f))}`);
  const found = await vscode.workspace.findFiles(`{${globs.join(',')}}`, '**/node_modules/**', 200);
  // The glob is loose (special characters become `?`), so confirm the exact name here.
  const matches = found.filter((uri) => {
    const lower = uri.path.toLowerCase();
    return name.includes('/')
      ? fileNames.some((f) => lower.endsWith(`/${f.toLowerCase()}`))
      : wanted.has(path.posix.basename(lower));
  });
  const here = path.posix.dirname(document.uri.path);
  matches.sort((a, b) => distance(here, a.path) - distance(here, b.path) || a.path.length - b.path.length);
  return matches[0];
}

function caseInsensitiveGlob(fileName: string): string {
  return [...fileName]
    .map((c) => {
      if (/[{}[\]*?,!]/.test(c)) {
        return '?';
      }
      const lower = c.toLowerCase();
      const upper = c.toUpperCase();
      return lower !== upper ? `[${lower}${upper}]` : c;
    })
    .join('');
}

/** Number of directory steps between a folder and a file. */
function distance(fromDir: string, filePath: string): number {
  const a = fromDir.split('/').filter(Boolean);
  const b = path.posix.dirname(filePath).split('/').filter(Boolean);
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) {
    common++;
  }
  return a.length - common + (b.length - common);
}

export function isWorkspaceScheme(scheme: string): boolean {
  return !['http', 'https', 'mailto', 'ftp', 'vscode', 'vscode-insiders', 'command'].includes(scheme);
}

/** Short human-readable description of a leap, for hovers and messages. */
export function describeLeap(leap: Leap): string {
  switch (leap.kind) {
    case 'uri': {
      const where = isWorkspaceScheme(leap.uri.scheme) ? vscode.workspace.asRelativePath(leap.uri) : leap.uri.toString(true);
      const suffix = leap.position ? `:${leap.position.line}` : leap.heading ? `#${leap.heading}` : '';
      return leap.name ? `${leap.name}: ${where}${suffix}` : `${where}${suffix}`;
    }
    case 'definitions': {
      const noun = leap.source === 'symbols' ? 'symbol' : 'definition';
      return leap.locations.length === 1
        ? `${noun} in ${vscode.workspace.asRelativePath(leap.locations[0].uri)}:${leap.locations[0].range.start.line + 1}`
        : `${leap.locations.length} ${noun}s`;
    }
    case 'builtin':
      return 'link';
    case 'missingNote':
      return `new note "${leap.name}"`;
  }
}
