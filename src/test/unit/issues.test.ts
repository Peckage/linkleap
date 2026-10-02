import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findIssueRefAt, issueSpans, issueUrl, parseRemoteUrl, remoteUrlFromGitConfig } from '../../core/issues';

describe('parseRemoteUrl', () => {
  it('parses https, ssh and scp-style remotes', () => {
    assert.deepEqual(parseRemoteUrl('https://github.com/Peckage/linkleap.git'), {
      protocol: 'https',
      host: 'github.com',
      path: 'Peckage/linkleap',
      kind: 'github',
    });
    assert.deepEqual(parseRemoteUrl('git@gitlab.com:group/sub/repo.git'), {
      protocol: 'https',
      host: 'gitlab.com',
      path: 'group/sub/repo',
      kind: 'gitlab',
    });
    assert.equal(parseRemoteUrl('ssh://git@bitbucket.org:22/team/repo')?.path, 'team/repo');
    assert.equal(parseRemoteUrl('http://git.local:3000/me/notes/')?.host, 'git.local:3000');
    assert.equal(parseRemoteUrl('https://user:token@github.com/a/b')?.host, 'github.com');
    assert.equal(parseRemoteUrl('/srv/git/repo.git'), undefined);
  });
});

describe('remoteUrlFromGitConfig', () => {
  const config = [
    '[core]',
    '\tbare = false',
    '[remote "upstream"]',
    '\turl = https://github.com/up/stream.git',
    '[remote "origin"]',
    '\turl = git@github.com:me/fork.git',
    '\tfetch = +refs/heads/*:refs/remotes/origin/*',
  ].join('\n');

  it('prefers origin, else the first remote', () => {
    assert.equal(remoteUrlFromGitConfig(config), 'git@github.com:me/fork.git');
    assert.equal(remoteUrlFromGitConfig('[remote "a"]\n url = x:y/z\n'), 'x:y/z');
    assert.equal(remoteUrlFromGitConfig('[core]\n url = nope\n'), undefined);
  });
});

describe('findIssueRefAt', () => {
  const github = { forge: 'github' as const, commits: true };

  it('finds #123, owner/repo#45 and GH-7', () => {
    assert.deepEqual(findIssueRefAt('Fixes #123.', 7, github), { start: 6, end: 10, kind: 'issue', id: '123' });
    assert.deepEqual(findIssueRefAt('see octo/repo#45', 6, github), {
      start: 4,
      end: 16,
      kind: 'issue',
      id: '45',
      repoPath: 'octo/repo',
    });
    assert.equal(findIssueRefAt('GH-7 broke', 1, github)?.id, '7');
  });

  it('ignores anchors, HTML entities and headings', () => {
    assert.equal(findIssueRefAt('page.html#123', 10, github), undefined);
    assert.equal(findIssueRefAt('&#123;', 2, github), undefined);
    assert.equal(findIssueRefAt('# 123', 2, github), undefined);
    assert.equal(findIssueRefAt('#123abc', 2, github), undefined);
  });

  it('finds GitLab merge requests only on GitLab', () => {
    assert.equal(findIssueRefAt('see !34', 5, { forge: 'gitlab', commits: false })?.kind, 'mergeRequest');
    assert.equal(findIssueRefAt('see !34', 5, github), undefined);
  });

  it('finds commit SHAs only when allowed, and only hex with letters and digits', () => {
    assert.equal(findIssueRefAt('fixed in 2242ebb', 10, github)?.kind, 'commit');
    assert.equal(findIssueRefAt('fixed in 2242ebb', 10, { forge: 'github', commits: false }), undefined);
    assert.equal(findIssueRefAt('in 1234567', 4, github), undefined);
    assert.equal(findIssueRefAt('a deadbeef b', 4, github), undefined);
    assert.equal(findIssueRefAt('550e8400-e29b-41d4', 2, github), undefined);
  });
});

describe('issueUrl', () => {
  const ref = (kind: 'issue' | 'mergeRequest' | 'commit', id: string, repoPath?: string) => ({ start: 0, end: 0, kind, id, repoPath });

  it('builds forge-specific URLs', () => {
    const gh = parseRemoteUrl('git@github.com:me/app.git')!;
    assert.equal(issueUrl(gh, ref('issue', '5')), 'https://github.com/me/app/issues/5');
    assert.equal(issueUrl(gh, ref('issue', '9', 'other/lib')), 'https://github.com/other/lib/issues/9');
    assert.equal(issueUrl(gh, ref('commit', 'abc1234')), 'https://github.com/me/app/commit/abc1234');
    const gl = parseRemoteUrl('https://gitlab.com/g/s/r')!;
    assert.equal(issueUrl(gl, ref('mergeRequest', '3')), 'https://gitlab.com/g/s/r/-/merge_requests/3');
    const bb = parseRemoteUrl('git@bitbucket.org:t/r.git')!;
    assert.equal(issueUrl(bb, ref('commit', 'abc1234')), 'https://bitbucket.org/t/r/commits/abc1234');
  });

  it('lists issue spans on a line', () => {
    const line = 'Closes #1 and a/b#2, see !3';
    const texts = issueSpans(line, { forge: 'gitlab', commits: false }).map((s) => line.slice(s.start, s.end));
    assert.deepEqual(texts.sort(), ['!3', '#1', 'a/b#2']);
  });
});
