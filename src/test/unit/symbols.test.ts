import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractLinks } from '../../core/markdown';
import { declarationPattern, findSymbolRefAt } from '../../core/symbols';

describe('findSymbolRefAt', () => {
  it('reads identifiers in backticks, with calls, generics and qualifiers', () => {
    const line = 'Call `config.parseConfig(opts)` or `Map<K, V>` or `select`.';
    assert.deepEqual(findSymbolRefAt(line, line.indexOf('parse'), true), {
      start: 5,
      end: 31,
      name: 'parseConfig',
      container: 'config',
    });
    assert.equal(findSymbolRefAt(line, line.indexOf('Map'), true)?.name, 'Map');
    assert.equal(findSymbolRefAt(line, line.indexOf('select'), true)?.name, 'select');
  });

  it('only takes code-shaped backtick text in code files', () => {
    assert.equal(findSymbolRefAt('// see `select`', 9, false), undefined);
    assert.equal(findSymbolRefAt('// see `selectAll`', 9, false)?.name, 'selectAll');
    assert.equal(findSymbolRefAt('// see `run()`', 9, false)?.name, 'run');
    assert.equal(findSymbolRefAt('// see `Db.open`', 9, false)?.name, 'open');
  });

  it('ignores backticks that are not identifiers', () => {
    assert.equal(findSymbolRefAt('Run `npm install` first', 6, true), undefined);
  });

  it('accepts code-shaped bare words only in prose', () => {
    assert.equal(findSymbolRefAt('The UserService handles it', 6, true)?.name, 'UserService');
    assert.equal(findSymbolRefAt('call load_config to start', 7, true)?.name, 'load_config');
    assert.equal(findSymbolRefAt('then run(now)', 6, true)?.name, 'run');
    assert.equal(findSymbolRefAt('The service handles it', 6, true), undefined);
    assert.equal(findSymbolRefAt('The UserService handles it', 6, false), undefined);
  });
});

describe('extractLinks', () => {
  it('collects local markdown, reference and wiki links, skipping URLs and code fences', () => {
    const text = [
      'See [guide](docs/guide.md#install) and [[Notes|my notes]].',
      '[web](https://example.com) [[#Local heading]]',
      '```',
      '[not](a-link.md)',
      '```',
      '[ref]: ../other.md',
      '[![badge](img/b.png)](page.md)',
    ].join('\n');
    assert.deepEqual(
      extractLinks(text).map((l) => [l.line, l.kind, l.target]),
      [
        [0, 'wiki', 'Notes'],
        [0, 'path', 'docs/guide.md'],
        [5, 'path', '../other.md'],
        [6, 'path', 'page.md'],
        [6, 'path', 'img/b.png'],
      ],
    );
  });
});

describe('declarationPattern', () => {
  it('matches declarations across languages but not uses', () => {
    const decl = (line: string) => declarationPattern('double').test(line);
    assert.ok(decl('export async function double(n) {'));
    assert.ok(decl('def double(n):'));
    assert.ok(decl('pub fn double<T>(n: T)'));
    assert.ok(decl('func (c *Calc) double(n int) int {'));
    assert.ok(decl('export const double = (n) => n * 2;'));
    assert.ok(!decl('console.log(double(21));'));
    assert.ok(!decl('function doubled() {}'));
    assert.ok(declarationPattern('UserService').test('export class UserService {'));
  });
});
