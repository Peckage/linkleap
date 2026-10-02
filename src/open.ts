import * as path from 'path';
import * as vscode from 'vscode';
import { settings } from './config';
import { findHeadingLine } from './core/markdown';
import { isWorkspaceScheme, Leap } from './resolve';

const MARKDOWN_FILE = /\.(md|markdown|mdx)$/i;

export interface OpenOptions {
  /** Overrides `linkleap.openLocation`. */
  beside?: boolean;
}

export async function openLeap(
  leap: Leap,
  editor: vscode.TextEditor | undefined,
  position: vscode.Position,
  options: OpenOptions = {},
): Promise<void> {
  const config = settings(editor?.document);
  const beside = options.beside ?? config.openLocation === 'beside';
  const viewColumn = beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;

  switch (leap.kind) {
    case 'builtin':
      if (editor) {
        editor.selection = new vscode.Selection(position, position);
      }
      await vscode.commands.executeCommand('editor.action.openLink');
      return;

    case 'definitions':
      if (leap.locations.length === 1 || !editor) {
        const [location] = leap.locations;
        await showRange(location.uri, location.range, options.beside ? undefined : editor, viewColumn);
      } else {
        await vscode.commands.executeCommand(
          'editor.action.goToLocations',
          editor.document.uri,
          position,
          leap.locations,
          'peek',
          'No definition found',
        );
      }
      return;

    case 'missingNote':
      await offerToCreateNote(leap.name, leap.folder, config.wikiExtensions[0] ?? 'md', config.offerToCreate, viewColumn);
      return;

    case 'uri':
      break;
  }

  const { uri } = leap;
  if (!isWorkspaceScheme(uri.scheme)) {
    if (config.openUrlsIn === 'simpleBrowser' && /^https?$/.test(uri.scheme)) {
      await vscode.commands.executeCommand('simpleBrowser.show', uri.toString(true));
    } else {
      await vscode.env.openExternal(uri);
    }
    return;
  }

  let stat: vscode.FileStat;
  try {
    stat = await vscode.workspace.fs.stat(uri);
  } catch {
    void vscode.window.showWarningMessage(`LinkLeap: ${vscode.workspace.asRelativePath(uri)} doesn't exist.`);
    return;
  }
  if (stat.type & vscode.FileType.Directory) {
    await vscode.commands.executeCommand('revealInExplorer', uri);
    return;
  }

  const isOtherFile = uri.toString() !== editor?.document.uri.toString();
  if (isOtherFile && config.openMarkdownIn === 'preview' && MARKDOWN_FILE.test(uri.path)) {
    await vscode.commands.executeCommand(
      beside ? 'markdown.showPreviewToSide' : 'markdown.showPreview',
      uri,
    );
    return;
  }

  let range: vscode.Range | undefined;
  if (leap.position) {
    const at = new vscode.Position(leap.position.line - 1, Math.max(0, (leap.position.column ?? 1) - 1));
    range = new vscode.Range(at, at);
  } else if (leap.heading) {
    range = await headingRange(uri, leap.heading);
  }
  await showRange(uri, range, options.beside ? undefined : editor, viewColumn);
}

/**
 * Same-file jumps move the cursor in place (unless "open to the side" was asked for explicitly);
 * other files open according to `linkleap.openLocation`.
 */
async function showRange(
  uri: vscode.Uri,
  range: vscode.Range | undefined,
  editor: vscode.TextEditor | undefined,
  viewColumn: vscode.ViewColumn,
): Promise<void> {
  if (editor && uri.toString() === editor.document.uri.toString() ) {
    if (range) {
      editor.selection = new vscode.Selection(range.start, range.start);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    return;
  }
  await vscode.commands.executeCommand('vscode.open', uri, { viewColumn, selection: range });
}

async function headingRange(uri: vscode.Uri, heading: string): Promise<vscode.Range | undefined> {
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const line = findHeadingLine(document.getText(), heading);
    return line === undefined ? undefined : new vscode.Range(line, 0, line, 0);
  } catch {
    return undefined;
  }
}

async function offerToCreateNote(
  name: string,
  folder: vscode.Uri,
  extension: string,
  offer: boolean,
  viewColumn: vscode.ViewColumn,
): Promise<void> {
  if (!offer) {
    void vscode.window.setStatusBarMessage(`LinkLeap: no note named "${name}"`, 4000);
    return;
  }
  const choice = await vscode.window.showInformationMessage(`LinkLeap: no note named "${name}" yet.`, 'Create Note');
  if (choice !== 'Create Note') {
    return;
  }
  const fileName = name.toLowerCase().endsWith(`.${extension.toLowerCase()}`) ? name : `${name}.${extension}`;
  const uri = vscode.Uri.joinPath(folder, fileName);
  const title = path.posix.basename(name);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(`# ${title}\n\n`, 'utf8'));
  await vscode.commands.executeCommand('vscode.open', uri, { viewColumn, selection: new vscode.Range(2, 0, 2, 0) });
}
