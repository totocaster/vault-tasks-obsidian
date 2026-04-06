# Vault Tasks

An Obsidian plugin that collects tasks from across your vault into a single grouped view.

## What it does

- Groups tasks by note title
- Groups note tasks by source section headings
- Filters tasks by pending, completed, or all
- Updates the original Markdown file when task state changes
- Supports note-level defer and hide controls via frontmatter

## Usage

Open `Vault tasks` from the ribbon icon or the command palette.

The view is designed to feel like normal Obsidian reading view:

- note titles render as `##` headings
- section headings render as `###`
- tasks use standard Markdown task styling
- task and heading context menus expose note and task actions

## Frontmatter

The plugin currently recognizes these note-level keys:

- `deffered-until: YYYY-MM-DD`
- `hide-from-vault-tasks: true`

## Development

```bash
npm install
npm run dev
```

Build once:

```bash
npm run build
```

To test in a vault, symlink this folder into:

```text
.obsidian/plugins/vault-tasks-view
```

## License

[MIT](./LICENSE)
