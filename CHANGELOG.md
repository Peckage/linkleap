# Changelog

## 0.2.0

- **Peek mode**: set `linkleap.openMode` to `peek` (globally or per language), or run *LinkLeap: Peek Link at Cursor*, to see targets inline instead of switching tabs.
- **Issue links**: `#123`, `owner/repo#45`, `GH-12`, GitLab `!34` and commit SHAs open on GitHub, GitLab, Bitbucket or Gitea/Forgejo, read from the git `origin` remote (or `linkleap.issues.repository`).
- **Symbols in prose**: double-click `` `parseConfig()` `` or a camelCase/snake_case word in Markdown to jump to that symbol via workspace symbol search, falling back to a declaration scan when no language server is running.
- **Backlinks view** in the Explorer: every Markdown/wiki/reference link to the current file, kept up to date as files change.
- The link picker now includes issue references.

## 0.1.0

- Double-click to follow Markdown links (including link text and reference links), `[[wiki links]]`, `#heading` anchors, bare URLs, file paths with `:line:col`, anything VS Code makes Ctrl+Clickable, custom regex patterns, and (opt-in) Go to Definition.
- Keyboard: `Alt+Enter` opens the link at the cursor, `Alt+Shift+Enter` opens it to the side, `Ctrl+Alt+O` lists every link in the file.
- Status bar toggle (`Ctrl+Alt+L`), per-language settings, open-location settings and a hover hint.
