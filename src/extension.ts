import * as vscode from 'vscode';
import { BacklinkIndex, BacklinksView } from './backlinks';
import { settings, TargetKind, wordSeparators } from './config';
import { DoubleClickDetector } from './core/doubleClick';
import { LeapHoverProvider } from './hover';
import { openLeap } from './open';
import { pickLink } from './picker';
import { forgetDocument, Leap, resolveLeap } from './resolve';
import { LeapStatusBar } from './statusBar';

const PAUSED_KEY = 'linkleap.paused';

/** Returned from `activate` so tests (and other extensions) can drive LinkLeap. */
export interface LinkLeapApi {
  resolve(document: vscode.TextDocument, position: vscode.Position, targets?: TargetKind[]): Promise<Leap | undefined>;
  isPaused(): boolean;
}

export function activate(context: vscode.ExtensionContext): LinkLeapApi {
  const detector = new DoubleClickDetector();
  const isPaused = () => context.globalState.get<boolean>(PAUSED_KEY, false);
  const statusBar = new LeapStatusBar(isPaused);
  let pending: ReturnType<typeof setTimeout> | undefined;

  const cancelPending = () => {
    if (pending) {
      clearTimeout(pending);
      pending = undefined;
    }
  };

  async function followDoubleClick(editor: vscode.TextEditor, selection: vscode.Selection): Promise<void> {
    // The user may have clicked elsewhere during the trigger delay or while we resolved.
    const stillCurrent = () => vscode.window.activeTextEditor === editor && editor.selection.isEqual(selection);
    if (!stillCurrent()) {
      return;
    }
    const position = selection.start;
    const leap = await resolveLeap(editor.document, position);
    if (!leap || !stillCurrent()) {
      return;
    }
    if (settings(editor.document).clearSelection) {
      editor.selection = new vscode.Selection(position, position);
    }
    await openLeap(leap, editor, position);
  }

  async function openAtCursor(options: { beside?: boolean; peek?: boolean }): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    // Invoked on purpose from the keyboard, so Go to Definition is always a fair fallback here.
    const targets = settings(editor.document).targets;
    const position = editor.selection.active;
    const leap = await resolveLeap(editor.document, position, {
      targets: targets.includes('definition') ? targets : [...targets, 'definition'],
    });
    if (!leap) {
      vscode.window.setStatusBarMessage('LinkLeap: nothing to open here', 2500);
      return;
    }
    await openLeap(leap, editor, position, options);
  }

  const backlinkIndex = new BacklinkIndex();
  const backlinksView = new BacklinksView(backlinkIndex);

  context.subscriptions.push(
    statusBar,
    backlinkIndex,
    backlinksView,
    vscode.commands.registerCommand('linkleap.refreshBacklinks', () => backlinkIndex.rebuild()),

    vscode.window.onDidChangeTextEditorSelection((event) => {
      cancelPending();
      const { textEditor: editor, selections } = event;
      const document = editor.document;
      const selection = selections[0];
      if (!selection) {
        detector.reset();
        return;
      }
      const isDoubleClick = detector.feed(
        {
          time: Date.now(),
          fromMouse: event.kind === vscode.TextEditorSelectionChangeKind.Mouse,
          count: selections.length,
          startLine: selection.start.line,
          startChar: selection.start.character,
          endLine: selection.end.line,
          endChar: selection.end.character,
        },
        document.lineAt(selection.start.line).text,
        wordSeparators(document),
      );
      if (!isDoubleClick || isPaused()) {
        return;
      }
      const config = settings(document);
      if (!config.enabled || !config.targets.length) {
        return;
      }
      const fire = () => {
        pending = undefined;
        followDoubleClick(editor, selection).catch((err) => console.error('[LinkLeap]', err));
      };
      if (config.triggerDelay === 0) {
        fire();
      } else {
        pending = setTimeout(fire, config.triggerDelay);
      }
    }),

    vscode.languages.registerHoverProvider('*', new LeapHoverProvider(() => !isPaused())),

    vscode.commands.registerCommand('linkleap.toggle', async () => {
      const paused = !isPaused();
      await context.globalState.update(PAUSED_KEY, paused);
      statusBar.update();
      vscode.window.setStatusBarMessage(paused ? 'LinkLeap: double-click links off' : 'LinkLeap: double-click links on', 2500);
    }),

    vscode.commands.registerCommand('linkleap.toggleForLanguage', async () => {
      const languageId = vscode.window.activeTextEditor?.document.languageId;
      if (!languageId) {
        void vscode.window.showInformationMessage('LinkLeap: open a file first.');
        return;
      }
      const config = vscode.workspace.getConfiguration('linkleap', { languageId });
      const enabled = !config.get<boolean>('enabled', true);
      await config.update('enabled', enabled, vscode.ConfigurationTarget.Global, true);
      vscode.window.setStatusBarMessage(`LinkLeap: double-click links ${enabled ? 'on' : 'off'} for ${languageId}`, 2500);
    }),

    vscode.commands.registerCommand('linkleap.openAtCursor', () => openAtCursor({})),
    vscode.commands.registerCommand('linkleap.openAtCursorBeside', () => openAtCursor({ beside: true })),
    vscode.commands.registerCommand('linkleap.peekAtCursor', () => openAtCursor({ peek: true })),
    vscode.commands.registerCommand('linkleap.pickLink', async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        await pickLink(editor);
      }
    }),

    vscode.window.onDidChangeActiveTextEditor(() => statusBar.update()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('linkleap')) {
        statusBar.update();
      }
      if (e.affectsConfiguration('linkleap.wikiLinks.fileExtensions')) {
        void backlinkIndex.rebuild();
      }
    }),
    vscode.workspace.onDidCloseTextDocument(forgetDocument),
    { dispose: cancelPending },
  );

  return {
    resolve: (document, position, targets) => resolveLeap(document, position, { targets }),
    isPaused,
  };
}

export function deactivate(): void {}
