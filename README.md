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

- `deferred-until: YYYY-MM-DD`
- `hide-from-vault-tasks: true`

## Settings

The plugin includes a small settings pane for vault-level conventions:

- view defaults like open location and default filter
- related-note and section-heading defaults
- optional persisted section filter
- standard vs extended task status actions
- pending/completed filter behavior
- include and exclude folder scope
- note, section, and task sorting

## Development

```bash
npm install
npm run dev
```

Build once:

```bash
npm run build
```

Run tests:

```bash
npm test
```

To test in a vault, symlink this folder into:

```text
.obsidian/plugins/vault-tasks-view
```

## License

[MIT](./LICENSE)
