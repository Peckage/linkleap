import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileRule, expandTemplate, findPathAt, findPatternAt, findUrlAt, PatternRule } from '../../core/text';

describe('findUrlAt', () => {
  it('finds URLs and trims trailing punctuation', () => {
    const line = 'Docs live at https://example.com/docs. Thanks!';
    assert.equal(findUrlAt(line, line.indexOf('example'))?.url, 'https://example.com/docs');
    assert.equal(findUrlAt(line, line.indexOf('Thanks')), undefined);
  });

  it('keeps balanced parentheses but drops unbalanced ones', () => {
    assert.equal(findUrlAt('(see https://x.org/a_(b))', 8)?.url, 'https://x.org/a_(b)');
    assert.equal(findUrlAt('(see https://x.org/a)', 8)?.url, 'https://x.org/a');
  });

  it('upgrades www. links and accepts mailto', () => {
    assert.equal(findUrlAt('go to www.example.com now', 8)?.url, 'https://www.example.com');
    assert.equal(findUrlAt('mailto:me@x.io', 3)?.url, 'mailto:me@x.io');
  });
});

describe('findPathAt', () => {
  it('finds relative paths with line and column', () => {
    const line = 'error at src/app.ts:12:5: unexpected token';
    assert.deepEqual(findPathAt(line, line.indexOf('app')), {
      start: 9,
      end: 24,
      candidates: ['src/app.ts'],
      position: { line: 12, column: 5 },
    });
  });

  it('understands MSBuild style and #L fragments', () => {
    const msbuild = 'C:\\proj\\Program.cs(10,3): error CS1002';
    assert.deepEqual(findPathAt(msbuild, 5)?.position, { line: 10, column: 3 });
    assert.equal(findPathAt(msbuild, 5)?.candidates[0], 'C:\\proj\\Program.cs');
    assert.deepEqual(findPathAt('see README.md#L42', 6)?.position, { line: 42, column: undefined });
  });

  it('offers the path without a git diff prefix', () => {
    assert.deepEqual(findPathAt('+++ b/src/index.ts', 8)?.candidates, ['b/src/index.ts', 'src/index.ts']);
  });

  it('ignores plain words, URLs and trailing punctuation', () => {
    assert.equal(findPathAt('just some words', 6), undefined);
    assert.equal(findPathAt('https://example.com/a.html', 10), undefined);
    assert.equal(findPathAt('Edit ./notes.md.', 8)?.candidates[0], './notes.md');
  });
});

describe('patterns', () => {
  const rules: PatternRule[] = [
    { name: 'Jira', pattern: '\\b([A-Z][A-Z0-9]+-\\d+)\\b', target: 'https://jira.example.com/browse/$1' },
    { pattern: 'todo:(\\w+)', flags: 'gi', target: '${workspaceFolder}/todos/${1}.md' },
  ];
  const compiled = rules.map((rule) => ({ rule, regex: compileRule(rule) }));

  it('expands groups and variables', () => {
    const vars = { workspaceFolder: '/ws' };
    assert.deepEqual(findPatternAt('Fixes PROJ-123 today', 8, compiled, vars), {
      start: 6,
      end: 14,
      target: 'https://jira.example.com/browse/PROJ-123',
      name: 'Jira',
    });
    assert.equal(findPatternAt('see TODO:cleanup', 10, compiled, vars)?.target, '/ws/todos/cleanup.md');
    assert.equal(findPatternAt('nothing here', 3, compiled, vars), undefined);
  });

  it('leaves unknown variables alone', () => {
    assert.equal(expandTemplate('${nope}/$1/$0', ['all', 'one'], {}), '${nope}/one/all');
  });
});
