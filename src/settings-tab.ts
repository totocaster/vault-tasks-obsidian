import { PluginSettingTab, Setting } from "obsidian";
import {
	NOTE_SORT_LABELS,
	SECTION_SORT_LABELS,
	TASK_SORT_LABELS,
	normalizeNoteSortMode,
	normalizePendingMode,
	normalizeSectionSortMode,
	normalizeTaskFilter,
	normalizeTaskSortMode,
	normalizeTaskStatusMode,
	normalizeTaskViewLocation,
} from "./config";
import { formatFolderList, parseFolderListInput } from "./lib/settings";
import type VaultTasksPlugin from "./plugin";

export class VaultTasksSettingTab extends PluginSettingTab {
	constructor(app: VaultTasksPlugin["app"], private readonly plugin: VaultTasksPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const settings = this.plugin.getSettings();

		containerEl.empty();

		new Setting(containerEl).setName("View defaults").setHeading();

		new Setting(containerEl)
			.setName("Open location")
			.setDesc("Choose where the task view opens when a new leaf is created.")
			.addDropdown((component) => {
				component
					.addOption("main", "Main tab")
					.addOption("sidebar", "Right sidebar")
					.setValue(settings.openLocation)
					.onChange(async (value) => {
						await this.plugin.updateSettings({
							openLocation: normalizeTaskViewLocation(value),
						});
					});
			});

		new Setting(containerEl)
			.setName("Default filter")
			.setDesc("Choose which task filter the view starts with.")
			.addDropdown((component) => {
				component
					.addOption("pending", "Pending")
					.addOption("all", "All")
					.addOption("completed", "Completed")
					.setValue(settings.defaultFilter)
					.onChange(async (value) => {
						const defaultFilter = normalizeTaskFilter(value);
						await this.plugin.updateSettings({ defaultFilter });
						await this.plugin.setFilter(defaultFilter);
					});
			});

		new Setting(containerEl)
			.setName("Show related notes by default")
			.setDesc("Show backlink context under note titles when the view opens.")
			.addToggle((component) => {
				component.setValue(settings.showConnectionsByDefault).onChange(async (value) => {
					await this.plugin.updateSettings({
						showConnectionsByDefault: value,
					});
					await this.plugin.setShowConnections(value);
				});
			});

		new Setting(containerEl)
			.setName("Show section headings")
			.setDesc("Render source headings inside each note group.")
			.addToggle((component) => {
				component.setValue(settings.showSectionHeadings).onChange(async (value) => {
					await this.plugin.updateSettings({
						showSectionHeadings: value,
					});
					await this.plugin.rerenderViews();
				});
			});

		new Setting(containerEl)
			.setName("Remember section filter")
			.setDesc("Restore the last selected section filter when Obsidian restarts.")
			.addToggle((component) => {
				component.setValue(settings.persistSectionFilter).onChange(async (value) => {
					await this.plugin.updateSettings({
						persistSectionFilter: value,
						savedSectionFilter: value ? this.plugin.getSectionFilter() : null,
					});
				});
			});

		new Setting(containerEl).setName("Tasks").setHeading();

		new Setting(containerEl)
			.setName("Task status actions")
			.setDesc("Choose whether task menus use only standard Markdown states or extended states.")
			.addDropdown((component) => {
				component
					.addOption("standard", "Standard Markdown")
					.addOption("extended", "Extended statuses")
					.setValue(settings.statusMode)
					.onChange(async (value) => {
						await this.plugin.updateSettings({
							statusMode: normalizeTaskStatusMode(value),
						});
						await this.plugin.rerenderViews();
					});
			});

		new Setting(containerEl)
			.setName("Pending filter")
			.setDesc("Choose whether in-progress tasks appear in the pending view.")
			.addDropdown((component) => {
				component
					.addOption("todo-only", "[ ] only")
					.addOption("todo-and-in-progress", "[ ] and [/]")
					.setValue(settings.pendingMode)
					.onChange(async (value) => {
						await this.plugin.updateSettings({
							pendingMode: normalizePendingMode(value),
						});
						await this.plugin.rerenderViews();
					});
			});

		new Setting(containerEl)
			.setName("Include cancelled in completed")
			.setDesc("Show cancelled tasks in the completed view.")
			.addToggle((component) => {
				component.setValue(settings.includeCancelledInCompleted).onChange(async (value) => {
					await this.plugin.updateSettings({
						includeCancelledInCompleted: value,
					});
					await this.plugin.rerenderViews();
				});
			});

		new Setting(containerEl).setName("Scope").setHeading();

		new Setting(containerEl)
			.setName("Include folders")
			.setDesc("One folder per line. Leave empty to include the whole vault.")
			.addTextArea((component) => {
				component.setValue(formatFolderList(settings.includeFolders));
				component.inputEl.rows = 4;
				component.inputEl.addEventListener("change", () => {
					void (async () => {
						await this.plugin.updateSettings({
							includeFolders: parseFolderListInput(component.inputEl.value),
						});
						await this.plugin.rebuildIndex();
					})();
				});
			});

		new Setting(containerEl)
			.setName("Exclude folders")
			.setDesc("One folder per line. Excluded folders always win.")
			.addTextArea((component) => {
				component.setValue(formatFolderList(settings.excludeFolders));
				component.inputEl.rows = 4;
				component.inputEl.addEventListener("change", () => {
					void (async () => {
						await this.plugin.updateSettings({
							excludeFolders: parseFolderListInput(component.inputEl.value),
						});
						await this.plugin.rebuildIndex();
					})();
				});
			});

		new Setting(containerEl).setName("Sorting").setHeading();

		new Setting(containerEl)
			.setName("Sort notes by")
			.setDesc("Choose how note groups are ordered in the task view.")
			.addDropdown((component) => {
				for (const [value, label] of Object.entries(NOTE_SORT_LABELS)) {
					component.addOption(value, label);
				}

				component.setValue(settings.noteSort).onChange(async (value) => {
					await this.plugin.updateSettings({
						noteSort: normalizeNoteSortMode(value),
					});
					await this.plugin.rerenderViews();
				});
			});

		new Setting(containerEl)
			.setName("Sort sections by")
			.setDesc("Choose how section groups are ordered inside each note.")
			.addDropdown((component) => {
				for (const [value, label] of Object.entries(SECTION_SORT_LABELS)) {
					component.addOption(value, label);
				}

				component.setValue(settings.sectionSort).onChange(async (value) => {
					await this.plugin.updateSettings({
						sectionSort: normalizeSectionSortMode(value),
					});
					await this.plugin.rerenderViews();
				});
			});

		new Setting(containerEl)
			.setName("Sort tasks by")
			.setDesc("Choose how tasks are ordered within each section.")
			.addDropdown((component) => {
				for (const [value, label] of Object.entries(TASK_SORT_LABELS)) {
					component.addOption(value, label);
				}

				component.setValue(settings.taskSort).onChange(async (value) => {
					await this.plugin.updateSettings({
						taskSort: normalizeTaskSortMode(value),
					});
					await this.plugin.rerenderViews();
				});
			});
	}
}
