import * as assert from 'assert';
import * as vscode from 'vscode';
import type { LinkLeapApi } from '../../../extension';
import { collectLinks } from '../../../picker';
import type { Leap } from '../../../resolve';

const workspace = () => vscode.workspace.workspaceFolders![0].uri;
const file = (relative: string) => vscode.Uri.joinPath(workspace(), relative);

let api: LinkLeapApi;
let readme: vscode.TextDocument;

/** Position of the first occurrence of `text` in the README, plus `offset` characters. */
function at(text: string, offset = 0): vscode.Position {
  const index = readme.getText().indexOf(text);
  assert.ok(index >= 0, `"${text}" not found in README`);
  return readme.positionAt(index + offset);
}

function assertUri(leap: Leap | undefined, expected: vscode.Uri | string): Extract<Leap, { kind: 'uri' }> {
  assert.ok(leap, 'expected a leap');
  assert.equal(leap.kind, 'uri');
  const uri = (leap as Extract<Leap, { kind: 'uri' }>).uri;
  assert.equal(typeof expected === 'string' ? uri.toString(true) : uri.fsPath, typeof expected === 'string' ? expected : expected.fsPath);
  return leap as Extract<Leap, { kind: 'uri' }>;
}

describe('LinkLeap', () => {
  before(async () => {
    const extension = vscode.extensions.getExtension<LinkLeapApi>('peckage.linkleap');
    assert.ok(extension, 'extension not found');
    api = await extension.activate();
    readme = await vscode.workspace.openTextDocument(file('README.md'));
  });

  afterEach(() => vscode.commands.executeCommand('workbench.action.closeAllEditors'));

  describe('resolving', () => {
    it('follows markdown link text to a file and heading', async () => {
      const leap = assertUri(await api.resolve(readme, at('the guide', 4)), file('docs/guide.md'));
      assert.equal(leap.heading, 'install');
    });

    it('follows wiki links case-insensitively, with headings', async () => {
      assertUri(await api.resolve(readme, at('[[Notes]]', 3)), file('notes/notes.md'));
      const leap = assertUri(await api.resolve(readme, at('[[guide#Usage]]', 3)), file('docs/guide.md'));
      assert.equal(leap.heading, 'Usage');
    });

    it('follows reference links through their definition', async () => {
      assertUri(await api.resolve(readme, at('[Guide][g]', 2)), file('docs/guide.md'));
    });

    it('follows same-document anchors', async () => {
      const leap = assertUri(await api.resolve(readme, at('[usage](#usage)', 2)), file('README.md'));
      assert.equal(leap.heading, 'usage');
    });

    it('finds bare URLs and file paths with line numbers', async () => {
      assertUri(await api.resolve(readme, at('example.com')), 'https://example.com/page');
      const leap = assertUri(await api.resolve(readme, at('app.ts')), file('src/app.ts'));
      assert.deepEqual(leap.position, { line: 3, column: 5 });
    });

    it('applies custom patterns from settings', async () => {
      const leap = assertUri(await api.resolve(readme, at('ABC-42', 1)), 'https://tracker.example.com/browse/ABC-42');
      assert.equal(leap.name, 'Tracker');
    });

    it('offers to create missing wiki notes', async () => {
      const leap = await api.resolve(readme, at('Missing Note', 2));
      assert.equal(leap?.kind, 'missingNote');
    });

    it('ignores plain words', async () => {
      assert.equal(await api.resolve(readme, at('plain')), undefined);
    });

    it('uses link providers from other extensions (built-in Markdown)', async () => {
      const leap = await api.resolve(readme, at('docs/guide.md#install', 2), ['documentLinks']);
      assert.ok(leap && (leap.kind === 'uri' || leap.kind === 'builtin'), `unexpected ${JSON.stringify(leap)}`);
    });

    it('goes to definitions in code', async function () {
      const use = await vscode.workspace.openTextDocument(file('src/use.ts'));
      await vscode.window.showTextDocument(use);
      const position = use.positionAt(use.getText().lastIndexOf('double') + 1);
      // The TypeScript server needs a moment to start; until the project loads it may point at the import.
      const inApp = (l: Leap | undefined) =>
        l?.kind === 'definitions' && l.locations[0].uri.fsPath === file('src/app.ts').fsPath;
      let leap: Leap | undefined;
      for (let attempt = 0; attempt < 60 && !inApp(leap); attempt++) {
        leap = await api.resolve(use, position, ['definition']);
        if (!inApp(leap)) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      assert.equal(leap?.kind, 'definitions');
      const [location] = (leap as Extract<Leap, { kind: 'definitions' }>).locations;
      assert.equal(location.uri.fsPath, file('src/app.ts').fsPath);
      assert.equal(location.range.start.line, 2);
    });
  });

  describe('opening', () => {
    it('opens a linked file at the heading', async () => {
      const editor = await vscode.window.showTextDocument(readme);
      editor.selection = new vscode.Selection(at('the guide', 4), at('the guide', 4));
      await vscode.commands.executeCommand('linkleap.openAtCursor');
      const active = vscode.window.activeTextEditor!;
      assert.equal(active.document.uri.fsPath, file('docs/guide.md').fsPath);
      assert.equal(active.selection.active.line, 2);
    });

    it('jumps to a heading in the same file', async () => {
      const editor = await vscode.window.showTextDocument(readme);
      editor.selection = new vscode.Selection(at('[usage](#usage)', 2), at('[usage](#usage)', 2));
      await vscode.commands.executeCommand('linkleap.openAtCursor');
      assert.equal(vscode.window.activeTextEditor!.document.uri.fsPath, readme.uri.fsPath);
      assert.equal(editor.selection.active.line, at('## Usage').line);
    });

    it('opens a path at its line and column', async () => {
      const editor = await vscode.window.showTextDocument(readme);
      editor.selection = new vscode.Selection(at('app.ts'), at('app.ts'));
      await vscode.commands.executeCommand('linkleap.openAtCursor');
      const active = vscode.window.activeTextEditor!;
      assert.equal(active.document.uri.fsPath, file('src/app.ts').fsPath);
      assert.deepEqual([active.selection.active.line, active.selection.active.character], [2, 4]);
    });
  });

  describe('keyboard', () => {
    it('opens a link to the side', async () => {
      const editor = await vscode.window.showTextDocument(readme, vscode.ViewColumn.One);
      editor.selection = new vscode.Selection(at('[[Notes]]', 3), at('[[Notes]]', 3));
      await vscode.commands.executeCommand('linkleap.openAtCursorBeside');
      const active = vscode.window.activeTextEditor!;
      assert.equal(active.document.uri.fsPath, file('notes/notes.md').fsPath);
      assert.equal(active.viewColumn, vscode.ViewColumn.Two);
    });

    it('lists every link in the file for the picker', async () => {
      const links = await collectLinks(readme);
      const texts = links.map((l) => readme.getText(l.range));
      assert.deepEqual(texts, [
        '[the guide](docs/guide.md#install)',
        '[[Notes]]',
        '[[guide#Usage]]',
        '[Guide][g]',
        '[usage](#usage)',
        'https://example.com/page',
        'ABC-42',
        '[[Missing Note]]',
        '[g]: docs/guide.md',
      ]);
    });
  });

  describe('toggling', () => {
    it('pauses and resumes', async () => {
      assert.equal(api.isPaused(), false);
      await vscode.commands.executeCommand('linkleap.toggle');
      assert.equal(api.isPaused(), true);
      await vscode.commands.executeCommand('linkleap.toggle');
      assert.equal(api.isPaused(), false);
    });

    it('turns off per language', async () => {
      await vscode.window.showTextDocument(readme);
      await vscode.commands.executeCommand('linkleap.toggleForLanguage');
      const config = () => vscode.workspace.getConfiguration('linkleap', { languageId: 'markdown' }).get('enabled');
      assert.equal(config(), false);
      await vscode.commands.executeCommand('linkleap.toggleForLanguage');
      assert.equal(config(), true);
      await vscode.workspace
        .getConfiguration('linkleap', { languageId: 'markdown' })
        .update('enabled', undefined, vscode.ConfigurationTarget.Global, true);
    });
  });
});
