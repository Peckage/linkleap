/** Pure helpers for turning `#123`, `owner/repo#45`, `!12` and commit SHAs into forge URLs. */

import { Span } from './markdown';

export type ForgeKind = 'github' | 'gitlab' | 'bitbucket' | 'other';

export interface Remote {
  protocol: 'https' | 'http';
  /** Host, including a port for http(s) remotes. */
  host: string;
  /** `owner/repo`, or `group/subgroup/repo` on GitLab. */
  path: string;
  kind: ForgeKind;
}

export interface IssueRef extends Span {
  kind: 'issue' | 'mergeRequest' | 'commit';
  id: string;
  /** Set for cross-repository references like `owner/repo#45`. */
  repoPath?: string;
}

export function forgeKind(host: string): ForgeKind {
  const lower = host.toLowerCase();
  if (lower.includes('github')) {
    return 'github';
  }
  if (lower.includes('gitlab')) {
    return 'gitlab';
  }
  if (lower.includes('bitbucket')) {
    return 'bitbucket';
  }
  return 'other';
}

/** Parses https, ssh and scp-style (`git@host:owner/repo.git`) remote URLs. */
export function parseRemoteUrl(url: string): Remote | undefined {
  const trimmed = url.trim();
  let protocol: Remote['protocol'] = 'https';
  let host: string;
  let repoPath: string;

  const web = /^(https?):\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i.exec(trimmed);
  const ssh = /^(?:ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(trimmed);
  const scp = /^(?:[\w.-]+@)?([\w.-]+):(?!\/)(.+)$/.exec(trimmed);
  if (web) {
    protocol = web[1].toLowerCase() as Remote['protocol'];
    host = web[2];
    repoPath = web[3];
  } else if (ssh) {
    host = ssh[1];
    repoPath = ssh[2];
  } else if (scp) {
    host = scp[1];
    repoPath = scp[2];
  } else {
    return undefined;
  }
  repoPath = repoPath.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/^\/+/, '');
  // Bitbucket Server style `scm/project/repo` and GitHub Enterprise ssh port prefixes aren't web paths.
  repoPath = repoPath.replace(/^scm\//, '');
  if (!repoPath.includes('/')) {
    return undefined;
  }
  return { protocol, host, path: repoPath, kind: forgeKind(host) };
}

/** Reads the `origin` remote URL (or the first remote) from the text of a `.git/config` file. */
export function remoteUrlFromGitConfig(config: string): string | undefined {
  let section: string | undefined;
  let first: string | undefined;
  for (const line of config.split(/\r?\n/)) {
    const header = /^\s*\[\s*remote\s+"([^"]+)"\s*\]/.exec(line);
    if (header) {
      section = header[1];
      continue;
    }
    if (/^\s*\[/.test(line)) {
      section = undefined;
      continue;
    }
    const url = section !== undefined ? /^\s*url\s*=\s*(.+?)\s*$/.exec(line) : null;
    if (url) {
      if (section === 'origin') {
        return url[1];
      }
      first ??= url[1];
    }
  }
  return first;
}

const CROSS_REPO = /(?<![\w./-])([\w.-]+\/[\w.-]+)#(\d+)\b/g;
const GH_PREFIXED = /\bGH-(\d+)\b/g;
const HASH_ISSUE = /(?<![\w&#/])#(\d+)(?![\w-])/g;
const MERGE_REQUEST = /(?<![\w!])!(\d+)(?![\w-])/g;
const COMMIT = /(?<![\w-])[0-9a-f]{7,40}(?![\w-])/g;

function spanAt(regex: RegExp, line: string, ch: number): RegExpExecArray | undefined {
  regex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(line))) {
    if (m.index <= ch && ch < m.index + m[0].length) {
      return m;
    }
  }
  return undefined;
}

export interface IssueOptions {
  forge: ForgeKind;
  /** Whether bare hex strings may be treated as commit SHAs. */
  commits: boolean;
}

export function findIssueRefAt(line: string, ch: number, options: IssueOptions): IssueRef | undefined {
  const at = (m: RegExpExecArray) => ({ start: m.index, end: m.index + m[0].length });

  let m = spanAt(CROSS_REPO, line, ch);
  if (m) {
    return { ...at(m), kind: 'issue', id: m[2], repoPath: m[1] };
  }
  if ((m = spanAt(GH_PREFIXED, line, ch))) {
    return { ...at(m), kind: 'issue', id: m[1] };
  }
  if ((m = spanAt(HASH_ISSUE, line, ch))) {
    return { ...at(m), kind: 'issue', id: m[1] };
  }
  if (options.forge === 'gitlab' && (m = spanAt(MERGE_REQUEST, line, ch))) {
    return { ...at(m), kind: 'mergeRequest', id: m[1] };
  }
  // A SHA needs at least one digit and one letter, which rules out plain numbers and most words.
  if (options.commits && (m = spanAt(COMMIT, line, ch)) && /\d/.test(m[0]) && /[a-f]/.test(m[0])) {
    return { ...at(m), kind: 'commit', id: m[0] };
  }
  return undefined;
}

export function issueUrl(remote: Remote, ref: IssueRef): string {
  const base = `${remote.protocol}://${remote.host}/${ref.repoPath ?? remote.path}`;
  switch (remote.kind) {
    case 'gitlab':
      return `${base}/-/${{ issue: 'issues', mergeRequest: 'merge_requests', commit: 'commit' }[ref.kind]}/${ref.id}`;
    case 'bitbucket':
      return `${base}/${{ issue: 'issues', mergeRequest: 'pull-requests', commit: 'commits' }[ref.kind]}/${ref.id}`;
    default:
      // GitHub, Gitea and Forgejo: /issues/N also redirects to pull requests.
      return `${base}/${{ issue: 'issues', mergeRequest: 'pull', commit: 'commit' }[ref.kind]}/${ref.id}`;
  }
}

/** Every issue-like reference on a line, for listing links in a file. */
export function issueSpans(line: string, options: IssueOptions): Span[] {
  const spans: Span[] = [];
  const regexes = [CROSS_REPO, GH_PREFIXED, HASH_ISSUE];
  if (options.forge === 'gitlab') {
    regexes.push(MERGE_REQUEST);
  }
  for (const regex of regexes) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(line))) {
      spans.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  return spans;
}
