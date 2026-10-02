import * as vscode from 'vscode';
import { settings } from './config';
import { describeLeap, resolveLeap } from './resolve';

/** Shows "double-click to open …" on anything LinkLeap can follow, so the feature is discoverable. */
export class LeapHoverProvider implements vscode.HoverProvider {
  constructor(private readonly isActive: () => boolean) {}

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    const config = settings(document);
    if (!this.isActive() || !config.enabled || !config.hover) {
      return undefined;
    }
    // Definitions already have their own hovers, and asking for them on every hover is costly.
    const targets = config.targets.filter((t) => t !== 'definition');
    const leap = await resolveLeap(document, position, { targets });
    if (!leap) {
      return undefined;
    }
    const target = describeLeap(leap).replace(/`/g, "'");
    const verb = leap.kind === 'missingNote' ? 'create' : 'open';
    const markdown = new vscode.MarkdownString(`$(link) Double-click to ${verb} \`${target}\``, true);
    markdown.isTrusted = false;
    return new vscode.Hover(markdown);
  }
}
