# LinkLeap

**Double-click to follow links in VS Code, so you don't have to Ctrl+Click.**

LinkLeap turns a double-click on a link into a jump. It works in Markdown, plain text, logs, code comments and config files, and with anything else VS Code can already Ctrl+Click. A single click, a triple-click or a drag still selects text as usual.

It also adds keyboard shortcuts for following links, a peek mode, issue links read from your git remote, jumps to code symbols mentioned in docs, and a Backlinks view.

## What it can follow

| Target | Examples | Setting value |
| --- | --- | --- |
| Custom patterns | `PROJ-123` → your Jira, `#42` → a GitHub issue | `patterns` |
| Markdown links, clicked anywhere on the link (text too) | `[setup guide](docs/setup.md#install)`, `[text][ref]`, `<https://…>`, `[ref]: url` lines | `markdown` |
| Wiki links (Obsidian/Foam style) | `[[Project Plan]]`, `[[Plan#Next Steps]]`, `[[Plan\|alias]]`, `[[#Heading]]` | `wikiLinks` |
| Anything VS Code makes Ctrl+Clickable | `package.json` deps, HTML `href`s, links from other extensions | `documentLinks` |
| Bare URLs and file paths | `https://…`, `www.…`, `src/app.ts:12:5`, `Program.cs(10,3)`, `README.md#L42`, `+++ b/src/x.ts` | `urlsAndPaths` |
| Issues, PRs/MRs and commits | `#123`, `owner/repo#45`, `GH-12`, `!34` (GitLab), `2242ebb` | `issues` |
| Code symbols in docs | `` `parseConfig()` ``, `` `UserService.find` ``, and `camelCase` / `snake_case` words in Markdown | `symbols` |
| Go to Definition (opt-in) | Any symbol in code | `definition` |

Wiki links are matched case-insensitively, and the note closest to the current file wins. Double-clicking a wiki link to a note that doesn't exist yet offers to create it.

## Keyboard

| Keys | Command |
| --- | --- |
| `Alt+Enter` | **LinkLeap: Open Link at Cursor.** Also falls back to Go to Definition. |
| `Alt+Shift+Enter` | **LinkLeap: Open Link at Cursor to the Side** |
| (unbound) | **LinkLeap: Peek Link at Cursor** |
| `Ctrl+Alt+O` (`Cmd+Alt+O` on Mac) | **LinkLeap: Go to Link in File...** Lists every link in the file. Arrow keys move the editor to each link, Enter opens it, and the split button opens it to the side. |
| `Ctrl+Alt+L` (`Cmd+Alt+L` on Mac) | **LinkLeap: Toggle Double-Click Links** |

*Open Link at Cursor*, *Peek Link at Cursor* and *Go to Link in File...* are also in the editor's right-click menu. You can rebind any of these in **Keyboard Shortcuts**.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `linkleap.enabled` | `true` | Turn double-click links on or off. Can be set per language. |
| `linkleap.targets` | all except `definition` | Which targets to follow, tried in order. Can be set per language. |
| `linkleap.triggerDelay` | `300` | How many ms to wait before jumping, so a triple-click or double-click-drag doesn't trigger a jump. `0` jumps instantly. |
| `linkleap.clearSelection` | `true` | Collapse the selected word after jumping. |
| `linkleap.openMode` | `open` | `open` or `peek`. Can be set per language. |
| `linkleap.openLocation` | `active` | `active` or `beside`. |
| `linkleap.openMarkdownIn` | `editor` | `editor` or `preview` for linked `.md` files. |
| `linkleap.openUrlsIn` | `external` | `external` browser or VS Code's `simpleBrowser`. |
| `linkleap.patterns` | `[]` | Custom rules (see below). |
| `linkleap.wikiLinks.fileExtensions` | `["md","markdown","mdx"]` | Extensions searched for `[[wiki links]]`. |
| `linkleap.wikiLinks.offerToCreate` | `true` | Offer to create missing notes. |
| `linkleap.issues.repository` | `""` | Repository for issue links when it can't be read from git, e.g. `owner/repo` or `https://gitlab.example.com/group/repo`. |
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

## Peek mode

Set `"linkleap.openMode": "peek"` to show a link's target in a peek window under the link instead of switching tabs. You can set it per language, e.g. peek in Markdown but open normally in code. You can also peek once with **LinkLeap: Peek Link at Cursor** or from the right-click menu. URLs, folders and binary files such as images always open normally.

## Issue links

LinkLeap reads the `origin` remote from your git repository, including worktrees and submodules, and links references to the right place:

| Reference | GitHub / Gitea / Forgejo | GitLab | Bitbucket |
| --- | --- | --- | --- |
| `#123`, `GH-123` | `/issues/123`, which also redirects to PRs | `/-/issues/123` | `/issues/123` |
| `owner/repo#45` | that repo's `/issues/45` | that repo's `/-/issues/45` | that repo's `/issues/45` |
| `!34` | – | `/-/merge_requests/34` | – |
| commit SHA (7–40 hex chars) | `/commit/<sha>` | `/-/commit/<sha>` | `/commits/<sha>` |

Commit SHAs are only detected in prose files (Markdown, plain text, commit messages, logs, diffs), so hex strings in code aren't mistaken for commits. `#123` is ignored in stylesheets, where it's a colour. If the folder isn't a git repository, set `linkleap.issues.repository`.

## Symbols in prose

In Markdown and plain text, double-clicking `` `parseConfig()` ``, `` `UserService.find` ``, or a code-shaped word like `UserService` or `load_config` jumps to that symbol. LinkLeap asks VS Code's workspace symbol search first. If no language server is running yet, it scans your source files for a matching declaration such as `function`, `class`, `def`, `fn` or `func`. If there are several matches, they open in a peek window.

In code files, only code-shaped text in backticks counts (e.g. `` // see `parseConfig()` ``). This keeps JavaScript template strings and shell backticks from triggering jumps.

## Backlinks

The **Backlinks** view in the Explorer lists every Markdown link, reference definition and `[[wiki link]]` in the workspace that points to the file you're viewing. The matching text in each line is highlighted, and clicking a line opens it. The index updates as files are created, changed or deleted.

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

### Releasing

1. Bump `version` in `package.json` and add a `## x.y.z` section to `CHANGELOG.md`.
2. Commit, then `git tag vx.y.z && git push --follow-tags`.

The **Release** workflow tests the build, attaches the `.vsix` to a GitHub release, and publishes to:

- **VS Code Marketplace** when the `VSCE_PAT` secret is set. This needs a publisher named `peckage` at <https://marketplace.visualstudio.com/manage> and an Azure DevOps token with the *Marketplace → Manage* scope.
- **Open VSX** when the `OVSX_PAT` secret is set. This needs a token from <https://open-vsx.org/user-settings/tokens> and a one-time `npx ovsx create-namespace peckage -p <token>`.

## License

MIT
