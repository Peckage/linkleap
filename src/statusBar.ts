import * as vscode from 'vscode';
import { settings } from './config';

export class LeapStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('linkleap.status', vscode.StatusBarAlignment.Right, 100);

  constructor(private readonly isPaused: () => boolean) {
    this.item.name = 'LinkLeap';
    this.item.command = 'linkleap.toggle';
    this.update();
  }

  update(): void {
    const document = vscode.window.activeTextEditor?.document;
    const config = settings(document);
    if (!config.statusBar) {
      this.item.hide();
      return;
    }
    const paused = this.isPaused();
    const languageOff = !!document && !config.enabled;
    const language = document ? `\`${document.languageId}\`` : 'this file';

    this.item.text = paused || languageOff ? '$(circle-slash) Leap' : '$(link) Leap';
    const tooltip = new vscode.MarkdownString(undefined, true);
    if (paused) {
      tooltip.appendMarkdown('**LinkLeap is off.** Double-clicks just select words.\n\nClick to turn it back on.');
    } else if (languageOff) {
      tooltip.appendMarkdown(
        `**LinkLeap is off for ${language}** (\`linkleap.enabled\`).\n\nRun *LinkLeap: Toggle Double-Click Links for Current Language* to turn it on.`,
      );
    } else {
      tooltip.appendMarkdown(
        `**LinkLeap is on.** Double-click a link in ${language} to open it.\n\nClick to turn it off.`,
      );
    }
    this.item.tooltip = tooltip;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
