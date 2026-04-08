# Vault Tasks

Vault Tasks is an Obsidian plugin that gathers Markdown tasks from across your vault into one grouped view while keeping the original notes as the source of truth.

There is also a companion CLI, [`vault-tasks`](https://github.com/totocaster/vault-tasks-obsidian-cli), designed so scripts and AI agents can inspect the same task view the plugin shows to the user.

## Why

The goal is to make a global task list feel like a normal Obsidian note:

- note groups render like `##` headings
- section groups render like `###` headings
- tasks keep normal Markdown checkbox styling
- checking a task updates the original note

## Features

- Groups tasks by note
- Optionally groups tasks inside each note by source heading
- Filters by pending, completed, or all
- Filters by section name across notes
- Supports pinned notes at the top of the list
- Adds quick note and task actions from inline controls and context menus
- Supports note-level defer and hide behavior through frontmatter

## Companion CLI

The companion CLI, [`vault-tasks`](https://github.com/totocaster/vault-tasks-obsidian-cli), is primarily meant for automations, terminals, and AI agents.

It reads the vault and the plugin's saved settings, then renders the same grouped task view and filtering logic used by the Obsidian plugin. That makes it useful when an agent or script needs the same task context the user sees in Obsidian, without inventing a separate task model.

## Frontmatter

Recognized note-level keys:

- `deferred-until: YYYY-MM-DD`
- `hide-from-vault-tasks: true`

## Settings

The plugin includes a small settings pane for vault-level conventions:

- default open location and filter
- related-notes and section-heading defaults
- persisted section filter
- standard or extended task status actions
- pending and completed filter behavior
- include and exclude folder scope
- note, section, and task sorting

## Development

Install dependencies and start watch mode:

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

For local vault development, symlink this repo into:

```text
.obsidian/plugins/vault-tasks-view
```

## License

[MIT](./LICENSE)
