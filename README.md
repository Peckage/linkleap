# LinkLeap

**Double-click to follow links in VS Code, so you don't have to Ctrl+Click.**

LinkLeap turns a double-click on a link into a jump. It works in Markdown, plain text, logs, code comments and config files, and with anything else VS Code can already Ctrl+Click. A single click, a triple-click or a drag still selects text as usual.

## What it can follow

| Target | Examples | Setting value |
| --- | --- | --- |
| Custom patterns | `PROJ-123` → your Jira, `#42` → a GitHub issue | `patterns` |
| Markdown links, clicked anywhere on the link (text too) | `[setup guide](docs/setup.md#install)`, `[text][ref]`, `<https://…>`, `[ref]: url` lines | `markdown` |
| Wiki links (Obsidian/Foam style) | `[[Project Plan]]`, `[[Plan#Next Steps]]`, `[[Plan\|alias]]`, `[[#Heading]]` | `wikiLinks` |
| Anything VS Code makes Ctrl+Clickable | `package.json` deps, HTML `href`s, links from other extensions | `documentLinks` |
| Bare URLs and file paths | `https://…`, `www.…`, `src/app.ts:12:5`, `Program.cs(10,3)`, `README.md#L42`, `+++ b/src/x.ts` | `urlsAndPaths` |
| Go to Definition (opt-in) | Any symbol in code | `definition` |

Wiki links are matched case-insensitively, and the note closest to the current file wins. Double-clicking a wiki link to a note that doesn't exist yet offers to create it.

## Keyboard

| Keys | Command |
| --- | --- |
| `Alt+Enter` | **LinkLeap: Open Link at Cursor.** Also falls back to Go to Definition. |
| `Alt+Shift+Enter` | **LinkLeap: Open Link at Cursor to the Side** |
| `Ctrl+Alt+O` (`Cmd+Alt+O` on Mac) | **LinkLeap: Go to Link in File...** Lists every link in the file. Arrow keys move the editor to each link, Enter opens it, and the split button opens it to the side. |
| `Ctrl+Alt+L` (`Cmd+Alt+L` on Mac) | **LinkLeap: Toggle Double-Click Links** |

*Open Link at Cursor* and *Go to Link in File...* are also in the editor's right-click menu. You can rebind any of these in **Keyboard Shortcuts**.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `linkleap.enabled` | `true` | Turn double-click links on or off. Can be set per language. |
| `linkleap.targets` | all except `definition` | Which targets to follow, tried in order. Can be set per language. |
| `linkleap.triggerDelay` | `300` | How many ms to wait before jumping, so a triple-click or double-click-drag doesn't trigger a jump. `0` jumps instantly. |
| `linkleap.clearSelection` | `true` | Collapse the selected word after jumping. |
| `linkleap.openLocation` | `active` | `active` or `beside`. |
| `linkleap.openMarkdownIn` | `editor` | `editor` or `preview` for linked `.md` files. |
| `linkleap.openUrlsIn` | `external` | `external` browser or VS Code's `simpleBrowser`. |
| `linkleap.patterns` | `[]` | Custom rules (see below). |
| `linkleap.wikiLinks.fileExtensions` | `["md","markdown","mdx"]` | Extensions searched for `[[wiki links]]`. |
| `linkleap.wikiLinks.offerToCreate` | `true` | Offer to create missing notes. |
| `linkleap.hover.enabled` | `true` | Show the "Double-click to open …" hover. |
| `linkleap.statusBar.enabled` | `true` | Show the on/off toggle in the status bar. |

### Per-language examples

```jsonc
{
  // Go to Definition on double-click in TypeScript, as well as links.
  "[typescript]": {
    "linkleap.targets": ["patterns", "documentLinks", "urlsAndPaths", "definition"]
  },
  // Turn it off for plain text.
  "[plaintext]": { "linkleap.enabled": false }
}
```

You can also run **LinkLeap: Toggle Double-Click Links for Current Language** to turn it off for the current language.

### Custom patterns

```jsonc
"linkleap.patterns": [
  { "name": "Jira", "pattern": "\\b([A-Z][A-Z0-9]+-\\d+)\\b", "target": "https://jira.example.com/browse/$1" },
  { "name": "GitHub issue", "pattern": "(?<![\\w&])#(\\d+)\\b", "target": "https://github.com/me/repo/issues/$1", "languages": ["markdown", "git-commit"] },
  { "name": "ADR", "pattern": "\\bADR-(\\d{4})\\b", "target": "${workspaceFolder}/docs/adr/$1.md" }
]
```

`target` can use `$0` (the whole match), `$1`–`$9` (capture groups), `${workspaceFolder}`, `${file}` and `${fileDirname}`. It can be a URL or a file path. Relative paths resolve from the workspace folder, and a `#L10` or `#heading` suffix jumps inside the file.

## How it works

VS Code doesn't give extensions mouse events. LinkLeap watches for what a double-click leaves behind instead: a single mouse-driven selection change that selects exactly one word, according to your `editor.wordSeparators`. A drag reaches the same selection through a series of growing partial selections, so it is ignored.

After a double-click, LinkLeap waits `triggerDelay` ms. If the selection changes again in that time (a triple-click or a drag), it does nothing. Otherwise it resolves the word under the cursor against your targets, in order, and opens the first match.

## Development

```sh
npm install
npm run test:unit                                    # pure logic, node:test
VSCODE_PATH=/usr/share/code/code npm run test:integration   # runs inside VS Code (omit VSCODE_PATH to download one)
npm run package                                      # builds linkleap-x.y.z.vsix
```

Press `F5` in VS Code to launch an Extension Development Host on `test-fixtures/workspace`.

## License

MIT
