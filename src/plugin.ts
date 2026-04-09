import {
	debounce,
	MarkdownView,
	Notice,
	Plugin,
	TFile,
	normalizePath,
	type Editor,
} from "obsidian";
import {
	DEFERRED_UNTIL_KEY,
	HIDDEN_FROM_TASKS_KEY,
	TASK_STATUS_CANCELLED,
	TASK_STATUS_DONE,
	TASK_STATUS_TODO,
	VIEW_TYPE_TASKS,
} from "./config";
import {
	buildTaskItem,
	collectEditorLines,
	findTaskLine,
	getHeadingCaches,
	getTaskListItems,
	getTodayDateString,
	isDeferred,
	isHiddenFromTaskListFrontmatter,
	setTaskStatusSymbol,
	updateSpecificTasksInContent,
	updateSpecificTasksInEditor,
	updateTaskStatusInContent,
} from "./logic";
import { extractDeferredUntil, extractHiddenFromTaskList } from "./lib/frontmatter";
import { isSameSectionFilter, matchesFilter } from "./lib/filtering";
import { matchesFolderScope, normalizeSettings } from "./lib/settings";
import { VaultTasksSettingTab } from "./settings-tab";
import type {
	AvailableSectionFilters,
	SectionFilter,
	TaskFilter,
	TaskGroup,
	TaskItem,
	TaskSnapshot,
	VaultTasksSettings,
} from "./types";
import { VaultTasksView } from "./view";

export default class VaultTasksPlugin extends Plugin {
	private autoRefreshPaused = false;
	private filter: TaskFilter = "pending";
	private groups: TaskGroup[] = [];
	private lastError: string | null = null;
	private manualRefreshRequired = false;
	private queuedRefresh = false;
	private refreshing = false;
	private sectionFilter: SectionFilter = null;
	private settings: VaultTasksSettings = normalizeSettings(null);
	private showConnections = false;
	private readonly scheduleRefresh = debounce(() => {
		void this.refreshIndex();
	}, 250, true);

	async onload(): Promise<void> {
		await this.loadSettings();
		this.registerView(VIEW_TYPE_TASKS, (leaf) => new VaultTasksView(leaf, this));
		this.addSettingTab(new VaultTasksSettingTab(this.app, this));

		this.addRibbonIcon("list-todo", "Open task list", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-task-list",
			name: "Open task list",
			callback: () => {
				void this.activateView();
			},
		});

		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (this.isMarkdownFile(file)) {
					this.requestAutoRefresh();
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (this.isMarkdownFile(file)) {
					this.requestAutoRefresh();
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (this.isMarkdownFile(file)) {
					void this.removePinnedNotePath(file.path);
					this.requestAutoRefresh();
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (this.isMarkdownFile(file)) {
					void this.renamePinnedNotePath(oldPath, file.path);
					this.requestAutoRefresh();
				}
			}),
		);

		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (this.isMarkdownFile(file)) {
					this.requestAutoRefresh();
				}
			}),
		);

		this.registerEvent(
			this.app.metadataCache.on("deleted", (file) => {
				if (this.isMarkdownFile(file)) {
					this.requestAutoRefresh();
				}
			}),
		);

		this.registerEvent(
			this.app.metadataCache.on("resolve", (file) => {
				if (this.isMarkdownFile(file)) {
					this.requestAutoRefresh();
				}
			}),
		);

		this.app.workspace.onLayoutReady(() => {
			void this.refreshIndex();
		});
	}

	private async loadSettings(): Promise<void> {
		const loadedSettings = await this.loadData();
		this.settings = normalizeSettings(loadedSettings);
		this.filter = this.settings.defaultFilter;
		this.showConnections = this.settings.showConnectionsByDefault;
		this.sectionFilter = this.settings.persistSectionFilter
			? this.settings.savedSectionFilter
			: null;
	}

	private async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	getFilter(): TaskFilter {
		return this.filter;
	}

	getSettings(): VaultTasksSettings {
		return this.settings;
	}

	getSectionFilter(): SectionFilter {
		return this.sectionFilter;
	}

	getSnapshot(): TaskSnapshot {
		return {
			error: this.lastError,
			filter: this.filter,
			groups: this.groups,
			refreshing: this.refreshing,
			sectionFilter: this.sectionFilter,
			settings: this.settings,
			showConnections: this.showConnections,
		};
	}

	getShowConnections(): boolean {
		return this.showConnections;
	}

	getReadableLineLengthEnabled(): boolean {
		const vaultWithConfig = this.app.vault as unknown as {
			getConfig?: (key: string) => unknown;
		};

		return Boolean(vaultWithConfig.getConfig?.("readableLineLength"));
	}

	hasPendingManualRefresh(): boolean {
		return this.manualRefreshRequired;
	}

	async updateSettings(settingsPatch: Partial<VaultTasksSettings>): Promise<void> {
		this.settings = {
			...this.settings,
			...settingsPatch,
		};
		await this.saveSettings();
	}

	async rerenderViews(): Promise<void> {
		await this.updateHeaderControls();
		await this.renderAllViews();
	}

	async rebuildIndex(): Promise<void> {
		await this.refreshIndex();
	}

	async applyTaskChanges(): Promise<void> {
		this.autoRefreshPaused = false;
		this.manualRefreshRequired = false;
		await this.updateHeaderControls();
		await this.refreshIndex();
	}

	async setFilter(filter: TaskFilter): Promise<void> {
		if (this.filter === filter) {
			return;
		}

		this.filter = filter;
		await this.updateHeaderControls();
		await this.renderAllViews();
	}

	async setSectionFilter(sectionFilter: SectionFilter): Promise<void> {
		if (isSameSectionFilter(this.sectionFilter, sectionFilter)) {
			return;
		}

		this.sectionFilter = sectionFilter;
		if (this.settings.persistSectionFilter) {
			this.settings = {
				...this.settings,
				savedSectionFilter: sectionFilter,
			};
			await this.saveSettings();
		}
		await this.updateHeaderControls();
		await this.renderAllViews();
	}

	async setShowConnections(showConnections: boolean): Promise<void> {
		if (this.showConnections === showConnections) {
			return;
		}

		this.showConnections = showConnections;
		await this.updateHeaderControls();
		await this.renderAllViews();
	}

	isNotePinned(fileOrPath: TFile | string): boolean {
		return this.getPinnedNoteIndex(fileOrPath) !== -1;
	}

	canMovePinnedNote(fileOrPath: TFile | string, direction: "up" | "down"): boolean {
		const pinnedIndex = this.getPinnedNoteIndex(fileOrPath);

		if (pinnedIndex === -1) {
			return false;
		}

		return direction === "up"
			? pinnedIndex > 0
			: pinnedIndex < this.settings.pinnedNotePaths.length - 1;
	}

	async pinNote(file: TFile): Promise<void> {
		const notePath = normalizePath(file.path);
		if (this.settings.pinnedNotePaths.includes(notePath)) {
			return;
		}

		await this.updatePinnedNotePaths([...this.settings.pinnedNotePaths, notePath]);
	}

	async unpinNote(file: TFile): Promise<void> {
		await this.removePinnedNotePath(file.path, true);
	}

	async movePinnedNote(file: TFile, direction: "up" | "down"): Promise<void> {
		const pinnedIndex = this.getPinnedNoteIndex(file);
		if (pinnedIndex === -1) {
			return;
		}

		const targetIndex = direction === "up" ? pinnedIndex - 1 : pinnedIndex + 1;
		if (targetIndex < 0 || targetIndex >= this.settings.pinnedNotePaths.length) {
			return;
		}

		const pinnedNotePaths = [...this.settings.pinnedNotePaths];
		const [notePath] = pinnedNotePaths.splice(pinnedIndex, 1);
		pinnedNotePaths.splice(targetIndex, 0, notePath);
		await this.updatePinnedNotePaths(pinnedNotePaths);
	}

	getAvailableSectionFilters(filter: TaskFilter): AvailableSectionFilters {
		const headings = new Set<string>();
		let hasNoSection = false;
		const today = getTodayDateString();

		for (const group of this.groups) {
			if (filter === "pending" && isDeferred(group.deferredUntil, today)) {
				continue;
			}

			for (const task of group.tasks) {
				if (!matchesFilter(task, filter, this.settings)) {
					continue;
				}

				if (task.sectionHeading === null) {
					hasNoSection = true;
					continue;
				}

				headings.add(task.sectionHeading);
			}
		}

		return {
			hasNoSection,
			headings: Array.from(headings).sort((left, right) => left.localeCompare(right)),
		};
	}

	async activateView(): Promise<void> {
		let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASKS)[0] ?? null;

		if (!leaf) {
			leaf =
				(this.settings.openLocation === "sidebar"
					? this.app.workspace.getRightLeaf(false)
					: this.app.workspace.getLeaf("tab")) ?? this.app.workspace.getLeaf("tab");
			await leaf.setViewState({
				type: VIEW_TYPE_TASKS,
				active: true,
			});
		}

		this.app.workspace.setActiveLeaf(leaf, { focus: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	async copyToClipboard(text: string, successMessage: string): Promise<void> {
		try {
			await window.navigator.clipboard.writeText(text);
			new Notice(successMessage);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Could not copy to the clipboard.";
			new Notice(message);
		}
	}

	async openNote(file: TFile): Promise<void> {
		const leaf = this.getPreferredNoteLeaf();
		await leaf.openFile(file);
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
	}

	async openTask(task: TaskItem): Promise<void> {
		await this.openNote(task.file);

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || view.file?.path !== task.file.path) {
			return;
		}

		const line = Math.min(task.line, view.editor.lastLine());
		view.editor.setCursor({ line, ch: 0 });
		view.editor.scrollIntoView(
			{
				from: { line, ch: 0 },
				to: { line, ch: 0 },
			},
			true,
		);
		view.editor.focus();
	}

	async setTaskStatus(task: TaskItem, statusSymbol: string): Promise<boolean> {
		try {
			this.autoRefreshPaused = true;
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

			if (activeView?.file?.path === task.file.path) {
				this.setTaskStatusInEditor(activeView.editor, task, statusSymbol);
			} else {
				await this.app.vault.process(task.file, (content) => {
					return updateTaskStatusInContent(content, task, statusSymbol);
				});
			}

			const nextLine = setTaskStatusSymbol(task.rawLine, statusSymbol);
			if (nextLine !== null) {
				task.rawLine = nextLine;
				task.renderedLine = nextLine.trimStart();
				task.statusSymbol = statusSymbol;
			}

			this.manualRefreshRequired = true;
			await this.updateHeaderControls();
			return true;
		} catch (error) {
			const message = error instanceof Error ? error.message : "Could not update the task.";
			new Notice(message);
			if (!this.manualRefreshRequired) {
				this.autoRefreshPaused = false;
			}
			await this.updateHeaderControls();
			return false;
		}
	}

	async refreshIndex(): Promise<void> {
		if (this.refreshing) {
			this.queuedRefresh = true;
			return;
		}

		this.refreshing = true;
		await this.renderAllViews();

		try {
			this.groups = await this.buildTaskGroups();
			this.lastError = null;
		} catch (error) {
			this.lastError = error instanceof Error ? error.message : "Could not refresh the task list.";
		} finally {
			this.refreshing = false;
			await this.renderAllViews();
		}

		if (this.queuedRefresh) {
			this.queuedRefresh = false;
			void this.refreshIndex();
		}
	}

	async toggleTask(task: TaskItem, checked: boolean): Promise<boolean> {
		return this.setTaskStatus(task, checked ? TASK_STATUS_DONE : TASK_STATUS_TODO);
	}

	async setDeferredUntil(file: TFile, deferredUntil: string): Promise<void> {
		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				frontmatter[DEFERRED_UNTIL_KEY] = deferredUntil;
			});
			await this.refreshIndex();
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Could not update the defer-until date.";
			new Notice(message);
		}
	}

	async hideFromTaskList(file: TFile): Promise<void> {
		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				frontmatter[HIDDEN_FROM_TASKS_KEY] = true;
			});
			await this.refreshIndex();
			new Notice(
				`Hidden from vault tasks. Remove \`${HIDDEN_FROM_TASKS_KEY}: true\` to show it again.`,
			);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Could not hide the note from the task list.";
			new Notice(message);
		}
	}

	async setTasksStatus(
		tasks: TaskItem[],
		statusSymbol: string,
		options?: { onlyUnchecked?: boolean },
	): Promise<TaskItem[]> {
		if (tasks.length === 0) {
			return [];
		}

		let updatedCount = 0;
		let updatedTasks: TaskItem[] = [];
		const { onlyUnchecked = false } = options ?? {};
		const file = tasks[0].file;

		try {
			this.autoRefreshPaused = true;
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

			if (activeView?.file?.path === file.path) {
				const result = updateSpecificTasksInEditor(activeView.editor, tasks, statusSymbol, {
					onlyUnchecked,
				});
				updatedCount = result.updatedCount;
				updatedTasks = result.updatedTasks;
			} else {
				await this.app.vault.process(file, (content) => {
					const result = updateSpecificTasksInContent(content, tasks, statusSymbol, {
						onlyUnchecked,
					});
					updatedCount = result.updatedCount;
					updatedTasks = result.updatedTasks;
					return result.content;
				});
			}

			if (updatedCount === 0) {
				if (!this.manualRefreshRequired) {
					this.autoRefreshPaused = false;
				}
				await this.updateHeaderControls();
				new Notice(
					statusSymbol === TASK_STATUS_CANCELLED
						? "No pending tasks to cancel."
						: "No tasks needed updating.",
				);
				return [];
			}

			for (const task of updatedTasks) {
				const nextLine = setTaskStatusSymbol(task.rawLine, statusSymbol);
				if (nextLine === null) {
					continue;
				}

				task.rawLine = nextLine;
				task.renderedLine = nextLine.trimStart();
				task.statusSymbol = statusSymbol;
			}

			this.manualRefreshRequired = true;
			await this.updateHeaderControls();
			return updatedTasks;
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Could not update the selected tasks.";
			new Notice(message);
			if (!this.manualRefreshRequired) {
				this.autoRefreshPaused = false;
			}
			await this.updateHeaderControls();
			return [];
		}
	}

	private async buildTaskGroups(): Promise<TaskGroup[]> {
		const taskFiles = this.app.vault.getMarkdownFiles().flatMap((file) => {
			if (!matchesFolderScope(file.path, this.settings)) {
				return [];
			}

			const cache = this.app.metadataCache.getFileCache(file);
			const taskItems = getTaskListItems(cache);

			if (taskItems.length === 0) {
				return [];
			}

			return [{ cache, file, taskItems }];
		});

		const groups = await Promise.all(
			taskFiles.map(async ({ cache, file, taskItems }) => {
				const content = await this.app.vault.cachedRead(file);
				const lines = content.split(/\r?\n/);
				const headings = getHeadingCaches(cache);
				const tasks = taskItems
					.map((taskItem) => buildTaskItem(file, taskItem, lines, headings))
					.filter((task): task is TaskItem => task !== null)
					.sort((left, right) => left.line - right.line);

				return {
					deferredUntil: extractDeferredUntil(content),
					file,
					hiddenFromTaskList: extractHiddenFromTaskList(content),
					noteTitle: file.basename,
					tasks,
				};
			}),
		);

		return groups
			.filter((group) => group.tasks.length > 0 && !group.hiddenFromTaskList)
			.sort((left, right) => left.file.path.localeCompare(right.file.path));
	}

	private isMarkdownFile(file: unknown): file is TFile {
		return file instanceof TFile && file.extension === "md";
	}

	getBacklinkFiles(file: TFile): TFile[] {
		const backlinks = new Map<string, TFile>();
		const resolvedLinks = this.app.metadataCache.resolvedLinks;

		for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
			if (sourcePath === file.path || !links[file.path]) {
				continue;
			}

			const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
			if (
				sourceFile instanceof TFile &&
				sourceFile.extension === "md" &&
				matchesFolderScope(sourceFile.path, this.settings) &&
				!isHiddenFromTaskListFrontmatter(this.app.metadataCache.getFileCache(sourceFile)?.frontmatter)
			) {
				backlinks.set(sourceFile.path, sourceFile);
			}
		}

		return Array.from(backlinks.values()).sort(
			(left, right) =>
				left.basename.localeCompare(right.basename) || left.path.localeCompare(right.path),
		);
	}

	private getPreferredNoteLeaf() {
		const leaf = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);

		if (leaf && leaf.view.getViewType() !== VIEW_TYPE_TASKS) {
			return leaf;
		}

		return this.app.workspace.getLeaf("tab");
	}

	private async renderAllViews(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASKS);

		await Promise.all(
			leaves.map(async (leaf) => {
				if (leaf.view instanceof VaultTasksView) {
					await leaf.view.render();
				}
			}),
		);
	}

	private requestAutoRefresh(): void {
		if (this.autoRefreshPaused) {
			return;
		}

		this.scheduleRefresh();
	}

	private async updateHeaderControls(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASKS);

		for (const leaf of leaves) {
			if (leaf.view instanceof VaultTasksView) {
				leaf.view.updateHeaderControls();
			}
		}
	}

	private setTaskStatusInEditor(editor: Editor, task: TaskItem, statusSymbol: string): void {
		const lines = collectEditorLines(editor);
		const targetLine = findTaskLine(lines, task);

		if (targetLine === null) {
			throw new Error("The task moved before it could be updated. Refresh and try again.");
		}

		const nextLine = setTaskStatusSymbol(lines[targetLine], statusSymbol);
		if (nextLine === null) {
			throw new Error("The source line is no longer a standard Markdown task.");
		}

		editor.setLine(targetLine, nextLine);
	}

	private getPinnedNoteIndex(fileOrPath: TFile | string): number {
		const notePath = normalizePath(
			typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path,
		);
		return this.settings.pinnedNotePaths.indexOf(notePath);
	}

	private async updatePinnedNotePaths(
		pinnedNotePaths: string[],
		shouldRerender = true,
	): Promise<void> {
		const normalizedPaths = normalizeSettings({
			...this.settings,
			pinnedNotePaths,
		}).pinnedNotePaths;

		if (
			normalizedPaths.length === this.settings.pinnedNotePaths.length &&
			normalizedPaths.every((path, index) => path === this.settings.pinnedNotePaths[index])
		) {
			return;
		}

		this.settings = {
			...this.settings,
			pinnedNotePaths: normalizedPaths,
		};
		await this.saveSettings();

		if (shouldRerender) {
			await this.renderAllViews();
		}
	}

	private async removePinnedNotePath(
		path: string,
		shouldRerender = false,
	): Promise<boolean> {
		const notePath = normalizePath(path);
		const pinnedNotePaths = this.settings.pinnedNotePaths.filter(
			(candidatePath) => candidatePath !== notePath,
		);

		if (pinnedNotePaths.length === this.settings.pinnedNotePaths.length) {
			return false;
		}

		await this.updatePinnedNotePaths(pinnedNotePaths, shouldRerender);
		return true;
	}

	private async renamePinnedNotePath(oldPath: string, nextPath: string): Promise<void> {
		const normalizedOldPath = normalizePath(oldPath);
		const pinnedIndex = this.settings.pinnedNotePaths.indexOf(normalizedOldPath);
		if (pinnedIndex === -1) {
			return;
		}

		const pinnedNotePaths = [...this.settings.pinnedNotePaths];
		pinnedNotePaths[pinnedIndex] = normalizePath(nextPath);
		await this.updatePinnedNotePaths(pinnedNotePaths, false);
	}
}
