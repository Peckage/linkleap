import * as vscode from 'vscode';
import { patternRules, settings } from './config';
import { markdownSpans, Span } from './core/markdown';
import { outermostSpans, textSpans } from './core/text';
import { openLeap } from './open';
import { describeLeap, documentLinksFor, Leap, resolveLeap } from './resolve';

const MAX_LINES = 20_000;
const MAX_LINKS = 500;

interface LinkItem extends vscode.QuickPickItem {
  range: vscode.Range;
  leap: Leap;
}

const OPEN_BESIDE: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('split-horizontal'),
  tooltip: 'Open to the Side',
};

/** Every followable link in the document, in order. */
export async function collectLinks(document: vscode.TextDocument): Promise<{ range: vscode.Range; leap: Leap }[]> {
  const rules = patternRules(document);
  const spansByLine = new Map<number, Span[]>();
  const lineCount = Math.min(document.lineCount, MAX_LINES);
  for (let line = 0; line < lineCount; line++) {
    const text = document.lineAt(line).text;
    const spans = [...markdownSpans(text), ...textSpans(text, rules)];
    if (spans.length) {
      spansByLine.set(line, spans);
    }
  }
  for (const link of (await documentLinksFor(document)) ?? []) {
    if (link.range.isSingleLine && link.range.start.line < lineCount) {
      const spans = spansByLine.get(link.range.start.line) ?? [];
      spans.push({ start: link.range.start.character, end: link.range.end.character });
      spansByLine.set(link.range.start.line, spans);
    }
  }

  const ranges: vscode.Range[] = [];
  for (const line of [...spansByLine.keys()].sort((a, b) => a - b)) {
    for (const span of outermostSpans(spansByLine.get(line)!)) {
      ranges.push(new vscode.Range(line, span.start, line, span.end));
    }
  }

  // Definitions are left out: every identifier in a code file would qualify.
  const targets = settings(document).targets.filter((t) => t !== 'definition');
  const resolved = await Promise.all(
    ranges.slice(0, MAX_LINKS).map(async (range) => ({ range, leap: await resolveLeap(document, range.start, { targets }) })),
  );
  return resolved.filter((r): r is { range: vscode.Range; leap: Leap } => !!r.leap);
}

/** Keyboard-driven link list: arrow through links (the editor follows along), Enter to open. */
export async function pickLink(editor: vscode.TextEditor): Promise<void> {
  const document = editor.document;
  const links = await collectLinks(document);
  if (!links.length) {
    vscode.window.setStatusBarMessage('LinkLeap: no links in this file', 2500);
    return;
  }

  const items: LinkItem[] = links.map(({ range, leap }) => {
    const text = document.getText(range);
    return {
      label: text.length > 80 ? `${text.slice(0, 79)}…` : text,
      description: `${describeLeap(leap)} · Ln ${range.start.line + 1}`,
      range,
      leap,
      buttons: [OPEN_BESIDE],
      iconPath: new vscode.ThemeIcon(leap.kind === 'missingNote' ? 'new-file' : 'link'),
    };
  });

  const originalSelections = editor.selections;
  const originalVisible = editor.visibleRanges[0];
  const quickPick = vscode.window.createQuickPick<LinkItem>();
  quickPick.items = items;
  quickPick.matchOnDescription = true;
  quickPick.placeholder = `${items.length} link${items.length === 1 ? '' : 's'} — Enter to open, button to open to the side`;

  // Start on the first link at or after the cursor.
  const cursor = editor.selection.active;
  const startItem = items.find((item) => !item.range.end.isBefore(cursor)) ?? items[0];
  quickPick.activeItems = [startItem];

  let accepted = false;
  const go = (item: LinkItem, beside: boolean) => {
    accepted = true;
    quickPick.hide();
    editor.selection = new vscode.Selection(item.range.start, item.range.start);
    openLeap(item.leap, editor, item.range.start, { beside }).catch((err) => console.error('[LinkLeap]', err));
  };

  quickPick.onDidChangeActive(([item]) => {
    if (item) {
      editor.selection = new vscode.Selection(item.range.start, item.range.end);
      editor.revealRange(item.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  });
  quickPick.onDidAccept(() => {
    const [item] = quickPick.selectedItems.length ? quickPick.selectedItems : quickPick.activeItems;
    if (item) {
      go(item, false);
    }
  });
  quickPick.onDidTriggerItemButton(({ item }) => go(item, true));
  quickPick.onDidHide(() => {
    if (!accepted) {
      editor.selections = originalSelections;
      if (originalVisible) {
        editor.revealRange(originalVisible, vscode.TextEditorRevealType.AtTop);
      }
    }
    quickPick.dispose();
  });
  quickPick.show();
}
