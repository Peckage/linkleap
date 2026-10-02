import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findHeadingLine,
  findMarkdownLinkAt,
  findReferenceDefinition,
  findReferenceDefinitionOnLine,
  findReferenceLinkAt,
  findWikiLinkAt,
  parseLineFragment,
  slugify,
} from '../../core/markdown';

describe('findMarkdownLinkAt', () => {
  const line = 'Read [the setup guide](docs/setup.md#install "Setup") now.';

  it('finds the href when clicking the link text', () => {
    assert.equal(findMarkdownLinkAt(line, line.indexOf('setup guide'))?.href, 'docs/setup.md#install');
  });

  it('finds the href when clicking the href itself', () => {
    assert.equal(findMarkdownLinkAt(line, line.indexOf('docs/'))?.href, 'docs/setup.md#install');
  });

  it('returns nothing outside the link', () => {
    assert.equal(findMarkdownLinkAt(line, 1), undefined);
    assert.equal(findMarkdownLinkAt(line, line.length - 2), undefined);
  });

  it('handles parentheses in hrefs and angle-bracket hrefs', () => {
    const wiki = '[Rust](https://en.wikipedia.org/wiki/Rust_(programming_language))';
    assert.equal(findMarkdownLinkAt(wiki, 2)?.href, 'https://en.wikipedia.org/wiki/Rust_(programming_language)');
    assert.equal(findMarkdownLinkAt('[x](<my file.md>)', 1)?.href, 'my file.md');
  });

  it('picks the image or the outer link in a linked badge', () => {
    const badge = '[![build](https://ci/badge.svg)](https://ci/run)';
    assert.equal(findMarkdownLinkAt(badge, badge.indexOf('build'))?.href, 'https://ci/badge.svg');
    assert.equal(findMarkdownLinkAt(badge, badge.indexOf('ci/run'))?.href, 'https://ci/run');
  });

  it('finds autolinks', () => {
    assert.equal(findMarkdownLinkAt('Visit <https://example.com>.', 10)?.href, 'https://example.com');
    assert.equal(findMarkdownLinkAt('Mail <me@example.com>', 8)?.href, 'mailto:me@example.com');
  });
});

describe('reference links', () => {
  const doc = 'See [the guide][guide] or [Guide].\n\n[guide]: https://example.com/guide "Guide"\n';

  it('finds full and shortcut references', () => {
    assert.equal(findReferenceLinkAt('See [the guide][guide] now', 6)?.ref, 'guide');
    assert.equal(findReferenceLinkAt('See [Guide] now', 6)?.ref, 'Guide');
    assert.equal(findReferenceLinkAt('[collapsed][]', 3)?.ref, 'collapsed');
  });

  it('looks up definitions case-insensitively', () => {
    assert.equal(findReferenceDefinition(doc, 'GUIDE'), 'https://example.com/guide');
    assert.equal(findReferenceDefinition(doc, 'missing'), undefined);
  });

  it('reads a definition line', () => {
    assert.equal(findReferenceDefinitionOnLine('[guide]: <docs/a b.md>'), 'docs/a b.md');
    assert.equal(findReferenceDefinitionOnLine('not [a] definition'), undefined);
  });
});

describe('findWikiLinkAt', () => {
  it('parses name, heading and alias', () => {
    const line = 'See [[Project Plan#Next Steps|the plan]] today';
    assert.deepEqual(findWikiLinkAt(line, line.indexOf('Plan')), {
      start: 4,
      end: 40,
      target: 'Project Plan',
      heading: 'Next Steps',
    });
  });

  it('supports same-note headings and embeds', () => {
    assert.equal(findWikiLinkAt('[[#Intro]]', 3)?.heading, 'Intro');
    assert.equal(findWikiLinkAt('![[diagram.png]]', 4)?.target, 'diagram.png');
    assert.equal(findWikiLinkAt('[[]]', 1), undefined);
  });
});

describe('headings', () => {
  it('slugifies like GitHub', () => {
    assert.equal(slugify('Hello, World!'), 'hello-world');
    assert.equal(slugify('  API v2 — `fetch()` '), 'api-v2--fetch');
    assert.equal(slugify('Über café'), 'über-café');
  });

  const doc = ['# Title', '```', '# not a heading', '```', '## Install', 'text', '## Install', '### Next Steps ##'].join('\n');

  it('finds headings by slug, duplicate slug and raw text, skipping code fences', () => {
    assert.equal(findHeadingLine(doc, 'install'), 4);
    assert.equal(findHeadingLine(doc, 'install-1'), 6);
    assert.equal(findHeadingLine(doc, 'Next Steps'), 7);
    assert.equal(findHeadingLine(doc, 'next%20steps'), 7);
    assert.equal(findHeadingLine(doc, 'not-a-heading'), undefined);
  });
});

describe('parseLineFragment', () => {
  it('parses GitHub and editor style line fragments', () => {
    assert.deepEqual(parseLineFragment('L10'), { line: 10, column: undefined });
    assert.deepEqual(parseLineFragment('L10C5'), { line: 10, column: 5 });
    assert.deepEqual(parseLineFragment('L10-L20'), { line: 10, column: undefined });
    assert.deepEqual(parseLineFragment('12:3'), { line: 12, column: 3 });
    assert.deepEqual(parseLineFragment('105'), { line: 105, column: undefined });
    assert.equal(parseLineFragment('install'), undefined);
    assert.equal(parseLineFragment('L0'), undefined);
  });
});
