import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { parseRemoteUrl, Remote, remoteUrlFromGitConfig } from './core/issues';

const CACHE_MS = 30_000;
const cache = new Map<string, { time: number; remote: Promise<Remote | undefined> }>();

/** The forge remote for a document: `linkleap.issues.repository` if set, else the git `origin` of its repo. */
export function remoteFor(document: vscode.TextDocument): Promise<Remote | undefined> {
  const override = vscode.workspace.getConfiguration('linkleap', document).get<string>('issues.repository', '').trim();
  if (override) {
    return Promise.resolve(parseRemoteUrl(/^[\w.-]+\/[\w./-]+$/.test(override) ? `https://github.com/${override}` : override));
  }
  const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
  const start =
    document.uri.scheme === 'file' ? path.dirname(document.uri.fsPath) : folder?.scheme === 'file' ? folder.fsPath : undefined;
  if (!start) {
    return Promise.resolve(undefined);
  }
  const cached = cache.get(start);
  if (cached && Date.now() - cached.time < CACHE_MS) {
    return cached.remote;
  }
  const remote = findRemote(start).catch(() => undefined);
  cache.set(start, { time: Date.now(), remote });
  return remote;
}

async function findRemote(start: string): Promise<Remote | undefined> {
  for (let dir = start; ; dir = path.dirname(dir)) {
    const configPath = await gitConfigPath(path.join(dir, '.git'));
    if (configPath) {
      const url = remoteUrlFromGitConfig(await fs.readFile(configPath, 'utf8'));
      return url ? parseRemoteUrl(url) : undefined;
    }
    if (path.dirname(dir) === dir) {
      return undefined;
    }
  }
}

/** Handles normal repos, worktrees (`.git` file → `gitdir/../../config`) and submodules. */
async function gitConfigPath(dotGit: string): Promise<string | undefined> {
  let stat;
  try {
    stat = await fs.stat(dotGit);
  } catch {
    return undefined;
  }
  if (stat.isDirectory()) {
    return path.join(dotGit, 'config');
  }
  const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(await fs.readFile(dotGit, 'utf8'));
  if (!pointer) {
    return undefined;
  }
  const gitDir = path.resolve(path.dirname(dotGit), pointer[1]);
  try {
    const common = (await fs.readFile(path.join(gitDir, 'commondir'), 'utf8')).trim();
    return path.join(path.resolve(gitDir, common), 'config');
  } catch {
    return path.join(gitDir, 'config');
  }
}
