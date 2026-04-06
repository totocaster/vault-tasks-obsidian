import {
	CachedMetadata,
	Component,
	debounce,
	Editor,
	HeadingCache,
	ItemView,
	Keymap,
	ListItemCache,
	MarkdownRenderer,
	MarkdownView,
	Menu,
	Modal,
	Notice,
	Plugin,
	Setting,
	setIcon,
	TFile,
	WorkspaceLeaf,
} from "obsidian";

const VIEW_TYPE_TASKS = "vault-tasks-view";
const VIEW_TITLE = "Vault tasks";
const DEFERRED_UNTIL_KEY = "deffered-until";
const HIDDEN_FROM_TASKS_KEY = "hide-from-vault-tasks";
const TASK_STATUS_CANCELLED = "-";
const TASK_STATUS_DEFERRED = ">";
const TASK_STATUS_DONE = "x";
const TASK_STATUS_IN_PROGRESS = "/";
const TASK_STATUS_TODO = " ";
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const TASK_LINE_PATTERN = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\].*)$/;
const TASK_TEXT_PATTERN = /^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s?(.*)$/;

type TaskFilter = "all" | "pending" | "completed";

interface TaskItem {
	completed: boolean;
	file: TFile;
	key: string;
	line: number;
	rawLine: string;
	renderedLine: string;
	sectionHeading: string | null;
	sectionLine: number | null;
	statusSymbol: string;
	text: string;
}

interface TaskGroup {
	deferredUntil: string | null;
	file: TFile;
	hiddenFromTaskList: boolean;
	noteTitle: string;
	tasks: TaskItem[];
}

interface TaskSectionGroup {
	file: TFile;
	heading: string;
	line: number;
	tasks: TaskItem[];
}

interface TaskSnapshot {
	error: string | null;
	filter: TaskFilter;
	groups: TaskGroup[];
	refreshing: boolean;
	showConnections: boolean;
}

interface ViewScrollAnchor {
	key: string;
	offset: number;
	type: "group" | "section" | "task";
}

interface ViewScrollState {
	fallbackAnchor: ViewScrollAnchor | null;
	primaryAnchor: ViewScrollAnchor | null;
	scrollTop: number;
}

export default class VaultTasksPlugin extends Plugin {
	private autoRefreshPaused = false;
	private filter: TaskFilter = "pending";
	private groups: TaskGroup[] = [];
	private lastError: string | null = null;
	private manualRefreshRequired = false;
	private queuedRefresh = false;
	private refreshing = false;
	private showConnections = false;
	private readonly scheduleRefresh = debounce(() => {
		void this.refreshIndex();
	}, 250, true);

	async onload(): Promise<void> {
		this.registerView(VIEW_TYPE_TASKS, (leaf) => new VaultTasksView(leaf, this));

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
					this.requestAutoRefresh();
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on("rename", (file) => {
				if (this.isMarkdownFile(file)) {
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

	getFilter(): TaskFilter {
		return this.filter;
	}

	getSnapshot(): TaskSnapshot {
		return {
			error: this.lastError,
			filter: this.filter,
			groups: this.groups,
			refreshing: this.refreshing,
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

	async activateView(): Promise<void> {
		let leaf = this.getMainTaskLeaf();

		if (!leaf) {
			leaf = this.app.workspace.getLeaf("tab");
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
				task.completed = isCompletedTaskStatus(statusSymbol);
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

	async toggleTask(task: TaskItem, completed: boolean): Promise<boolean> {
		return this.setTaskStatus(task, completed ? TASK_STATUS_DONE : TASK_STATUS_TODO);
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
	): Promise<void> {
		if (tasks.length === 0) {
			return;
		}

		let updatedCount = 0;
		const { onlyUnchecked = false } = options ?? {};
		const file = tasks[0].file;

		try {
			this.autoRefreshPaused = true;
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

			if (activeView?.file?.path === file.path) {
				updatedCount = updateSpecificTasksInEditor(activeView.editor, tasks, statusSymbol, {
					onlyUnchecked,
				});
			} else {
				await this.app.vault.process(file, (content) => {
					const result = updateSpecificTasksInContent(content, tasks, statusSymbol, {
						onlyUnchecked,
					});
					updatedCount = result.updatedCount;
					return result.content;
				});
			}

			this.autoRefreshPaused = false;
			this.manualRefreshRequired = false;
			await this.updateHeaderControls();

			if (updatedCount === 0) {
				new Notice(
					statusSymbol === TASK_STATUS_CANCELLED
						? "No pending tasks to cancel."
						: "No tasks needed updating.",
				);
				return;
			}

			await this.refreshIndex();
		} catch (error) {
			this.autoRefreshPaused = false;
			const message =
				error instanceof Error ? error.message : "Could not update the selected tasks.";
			new Notice(message);
			await this.updateHeaderControls();
		}
	}

	async setAllTasksCompletion(file: TFile, completed: boolean): Promise<void> {
		let updatedCount = 0;

		try {
			this.autoRefreshPaused = true;
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

			if (activeView?.file?.path === file.path) {
				updatedCount = updateAllTasksInEditor(activeView.editor, completed);
			} else {
				await this.app.vault.process(file, (content) => {
					const result = updateAllTasksInContent(content, completed);
					updatedCount = result.updatedCount;
					return result.content;
				});
			}

			this.autoRefreshPaused = false;
			this.manualRefreshRequired = false;
			await this.updateHeaderControls();

			if (updatedCount === 0) {
				new Notice(completed ? "No open tasks to complete." : "No completed tasks to cancel.");
				return;
			}

			await this.refreshIndex();
		} catch (error) {
			this.autoRefreshPaused = false;
			const message =
				error instanceof Error ? error.message : "Could not update the tasks in this note.";
			new Notice(message);
			await this.updateHeaderControls();
		}
	}

	private async buildTaskGroups(): Promise<TaskGroup[]> {
		const taskFiles = this.app.vault.getMarkdownFiles().flatMap((file) => {
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
			.sort((left, right) => left.noteTitle.localeCompare(right.noteTitle));
	}

	private getMainTaskLeaf(): WorkspaceLeaf | null {
		let taskLeaf: WorkspaceLeaf | null = null;

		this.app.workspace.iterateRootLeaves((leaf) => {
			if (taskLeaf || leaf.view.getViewType() !== VIEW_TYPE_TASKS) {
				return;
			}

			taskLeaf = leaf;
		});

		return taskLeaf;
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

	private getPreferredNoteLeaf(): WorkspaceLeaf {
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
}

class VaultTasksView extends ItemView {
	private archiveButtonEl: HTMLButtonElement | null = null;
	private connectionsButtonEl: HTMLButtonElement | null = null;
	private filterButtons = new Map<TaskFilter, HTMLButtonElement>();
	private headerFilterEl: HTMLDivElement | null = null;
	private markdownHostEl: HTMLDivElement | null = null;
	private renderComponent: Component | null = null;
	private renderedTasks = new Map<string, TaskItem>();

	constructor(leaf: WorkspaceLeaf, private readonly plugin: VaultTasksPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_TASKS;
	}

	getDisplayText(): string {
		return VIEW_TITLE;
	}

	getIcon(): string {
		return "list-todo";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClasses(["vault-tasks-view", "markdown-reading-view"]);
		this.ensureHeaderFilters();

		this.registerDomEvent(this.contentEl, "change", (event) => {
			const target = event.target;

			if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") {
				return;
			}

			const key = target.dataset.taskKey;
			if (!key) {
				return;
			}

			const task = this.renderedTasks.get(key);
			if (!task) {
				return;
			}

			const nextChecked = target.checked;
			target.disabled = true;

			void (async () => {
				const didUpdate = await this.plugin.toggleTask(task, nextChecked);

				if (!didUpdate) {
					target.checked = !nextChecked;
				}

				target.disabled = false;
				this.updateHeaderControls();
			})();
		});

		this.registerDomEvent(this.contentEl, "click", (event) => {
			const target = event.target;

			if (!(target instanceof HTMLElement)) {
				return;
			}

			const linkEl = target.closest<HTMLAnchorElement>("a.internal-link");
			if (!linkEl) {
				return;
			}

			const linktext = linkEl.getAttribute("data-href");
			if (!linktext) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();

			void this.app.workspace.openLinkText(linktext, "/", Keymap.isModEvent(event));
		});

		this.registerDomEvent(this.contentEl, "contextmenu", (event) => {
			const target = event.target;

			if (!(target instanceof HTMLElement)) {
				return;
			}

			const listItemEl = target.closest<HTMLElement>("li[data-task-key]");
			if (!listItemEl) {
				return;
			}

			const taskKey = listItemEl.getAttribute("data-task-key");
			if (!taskKey) {
				return;
			}

			const task = this.renderedTasks.get(taskKey);
			if (!task) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			this.showTaskMenu(event, listItemEl, task);
		});

		await this.render();
	}

	async onClose(): Promise<void> {
		this.archiveButtonEl = null;
		this.connectionsButtonEl = null;
		this.headerFilterEl?.remove();
		this.headerFilterEl = null;
		this.filterButtons.clear();
		this.markdownHostEl = null;
		this.renderedTasks.clear();
		this.renderComponent?.unload();
		this.renderComponent = null;
		this.contentEl.empty();
	}

	async render(): Promise<void> {
		const scrollState = this.captureScrollState();
		const snapshot = this.plugin.getSnapshot();
		const { markdown, renderedGroups, renderedSections, renderedTasks } = buildRenderedDocument(
			snapshot,
			this.app.metadataCache,
			(file) => this.plugin.getBacklinkFiles(file),
		);

		this.ensureHeaderFilters();
		this.updateFilterButtons(snapshot.filter);
		this.renderComponent?.unload();
		this.renderComponent = new Component();
		this.addChild(this.renderComponent);
		this.renderedTasks.clear();
		this.contentEl.empty();
		this.contentEl.addClasses(["vault-tasks-view", "markdown-reading-view"]);
		this.contentEl.toggleClass(
			"is-readable-line-width",
			this.plugin.getReadableLineLengthEnabled(),
		);
		this.markdownHostEl = this.contentEl.createDiv({
			cls: [
				"vault-tasks-view__document",
				"markdown-preview-view",
				"markdown-rendered",
				],
		});

		this.markdownHostEl.toggleClass(
			"is-readable-line-width",
			this.plugin.getReadableLineLengthEnabled(),
		);

		const sizerEl = this.markdownHostEl.createDiv({
			cls: ["markdown-preview-sizer", "vault-tasks-view__sizer"],
		});

		await MarkdownRenderer.render(this.app, markdown, sizerEl, "/", this.renderComponent);

		const checkboxes = Array.from(sizerEl.querySelectorAll<HTMLInputElement>("input[type='checkbox']"));

		for (const [index, checkbox] of checkboxes.entries()) {
			const task = renderedTasks[index];

			if (!task) {
				continue;
			}

			checkbox.dataset.taskKey = task.key;
			this.renderedTasks.set(task.key, task);
			const listItemEl = checkbox.closest("li");
			listItemEl?.setAttr("data-task-key", task.key);
			listItemEl?.setAttr("data-scroll-anchor-kind", "task");
			listItemEl?.setAttr("data-scroll-anchor-key", task.key);
			this.addJumpButton(checkbox, task);
		}

		const headings = Array.from(sizerEl.querySelectorAll<HTMLHeadingElement>("h2"));

		for (const [index, headingEl] of headings.entries()) {
			const group = renderedGroups[index];

			if (!group) {
				continue;
			}

			headingEl.setAttr("data-scroll-anchor-kind", "group");
			headingEl.setAttr("data-scroll-anchor-key", group.file.path);
			this.bindHeadingMenu(headingEl, group);
			this.decorateHeadingContext(headingEl);
		}

		const sectionHeadings = Array.from(sizerEl.querySelectorAll<HTMLHeadingElement>("h3"));

		for (const [index, headingEl] of sectionHeadings.entries()) {
			const section = renderedSections[index];

			if (!section) {
				continue;
			}

			headingEl.setAttr("data-scroll-anchor-kind", "section");
			headingEl.setAttr("data-scroll-anchor-key", this.getSectionAnchorKey(section));
			this.bindSectionMenu(headingEl, section);
		}

		this.restoreScrollState(scrollState);
	}

	updateHeaderControls(): void {
		this.ensureHeaderFilters();
		this.updateArchiveButton();
		this.updateConnectionsButton();
		this.updateFilterButtons(this.plugin.getFilter());
	}

	private ensureHeaderFilters(): void {
		if (this.headerFilterEl?.isConnected) {
			return;
		}

		const actionsEl =
			this.containerEl.querySelector<HTMLElement>(".view-actions") ??
			this.containerEl.closest(".workspace-leaf-content")?.querySelector<HTMLElement>(".view-actions");

		if (!actionsEl) {
			return;
		}

		const filterEl = createDiv({ cls: "vault-tasks-view__header-filters" });
		const filtersGroupEl = filterEl.createDiv({
			cls: "vault-tasks-view__header-group",
		});

		for (const filter of ["all", "pending", "completed"] as TaskFilter[]) {
			const buttonEl = filtersGroupEl.createEl("button", {
				cls: ["clickable-icon", "view-action", "vault-tasks-view__header-filter"],
				attr: {
					"data-tooltip-position": "bottom",
					"aria-label": `Show ${filterLabel(filter)} tasks`,
					title: `Show ${filterLabel(filter)} tasks`,
					type: "button",
				},
			});
			setIcon(buttonEl, filterIcon(filter));

			this.registerDomEvent(buttonEl, "click", () => {
				void this.plugin.setFilter(filter);
			});

			this.filterButtons.set(filter, buttonEl);
		}

		filterEl.createSpan({
			cls: "vault-tasks-view__header-separator",
			attr: { "aria-hidden": "true" },
		});

		const archiveGroupEl = filterEl.createDiv({
			cls: "vault-tasks-view__header-group",
		});

		const archiveButtonEl = archiveGroupEl.createEl("button", {
			cls: ["clickable-icon", "view-action", "vault-tasks-view__header-filter"],
			attr: {
				"data-tooltip-position": "bottom",
				"aria-label": "Refresh task list",
				title: "Refresh task list",
				type: "button",
			},
		});
		setIcon(archiveButtonEl, "archive");

		this.registerDomEvent(archiveButtonEl, "click", () => {
			void this.plugin.applyTaskChanges();
		});

		this.archiveButtonEl = archiveButtonEl;

		filterEl.createSpan({
			cls: "vault-tasks-view__header-separator",
			attr: { "aria-hidden": "true" },
		});

		const connectionsGroupEl = filterEl.createDiv({
			cls: "vault-tasks-view__header-group",
		});

		const connectionsButtonEl = connectionsGroupEl.createEl("button", {
			cls: ["clickable-icon", "view-action", "vault-tasks-view__header-filter"],
			attr: {
				"data-tooltip-position": "bottom",
				"aria-label": "Toggle connections context",
				title: "Toggle connections context",
				type: "button",
			},
		});
		setIcon(connectionsButtonEl, "waypoints");

		this.registerDomEvent(connectionsButtonEl, "click", () => {
			void this.plugin.setShowConnections(!this.plugin.getShowConnections());
		});

		this.connectionsButtonEl = connectionsButtonEl;

		const anchorEl = actionsEl.lastElementChild;
		if (anchorEl) {
			actionsEl.insertBefore(filterEl, anchorEl);
		} else {
			actionsEl.appendChild(filterEl);
		}

		this.headerFilterEl = filterEl;
		this.updateHeaderControls();
	}

	private updateFilterButtons(activeFilter: TaskFilter): void {
		for (const [filter, buttonEl] of this.filterButtons.entries()) {
			buttonEl.toggleClass("is-active", filter === activeFilter);
			buttonEl.setAttr("aria-pressed", filter === activeFilter ? "true" : "false");
		}
	}

	private updateArchiveButton(): void {
		if (!this.archiveButtonEl) {
			return;
		}

		const hasPendingRefresh = this.plugin.hasPendingManualRefresh();

		this.archiveButtonEl.toggleClass("is-active", hasPendingRefresh);
		this.archiveButtonEl.setAttr("aria-pressed", hasPendingRefresh ? "true" : "false");
	}

	private updateConnectionsButton(): void {
		if (!this.connectionsButtonEl) {
			return;
		}

		const showConnections = this.plugin.getShowConnections();

		this.connectionsButtonEl.toggleClass("is-active", showConnections);
		this.connectionsButtonEl.setAttr("aria-pressed", showConnections ? "true" : "false");
	}

	private captureScrollState(): ViewScrollState {
		const scrollTop = this.contentEl.scrollTop;
		const anchorEls = Array.from(
			this.contentEl.querySelectorAll<HTMLElement>(
				"[data-scroll-anchor-kind][data-scroll-anchor-key]",
			),
		);

		if (anchorEls.length === 0) {
			return {
				fallbackAnchor: null,
				primaryAnchor: null,
				scrollTop,
			};
		}

		const viewportTop = this.contentEl.getBoundingClientRect().top;
		let primaryIndex = anchorEls.findIndex(
			(anchorEl) => anchorEl.getBoundingClientRect().bottom > viewportTop,
		);

		if (primaryIndex === -1) {
			primaryIndex = anchorEls.length - 1;
		}

		return {
			fallbackAnchor:
				primaryIndex > 0
					? this.buildScrollAnchor(anchorEls[primaryIndex - 1], viewportTop)
					: null,
			primaryAnchor: this.buildScrollAnchor(anchorEls[primaryIndex], viewportTop),
			scrollTop,
		};
	}

	private buildScrollAnchor(
		anchorEl: HTMLElement,
		viewportTop: number,
	): ViewScrollAnchor | null {
		const type = anchorEl.getAttribute("data-scroll-anchor-kind");
		const key = anchorEl.getAttribute("data-scroll-anchor-key");

		if (
			!key ||
			(type !== "group" && type !== "section" && type !== "task")
		) {
			return null;
		}

		return {
			key,
			offset: anchorEl.getBoundingClientRect().top - viewportTop,
			type,
		};
	}

	private restoreScrollState(scrollState: ViewScrollState): void {
		const anchor =
			scrollState.primaryAnchor &&
			this.findScrollAnchorElement(scrollState.primaryAnchor)
				? scrollState.primaryAnchor
				: scrollState.fallbackAnchor &&
					  this.findScrollAnchorElement(scrollState.fallbackAnchor)
					? scrollState.fallbackAnchor
					: null;

		if (!anchor) {
			this.contentEl.scrollTop = this.clampScrollTop(scrollState.scrollTop);
			return;
		}

		const anchorEl = this.findScrollAnchorElement(anchor);
		if (!anchorEl) {
			this.contentEl.scrollTop = this.clampScrollTop(scrollState.scrollTop);
			return;
		}

		const viewportTop = this.contentEl.getBoundingClientRect().top;
		const currentOffset = anchorEl.getBoundingClientRect().top - viewportTop;
		this.contentEl.scrollTop = this.clampScrollTop(
			this.contentEl.scrollTop + currentOffset - anchor.offset,
		);
	}

	private findScrollAnchorElement(anchor: ViewScrollAnchor): HTMLElement | null {
		return (
			Array.from(
				this.contentEl.querySelectorAll<HTMLElement>(
					"[data-scroll-anchor-kind][data-scroll-anchor-key]",
				),
			).find(
				(anchorEl) =>
					anchorEl.getAttribute("data-scroll-anchor-kind") === anchor.type &&
					anchorEl.getAttribute("data-scroll-anchor-key") === anchor.key,
			) ?? null
		);
	}

	private clampScrollTop(scrollTop: number): number {
		const maxScrollTop = Math.max(0, this.contentEl.scrollHeight - this.contentEl.clientHeight);
		return Math.max(0, Math.min(maxScrollTop, scrollTop));
	}

	private getSectionAnchorKey(section: TaskSectionGroup): string {
		return `${section.file.path}:${section.line}`;
	}

	private addJumpButton(checkboxEl: HTMLInputElement, task: TaskItem): void {
		const listItemEl = checkboxEl.closest("li");
		if (!listItemEl) {
			return;
		}

		const jumpButtonEl = createEl("span", {
			cls: "vault-tasks-view__task-jump",
			text: "\u2197",
			attr: {
				"aria-label": `Open task source in ${task.file.basename}`,
				"data-tooltip-position": "bottom",
				role: "button",
				tabindex: "0",
				title: `Open ${task.file.basename} at line ${task.line + 1}`,
			},
		});

		this.registerDomEvent(jumpButtonEl, "click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			void this.plugin.openTask(task);
		});

		this.registerDomEvent(jumpButtonEl, "keydown", (event) => {
			if (event.key !== "Enter" && event.key !== " ") {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			void this.plugin.openTask(task);
		});

		listItemEl.appendChild(jumpButtonEl);
	}

	private applyTaskStatusToElement(listItemEl: HTMLElement, task: TaskItem): void {
		const checkboxEl = listItemEl.querySelector<HTMLInputElement>("input[type='checkbox']");
		if (!checkboxEl) {
			return;
		}

		checkboxEl.checked = isCheckboxCheckedStatus(task.statusSymbol);
		listItemEl.toggleClass("is-checked", checkboxEl.checked);

		if (task.statusSymbol === TASK_STATUS_TODO) {
			listItemEl.removeAttribute("data-task");
			return;
		}

		listItemEl.setAttr("data-task", task.statusSymbol);
	}

	private showTaskMenu(event: MouseEvent, listItemEl: HTMLElement, task: TaskItem): void {
		const menu = new Menu();
		menu.addItem((item) => {
			item
				.setTitle("Open source")
				.setIcon("file-text")
				.onClick(() => {
					void this.plugin.openTask(task);
				});
		});
		menu.addItem((item) => {
			item
				.setTitle("Copy text")
				.setIcon("copy")
				.onClick(() => {
					void this.plugin.copyToClipboard(task.text, "Copied task text.");
				});
		});
		menu.addItem((item) => {
			item
				.setTitle("Copy task line")
				.setIcon("copy")
				.onClick(() => {
					void this.plugin.copyToClipboard(task.rawLine.trim(), "Copied task line.");
				});
		});
		menu.addItem((item) => {
			item
				.setTitle("Copy note path")
				.setIcon("copy")
				.onClick(() => {
					void this.plugin.copyToClipboard(task.file.path, "Copied note path.");
				});
		});
		menu.addSeparator();

		const statusActions: Array<{ title: string; icon: string; symbol: string }> = [
			{ title: "Todo", icon: "circle", symbol: TASK_STATUS_TODO },
			{ title: "In progress", icon: "loader", symbol: TASK_STATUS_IN_PROGRESS },
			{ title: "Done", icon: "check", symbol: TASK_STATUS_DONE },
			{ title: "Cancelled", icon: "minus", symbol: TASK_STATUS_CANCELLED },
			{ title: "Deferred", icon: "fast-forward", symbol: TASK_STATUS_DEFERRED },
		];

			for (const statusAction of statusActions) {
				menu.addItem((item) => {
					const disableCancelled =
						statusAction.symbol === TASK_STATUS_CANCELLED &&
						isCheckboxCheckedStatus(task.statusSymbol) &&
						task.statusSymbol !== TASK_STATUS_CANCELLED;

					item
						.setTitle(statusAction.title)
						.setIcon(statusAction.icon)
						.setChecked(task.statusSymbol === statusAction.symbol)
						.setDisabled(disableCancelled)
						.onClick(() => {
							void (async () => {
								const didUpdate = await this.plugin.setTaskStatus(task, statusAction.symbol);
							if (!didUpdate) {
								return;
							}

							this.applyTaskStatusToElement(listItemEl, task);
						})();
					});
			});
		}

		menu.showAtMouseEvent(event);
	}

	private bindHeadingMenu(headingEl: HTMLHeadingElement, group: TaskGroup): void {
		const titleLinkEl = headingEl.querySelector<HTMLAnchorElement>("a.internal-link");
		if (!titleLinkEl) {
			return;
		}

		this.registerDomEvent(titleLinkEl, "contextmenu", (event) => {
			event.preventDefault();
			event.stopPropagation();

			const menu = new Menu();
			menu.addItem((item) => {
				item
					.setTitle("Open")
					.setIcon("file-text")
					.onClick(() => {
						void this.plugin.openNote(group.file);
					});
			});
			menu.addItem((item) => {
				item
					.setTitle("Copy name")
					.setIcon("copy")
					.onClick(() => {
						void this.plugin.copyToClipboard(group.noteTitle, "Copied note name.");
					});
			});
			menu.addItem((item) => {
				item
					.setTitle("Copy path")
					.setIcon("copy")
					.onClick(() => {
						void this.plugin.copyToClipboard(group.file.path, "Copied note path.");
					});
			});
			menu.addItem((item) => {
				item
					.setTitle("Copy wiki link")
					.setIcon("link")
					.onClick(() => {
						const linkText = this.app.metadataCache.fileToLinktext(group.file, "/", true);
						void this.plugin.copyToClipboard(`[[${linkText}]]`, "Copied wiki link.");
					});
			});
			menu.addSeparator();
			menu.addItem((item) => {
				item
					.setTitle("Complete all")
					.setIcon("check")
					.onClick(() => {
						void this.plugin.setTasksStatus(group.tasks, TASK_STATUS_DONE);
					});
			});
			menu.addItem((item) => {
				item
					.setTitle("Cancel pending")
					.setIcon("minus")
					.onClick(() => {
						void this.plugin.setTasksStatus(group.tasks, TASK_STATUS_CANCELLED, {
							onlyUnchecked: true,
						});
					});
			});
			menu.addSeparator();
			menu.addItem((item) => {
				item
					.setTitle("Defer until")
					.setIcon("calendar-days")
					.onClick(() => {
						new DeferUntilModal(
							this.app,
							group.noteTitle,
							group.deferredUntil,
							async (deferredUntil) => {
								await this.plugin.setDeferredUntil(group.file, deferredUntil);
							},
						).open();
					});
			});
			menu.addSeparator();
			menu.addItem((item) => {
				item
					.setTitle("Hide")
					.setIcon("eye-off")
					.onClick(() => {
						void this.plugin.hideFromTaskList(group.file);
					});
			});
			menu.showAtMouseEvent(event);
		});
	}

	private bindSectionMenu(headingEl: HTMLHeadingElement, section: TaskSectionGroup): void {
		this.registerDomEvent(headingEl, "contextmenu", (event) => {
			event.preventDefault();
			event.stopPropagation();

			const menu = new Menu();
			menu.addItem((item) => {
				item
					.setTitle("Complete all")
					.setIcon("check")
					.onClick(() => {
						void this.plugin.setTasksStatus(section.tasks, TASK_STATUS_DONE);
					});
			});
			menu.addItem((item) => {
				item
					.setTitle("Cancel pending")
					.setIcon("minus")
					.onClick(() => {
						void this.plugin.setTasksStatus(section.tasks, TASK_STATUS_CANCELLED, {
							onlyUnchecked: true,
						});
					});
			});
			menu.showAtMouseEvent(event);
		});
	}

	private decorateHeadingContext(headingEl: HTMLHeadingElement): void {
		const headingBlockEl = headingEl.closest(".el-h2") ?? headingEl;
		let nextBlockEl = headingBlockEl.nextElementSibling;

		while (nextBlockEl) {
			const paragraphEl =
				nextBlockEl instanceof HTMLParagraphElement
					? nextBlockEl
					: nextBlockEl.querySelector(":scope > p");

			if (!(paragraphEl instanceof HTMLParagraphElement)) {
				return;
			}

			const text = paragraphEl.textContent?.trim() ?? "";

			if (text.startsWith("Deferred until:")) {
				paragraphEl.addClass("vault-tasks-view__deferred");
				nextBlockEl = nextBlockEl.nextElementSibling;
				continue;
			}

			if (text.startsWith("Related to:")) {
				paragraphEl.addClass("vault-tasks-view__connections");

				const linkEls = Array.from(
					paragraphEl.querySelectorAll<HTMLAnchorElement>("a.internal-link"),
				);
				for (const linkEl of linkEls) {
					linkEl.addClass("vault-tasks-view__connections-link");
				}
				nextBlockEl = nextBlockEl.nextElementSibling;
				continue;
			}

			return;
		}
	}
}

class DeferUntilModal extends Modal {
	private dateInputEl: HTMLInputElement | null = null;
	private readonly minimumDate = getTomorrowDateString();

	constructor(
		app: VaultTasksPlugin["app"],
		private readonly noteTitle: string,
		private readonly currentDeferredUntil: string | null,
		private readonly onSubmitDate: (deferredUntil: string) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle("Defer until");

		new Setting(this.contentEl)
			.setName(this.noteTitle)
			.setDesc("Pending tasks from this note stay hidden until this date.")
			.addText((component) => {
				component.inputEl.type = "date";
				component.inputEl.min = this.minimumDate;
				component.setValue(this.getInitialDateValue());
				this.dateInputEl = component.inputEl;

				component.inputEl.addEventListener("keydown", (event) => {
					if (event.key !== "Enter") {
						return;
					}

					event.preventDefault();
					void this.submit();
				});
			});

		new Setting(this.contentEl)
			.addButton((button) => {
				button.setButtonText("Cancel").onClick(() => {
					this.close();
				});
			})
			.addButton((button) => {
				button.setButtonText("Save").setCta().onClick(() => {
					void this.submit();
				});
			});

		this.dateInputEl?.focus();
		window.setTimeout(() => {
			const dateInputEl = this.dateInputEl as (HTMLInputElement & {
				showPicker?: () => void;
			}) | null;
			try {
				dateInputEl?.showPicker?.();
			} catch {
				// Ignore unsupported or blocked picker calls.
			}
		}, 0);
	}

	private getInitialDateValue(): string {
		if (this.currentDeferredUntil && this.currentDeferredUntil >= this.minimumDate) {
			return this.currentDeferredUntil;
		}

		return this.minimumDate;
	}

	private async submit(): Promise<void> {
		const deferredUntil = this.dateInputEl?.value ?? "";

		if (!isFutureDate(deferredUntil)) {
			new Notice("Choose a future date.");
			return;
		}

		await this.onSubmitDate(deferredUntil);
		this.close();
	}
}

function buildRenderedDocument(
	snapshot: TaskSnapshot,
	metadataCache: VaultTasksPlugin["app"]["metadataCache"],
	getBacklinkFiles: (file: TFile) => TFile[],
): {
	markdown: string;
	renderedGroups: TaskGroup[];
	renderedSections: TaskSectionGroup[];
	renderedTasks: TaskItem[];
} {
	const sections: string[] = [];
	const renderedGroups: TaskGroup[] = [];
	const renderedSections: TaskSectionGroup[] = [];
	const renderedTasks: TaskItem[] = [];
	const today = getTodayDateString();

	for (const group of snapshot.groups) {
		if (snapshot.filter === "pending" && isDeferred(group.deferredUntil, today)) {
			continue;
		}

		const visibleTasks = group.tasks.filter((task) => matchesFilter(task, snapshot.filter));

		if (visibleTasks.length === 0) {
			continue;
		}

		const linkText = escapeWikiLinkText(metadataCache.fileToLinktext(group.file, "/", true));
		const noteTitle = escapeWikiLinkText(group.noteTitle);

		sections.push(`## [[${linkText}|${noteTitle}]]`);
		renderedGroups.push(group);

		if (snapshot.filter === "all" && group.deferredUntil) {
			sections.push(buildDeferredUntilLine(group.deferredUntil));
		}

		if (snapshot.showConnections) {
			const backlinks = getBacklinkFiles(group.file);

			if (backlinks.length > 0) {
				sections.push(buildConnectionsLine(backlinks, metadataCache));
			}
		}

		let currentSectionKey: string | null = null;
		let currentSection: TaskSectionGroup | null = null;

		for (const task of visibleTasks) {
			const sectionKey =
				task.sectionHeading !== null && task.sectionLine !== null
					? `${task.sectionLine}:${task.sectionHeading}`
					: null;

			if (sectionKey !== currentSectionKey) {
				currentSectionKey = sectionKey;

				if (task.sectionHeading !== null) {
					sections.push(`### ${task.sectionHeading}`);
					currentSection = {
						file: group.file,
						heading: task.sectionHeading,
						line: task.sectionLine ?? task.line,
						tasks: [],
					};
					renderedSections.push(currentSection);
				} else {
					currentSection = null;
				}
			}

			sections.push(task.renderedLine);
			currentSection?.tasks.push(task);
			renderedTasks.push(task);
		}

		sections.push("");
	}

	if (sections.length === 0) {
		const emptyMessage =
			snapshot.error ??
			(snapshot.filter === "all" ? "No tasks." : `No ${filterDescription(snapshot.filter)} tasks.`);

		return {
			markdown: emptyMessage,
			renderedGroups,
			renderedSections,
			renderedTasks,
		};
	}

	return {
		markdown: sections.join("\n").trim(),
		renderedGroups,
		renderedSections,
		renderedTasks,
	};
}

function buildDeferredUntilLine(deferredUntil: string): string {
	return `<span class="vault-tasks-view__deferred-label">Deferred until:</span> ${deferredUntil}`;
}

function buildConnectionsLine(
	backlinks: TFile[],
	metadataCache: VaultTasksPlugin["app"]["metadataCache"],
): string {
	const renderedLinks = backlinks.map((backlinkFile) => {
		const linkText = escapeWikiLinkText(metadataCache.fileToLinktext(backlinkFile, "/", true));
		return `[[${linkText}]]`;
	});

	return `<span class="vault-tasks-view__connections-label">Related to:</span> ${renderedLinks.join(", ")}`;
}

function buildTaskItem(
	file: TFile,
	taskItem: ListItemCache,
	lines: string[],
	headings: HeadingCache[],
): TaskItem | null {
	const line = taskItem.position.start.line;
	const rawLine = lines[line];

	if (rawLine === undefined) {
		return null;
	}

	const text = extractTaskText(rawLine);
	if (text === null) {
		return null;
	}

	const section = findTaskSection(line, headings);
	const statusSymbol = normalizeTaskStatusSymbol(taskItem.task);

	return {
		completed: isCompletedTaskStatus(statusSymbol),
		file,
		key: `${file.path}:${line}`,
		line,
		rawLine,
		renderedLine: rawLine.trimStart(),
		sectionHeading: section?.heading ?? null,
		sectionLine: section?.position.start.line ?? null,
		statusSymbol,
		text,
	};
}

function collectEditorLines(editor: Editor): string[] {
	const lines: string[] = [];

	for (let index = 0; index < editor.lineCount(); index += 1) {
		lines.push(editor.getLine(index));
	}

	return lines;
}

function escapeWikiLinkText(text: string): string {
	return text.replace(/([\\[\]|])/g, "\\$1");
}

function extractTaskText(rawLine: string): string | null {
	const match = rawLine.match(TASK_TEXT_PATTERN);
	return match ? match[1] : null;
}

function extractDeferredUntil(content: string): string | null {
	return normalizeDeferredUntil(extractFrontmatterValue(content, DEFERRED_UNTIL_KEY));
}

function extractHiddenFromTaskList(content: string): boolean {
	return normalizeFrontmatterBoolean(extractFrontmatterValue(content, HIDDEN_FROM_TASKS_KEY)) ?? false;
}

function filterLabel(filter: TaskFilter): string {
	switch (filter) {
		case "pending":
			return "Pending";
		case "completed":
			return "Completed";
		default:
			return "All";
	}
}

function filterIcon(filter: TaskFilter): "list" | "circle" | "check" {
	switch (filter) {
		case "pending":
			return "circle";
		case "completed":
			return "check";
		default:
			return "list";
	}
}

function filterDescription(filter: TaskFilter): string {
	switch (filter) {
		case "pending":
			return "pending";
		case "completed":
			return "completed";
		default:
			return "all";
	}
}

function getTodayDateString(): string {
	return formatDate(new Date());
}

function getTomorrowDateString(): string {
	const tomorrow = new Date();
	tomorrow.setDate(tomorrow.getDate() + 1);
	return formatDate(tomorrow);
}

function isDeferred(deferredUntil: string | null, today: string): boolean {
	return deferredUntil !== null && deferredUntil > today;
}

function isFutureDate(date: string): boolean {
	return DATE_PATTERN.test(date) && date >= getTomorrowDateString();
}

function isHiddenFromTaskListFrontmatter(frontmatter: Record<string, unknown> | null | undefined): boolean {
	if (!frontmatter) {
		return false;
	}

	return normalizeFrontmatterBoolean(frontmatter[HIDDEN_FROM_TASKS_KEY]) ?? false;
}

function findTaskLine(lines: string[], task: TaskItem): number | null {
	const currentLine = lines[task.line];
	if (currentLine !== undefined) {
		const sameLine = currentLine === task.rawLine || extractTaskText(currentLine) === task.text;
		if (sameLine) {
			return task.line;
		}
	}

	const rawLineMatches = lines
		.map((line, index) => ({ index, line }))
		.filter(({ line }) => line === task.rawLine);

	if (rawLineMatches.length === 1) {
		return rawLineMatches[0].index;
	}

	const textMatches = lines
		.map((line, index) => ({ index, text: extractTaskText(line) }))
		.filter(({ text }) => text === task.text);

	if (textMatches.length === 1) {
		return textMatches[0].index;
	}

	return null;
}

function getTaskListItems(cache: CachedMetadata | null): ListItemCache[] {
	if (!cache?.listItems) {
		return [];
	}

	return cache.listItems.filter((item): item is ListItemCache => item.task !== undefined);
}

function getHeadingCaches(cache: CachedMetadata | null): HeadingCache[] {
	if (!cache?.headings) {
		return [];
	}

	return [...cache.headings].sort(
		(left, right) => left.position.start.line - right.position.start.line,
	);
}

function matchesFilter(task: TaskItem, filter: TaskFilter): boolean {
	switch (filter) {
		case "pending":
			return isPendingTaskStatus(task.statusSymbol);
		case "completed":
			return isCompletedTaskStatus(task.statusSymbol);
		default:
			return true;
	}
}

function setTaskCompletion(rawLine: string, completed: boolean): string | null {
	return setTaskStatusSymbol(rawLine, completed ? TASK_STATUS_DONE : TASK_STATUS_TODO);
}

function setTaskStatusSymbol(rawLine: string, statusSymbol: string): string | null {
	const match = rawLine.match(TASK_LINE_PATTERN);

	if (!match) {
		return null;
	}

	return `${match[1]}${statusSymbol}${match[3]}`;
}

function getTaskStatusSymbol(rawLine: string): string | null {
	const match = rawLine.match(TASK_LINE_PATTERN);
	return match ? match[2] : null;
}

function findTaskSection(taskLine: number, headings: HeadingCache[]): HeadingCache | null {
	let nearestHeading: HeadingCache | null = null;

	for (const heading of headings) {
		if (heading.position.start.line >= taskLine) {
			break;
		}

		nearestHeading = heading;
	}

	return nearestHeading;
}

function updateAllTasksInEditor(editor: Editor, completed: boolean): number {
	let updatedCount = 0;

	for (let index = 0; index < editor.lineCount(); index += 1) {
		const rawLine = editor.getLine(index);
		const nextLine = setTaskCompletion(rawLine, completed);

		if (nextLine === null || nextLine === rawLine) {
			continue;
		}

		editor.setLine(index, nextLine);
		updatedCount += 1;
	}

	return updatedCount;
}

function updateSpecificTasksInEditor(
	editor: Editor,
	tasks: TaskItem[],
	statusSymbol: string,
	options?: { onlyUnchecked?: boolean },
): number {
	const lines = collectEditorLines(editor);
	let updatedCount = 0;

	for (const task of tasks) {
		const targetLine = findTaskLine(lines, task);

		if (targetLine === null) {
			continue;
		}

		const currentLine = lines[targetLine];
		const currentStatus = getTaskStatusSymbol(currentLine);
		if (currentStatus === null) {
			continue;
		}

		if (options?.onlyUnchecked && currentStatus !== TASK_STATUS_TODO) {
			continue;
		}

		const nextLine = setTaskStatusSymbol(currentLine, statusSymbol);
		if (nextLine === null || nextLine === currentLine) {
			continue;
		}

		lines[targetLine] = nextLine;
		editor.setLine(targetLine, nextLine);
		updatedCount += 1;
	}

	return updatedCount;
}

function updateTaskInContent(content: string, task: TaskItem, completed: boolean): string {
	return updateTaskStatusInContent(content, task, completed ? TASK_STATUS_DONE : TASK_STATUS_TODO);
}

function updateTaskStatusInContent(content: string, task: TaskItem, statusSymbol: string): string {
	const newline = content.includes("\r\n") ? "\r\n" : "\n";
	const lines = content.split(/\r?\n/);
	const targetLine = findTaskLine(lines, task);

	if (targetLine === null) {
		throw new Error("The task moved before it could be updated. Refresh and try again.");
	}

	const nextLine = setTaskStatusSymbol(lines[targetLine], statusSymbol);
	if (nextLine === null) {
		throw new Error("The source line is no longer a standard Markdown task.");
	}

	lines[targetLine] = nextLine;
	return lines.join(newline);
}

function updateAllTasksInContent(
	content: string,
	completed: boolean,
): { content: string; updatedCount: number } {
	const newline = content.includes("\r\n") ? "\r\n" : "\n";
	const lines = content.split(/\r?\n/);
	let updatedCount = 0;

	for (let index = 0; index < lines.length; index += 1) {
		const rawLine = lines[index];
		const nextLine = setTaskCompletion(rawLine, completed);

		if (nextLine === null || nextLine === rawLine) {
			continue;
		}

		lines[index] = nextLine;
		updatedCount += 1;
	}

	return {
		content: lines.join(newline),
		updatedCount,
	};
}

function updateSpecificTasksInContent(
	content: string,
	tasks: TaskItem[],
	statusSymbol: string,
	options?: { onlyUnchecked?: boolean },
): { content: string; updatedCount: number } {
	const newline = content.includes("\r\n") ? "\r\n" : "\n";
	const lines = content.split(/\r?\n/);
	let updatedCount = 0;

	for (const task of tasks) {
		const targetLine = findTaskLine(lines, task);

		if (targetLine === null) {
			continue;
		}

		const currentLine = lines[targetLine];
		const currentStatus = getTaskStatusSymbol(currentLine);
		if (currentStatus === null) {
			continue;
		}

		if (options?.onlyUnchecked && currentStatus !== TASK_STATUS_TODO) {
			continue;
		}

		const nextLine = setTaskStatusSymbol(currentLine, statusSymbol);
		if (nextLine === null || nextLine === currentLine) {
			continue;
		}

		lines[targetLine] = nextLine;
		updatedCount += 1;
	}

	return {
		content: lines.join(newline),
		updatedCount,
	};
}

function isCheckboxCheckedStatus(statusSymbol: string): boolean {
	return statusSymbol !== TASK_STATUS_TODO;
}

function isCompletedTaskStatus(statusSymbol: string): boolean {
	return statusSymbol === TASK_STATUS_DONE || statusSymbol === "X" || statusSymbol === TASK_STATUS_CANCELLED;
}

function isPendingTaskStatus(statusSymbol: string): boolean {
	return (
		statusSymbol === TASK_STATUS_TODO ||
		statusSymbol === TASK_STATUS_IN_PROGRESS
	);
}

function normalizeTaskStatusSymbol(statusSymbol: string | undefined): string {
	switch (statusSymbol) {
		case TASK_STATUS_TODO:
		case TASK_STATUS_IN_PROGRESS:
		case TASK_STATUS_DONE:
		case "X":
		case TASK_STATUS_CANCELLED:
		case TASK_STATUS_DEFERRED:
			return statusSymbol;
		default:
			return statusSymbol || TASK_STATUS_TODO;
	}
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function formatDate(date: Date): string {
	const year = String(date.getFullYear());
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function normalizeDeferredUntil(value: string | null): string | null {
	const unquotedValue = unquoteFrontmatterValue(value);

	return DATE_PATTERN.test(unquotedValue) ? unquotedValue : null;
}

function extractFrontmatterValue(content: string, key: string): string | null {
	const frontmatterMatch = content.match(FRONTMATTER_PATTERN);
	if (!frontmatterMatch) {
		return null;
	}

	const frontmatter = frontmatterMatch[1];
	const valueMatch = frontmatter.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
	return valueMatch ? valueMatch[1] : null;
}

function normalizeFrontmatterBoolean(value: unknown): boolean | null {
	if (typeof value === "boolean") {
		return value;
	}

	if (typeof value !== "string") {
		return null;
	}

	switch (unquoteFrontmatterValue(value).toLowerCase()) {
		case "true":
		case "yes":
		case "on":
			return true;
		case "false":
		case "no":
		case "off":
			return false;
		default:
			return null;
	}
}

function unquoteFrontmatterValue(value: string | null): string {
	if (value === null) {
		return "";
	}

	const trimmedValue = value.trim();
	return (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
		(trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))
		? trimmedValue.slice(1, -1)
		: trimmedValue;
}
