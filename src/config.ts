import * as vscode from 'vscode';
import { compileRule, PatternRule } from './core/text';

export type TargetKind =
  | 'patterns'
  | 'markdown'
  | 'wikiLinks'
  | 'documentLinks'
  | 'urlsAndPaths'
  | 'issues'
  | 'symbols'
  | 'definition';

export const ALL_TARGETS: readonly TargetKind[] = [
  'patterns',
  'markdown',
  'wikiLinks',
  'documentLinks',
  'urlsAndPaths',
  'issues',
  'symbols',
  'definition',
];

/** Languages where people write prose, so code-shaped words and commit SHAs are likely references. */
export const PROSE_LANGUAGES = new Set([
  'markdown',
  'mdx',
  'plaintext',
  'restructuredtext',
  'asciidoc',
  'git-commit',
  'git-rebase',
  'scminput',
  'log',
  'diff',
]);

const DEFAULT_SEPARATORS = '`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?';

export function settings(document?: vscode.TextDocument) {
  const cfg = vscode.workspace.getConfiguration('linkleap', document);
  return {
    enabled: cfg.get<boolean>('enabled', true),
    targets: cfg.get<string[]>('targets', []).filter((t): t is TargetKind => ALL_TARGETS.includes(t as TargetKind)),
    triggerDelay: Math.max(0, cfg.get<number>('triggerDelay', 300)),
    clearSelection: cfg.get<boolean>('clearSelection', true),
    openMode: cfg.get<'open' | 'peek'>('openMode', 'open'),
    openLocation: cfg.get<'active' | 'beside'>('openLocation', 'active'),
    openMarkdownIn: cfg.get<'editor' | 'preview'>('openMarkdownIn', 'editor'),
    openUrlsIn: cfg.get<'external' | 'simpleBrowser'>('openUrlsIn', 'external'),
    wikiExtensions: cfg.get<string[]>('wikiLinks.fileExtensions', ['md']),
    offerToCreate: cfg.get<boolean>('wikiLinks.offerToCreate', true),
    hover: cfg.get<boolean>('hover.enabled', true),
    statusBar: cfg.get<boolean>('statusBar.enabled', true),
  };
}

export function wordSeparators(document: vscode.TextDocument): string {
  return vscode.workspace.getConfiguration('editor', document).get<string>('wordSeparators', DEFAULT_SEPARATORS);
}

interface CompiledRule {
  rule: PatternRule;
  regex: RegExp;
}

let cachedRules: { source: string; rules: CompiledRule[] } | undefined;
const reportedErrors = new Set<string>();

/** The user's `linkleap.patterns`, compiled once per settings change. Bad regexes are reported once and skipped. */
export function patternRules(document: vscode.TextDocument): CompiledRule[] {
  const raw = vscode.workspace.getConfiguration('linkleap', document).get<PatternRule[]>('patterns', []);
  const source = JSON.stringify(raw);
  if (cachedRules?.source !== source) {
    const rules: CompiledRule[] = [];
    for (const rule of Array.isArray(raw) ? raw : []) {
      if (typeof rule?.pattern !== 'string' || typeof rule?.target !== 'string') {
        continue;
      }
      try {
        rules.push({ rule, regex: compileRule(rule) });
      } catch (err) {
        if (!reportedErrors.has(rule.pattern)) {
          reportedErrors.add(rule.pattern);
          void vscode.window.showWarningMessage(`LinkLeap: invalid pattern "${rule.pattern}": ${(err as Error).message}`);
        }
      }
    }
    cachedRules = { source, rules };
  }
  return cachedRules.rules.filter(({ rule }) => !rule.languages?.length || rule.languages.includes(document.languageId));
}
