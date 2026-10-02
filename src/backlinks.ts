import * as path from 'path';
import * as vscode from 'vscode';
import { settings } from './config';
import { extractLinks, ExtractedLink } from './core/markdown';

const MAX_FILES = 5000;
const EXCLUDE = '{**/node_modules/**,**/.git/**}';

export interface Backlink {
  source: vscode.Uri;
  range: vscode.Range;
  lineText: string;
}

interface IndexedFile {
  links: (ExtractedLink & { resolved?: string; lineText: string })[];
}

/** Index of every local link in the workspace's Markdown files, kept fresh with a file watcher. */
export class BacklinkIndex implements vscode.Disposable {
  private files = new Map<string, IndexedFile>();
  private building: Promise<void> | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  private extensions(): string[] {
    return settings().wikiExtensions.map((e) => e.replace(/^\./, '')).filter(Boolean);
  }

  private glob(): string {
    const exts = this.extensions();
    return exts.length === 1 ? `**/*.${exts[0]}` : `**/*.{${exts.join(',')}}`;
  }

  private ensureBuilt(): Promise<void> {
    if (!this.building) {
      this.building = this.build();
    }
    return this.building;
  }

  private async build(): Promise<void> {
    this.watcher = vscode.workspace.createFileSystemWatcher(this.glob());
    const update = (uri: vscode.Uri) => this.indexFile(uri).then(() => this.changed.fire());
    this.watcher.onDidCreate(update);
    this.watcher.onDidChange(update);
    this.watcher.onDidDelete((uri) => {
      this.files.delete(uri.toString());
      this.changed.fire();
    });
    const uris = await vscode.workspace.findFiles(this.glob(), EXCLUDE, MAX_FILES);
    // Read in batches so a big notes folder doesn't open thousands of files at once.
    for (let i = 0; i < uris.length; i += 50) {
      await Promise.all(uris.slice(i, i + 50).map((uri) => this.indexFile(uri)));
    }
  }

  private async indexFile(uri: vscode.Uri): Promise<void> {
    let text: string;
    try {
      text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      this.files.delete(uri.toString());
      return;
    }
    const lines = text.split(/\r?\n/);
    const links = extractLinks(text).map((link) => ({
      ...link,
      lineText: lines[link.line],
      resolved: link.kind === 'path' ? resolveHref(link.target, uri) : undefined,
    }));
    this.files.set(uri.toString(), { links });
  }

  /** Re-reads every file; also picks up a change to `linkleap.wikiLinks.fileExtensions`. */
  async rebuild(): Promise<void> {
    this.watcher?.dispose();
    this.files.clear();
    this.building = undefined;
    await this.ensureBuilt();
    this.changed.fire();
  }

  async backlinksTo(target: vscode.Uri): Promise<Backlink[]> {
    await this.ensureBuilt();
    const targetKey = target.toString();
    const targetNoExt = stripExtension(targetKey);
    const targetPath = target.path.toLowerCase();
    const targetName = path.posix.basename(stripExtension(targetPath));
    const extensions = this.extensions().map((e) => e.toLowerCase());

    const matchesWiki = (name: string) => {
      const lower = name.toLowerCase();
      const ext = extensions.find((e) => lower.endsWith(`.${e}`));
      const bare = ext ? lower.slice(0, -(ext.length + 1)) : lower;
      if (bare.includes('/')) {
        return stripExtension(targetPath).endsWith(`/${bare}`);
      }
      return bare === targetName;
    };

    const results: Backlink[] = [];
    for (const [source, file] of this.files) {
      if (source === targetKey) {
        continue;
      }
      for (const link of file.links) {
        const hit =
          link.kind === 'wiki'
            ? matchesWiki(link.target)
            : link.resolved === targetKey || (!!link.resolved && link.resolved === targetNoExt);
        if (hit) {
          results.push({
            source: vscode.Uri.parse(source),
            range: new vscode.Range(link.line, link.start, link.line, link.end),
            lineText: link.lineText,
          });
        }
      }
    }
    return results.sort(
      (a, b) => a.source.path.localeCompare(b.source.path) || a.range.start.compareTo(b.range.start),
    );
  }

  dispose(): void {
    this.watcher?.dispose();
    this.changed.dispose();
  }
}

function resolveHref(href: string, source: vscode.Uri): string | undefined {
  let decoded = href;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    // keep as-is
  }
  if (decoded.startsWith('/')) {
    const folder = vscode.workspace.getWorkspaceFolder(source);
    return folder ? vscode.Uri.joinPath(folder.uri, decoded).toString() : undefined;
  }
  return vscode.Uri.joinPath(source, '..', decoded).toString();
}

function stripExtension(value: string): string {
  return value.replace(/\.[^./]+$/, '');
}

// ---------------------------------------------------------------------------------------------

type Node = { kind: 'file'; uri: vscode.Uri; links: Backlink[] } | { kind: 'link'; link: Backlink };

/** Explorer view listing the files that link to the active file. */
export class BacklinksView implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly view: vscode.TreeView<Node>;
  private readonly disposables: vscode.Disposable[] = [];
  private target: vscode.Uri | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly index: BacklinkIndex) {
    this.view = vscode.window.createTreeView('linkleap.backlinks', { treeDataProvider: this, showCollapseAll: true });
    this.disposables.push(
      this.view,
      this.changed,
      this.view.onDidChangeVisibility(() => this.scheduleRefresh()),
      vscode.window.onDidChangeActiveTextEditor(() => this.scheduleRefresh()),
      index.onDidChange(() => this.scheduleRefresh()),
    );
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), 150);
  }

  refresh(): void {
    if (!this.view.visible) {
      return;
    }
    const uri = vscode.window.activeTextEditor?.document.uri;
    // Keep showing the last file when focus moves to a non-file editor such as Output.
    if (uri && uri.scheme !== 'output') {
      this.target = uri;
    }
    this.changed.fire(undefined);
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'file') {
      const item = new vscode.TreeItem(node.uri, vscode.TreeItemCollapsibleState.Expanded);
      const dir = path.posix.dirname(vscode.workspace.asRelativePath(node.uri));
      item.description = `${dir === '.' ? '' : `${dir} · `}${node.links.length}`;
      item.contextValue = 'linkleap.backlinkFile';
      return item;
    }
    const { link } = node;
    const raw = link.lineText;
    const indent = raw.length - raw.trimStart().length;
    const text = raw.trim();
    const start = Math.max(0, link.range.start.character - indent);
    const end = Math.min(text.length, link.range.end.character - indent);
    const item = new vscode.TreeItem({ label: text || '(empty line)', highlights: end > start ? [[start, end]] : [] });
    item.description = `Ln ${link.range.start.line + 1}`;
    item.tooltip = `${vscode.workspace.asRelativePath(link.source)}:${link.range.start.line + 1}`;
    item.command = {
      command: 'vscode.open',
      title: 'Open Backlink',
      arguments: [link.source, { selection: link.range }],
    };
    return item;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (node) {
      return node.kind === 'file' ? node.links.map((link) => ({ kind: 'link', link })) : [];
    }
    const target = this.target;
    if (!target) {
      this.view.description = undefined;
      this.view.message = 'Open a file to see what links to it.';
      return [];
    }
    const backlinks = await this.index.backlinksTo(target);
    const name = path.posix.basename(target.path);
    this.view.description = name;
    this.view.message = backlinks.length ? undefined : `Nothing links to ${name} yet.`;
    const byFile = new Map<string, Backlink[]>();
    for (const link of backlinks) {
      const key = link.source.toString();
      byFile.set(key, [...(byFile.get(key) ?? []), link]);
    }
    return [...byFile.values()].map((links) => ({ kind: 'file', uri: links[0].source, links }));
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }
}
