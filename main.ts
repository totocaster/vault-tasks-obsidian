import {
	CachedMetadata,
	Component,
	debounce,
	Editor,
	ItemView,
	Keymap,
	ListItemCache,
	MarkdownRenderer,
	MarkdownView,
	Notice,
	Plugin,
	setIcon,
	TFile,
	WorkspaceLeaf,
} from "obsidian";

const VIEW_TYPE_TASKS = "vault-tasks-view";
const VIEW_TITLE = "Vault tasks";
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
	text: string;
}

interface TaskGroup {
	file: TFile;
	noteTitle: string;
	tasks: TaskItem[];
}

interface TaskSnapshot {
	error: string | null;
	filter: TaskFilter;
	groups: TaskGroup[];
	refreshing: boolean;
	showConnections: boolean;
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

	async openTask(task: TaskItem): Promise<void> {
		const leaf = this.getPreferredNoteLeaf();
		await leaf.openFile(task.file);
		this.app.workspace.setActiveLeaf(leaf, { focus: true });

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
		try {
			this.autoRefreshPaused = true;
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

			if (activeView?.file?.path === task.file.path) {
				this.toggleTaskInEditor(activeView.editor, task, completed);
			} else {
				await this.app.vault.process(task.file, (content) => {
					return updateTaskInContent(content, task, completed);
				});
			}

			const nextLine = setTaskCompletion(task.rawLine, completed);
			if (nextLine !== null) {
				task.completed = completed;
				task.rawLine = nextLine;
				task.renderedLine = nextLine.trimStart();
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

	private async buildTaskGroups(): Promise<TaskGroup[]> {
		const taskFiles = this.app.vault.getMarkdownFiles().flatMap((file) => {
			const taskItems = getTaskListItems(this.app.metadataCache.getFileCache(file));

			if (taskItems.length === 0) {
				return [];
			}

			return [{ file, taskItems }];
		});

		const groups = await Promise.all(
			taskFiles.map(async ({ file, taskItems }) => {
				const lines = (await this.app.vault.cachedRead(file)).split(/\r?\n/);
				const tasks = taskItems
					.map((taskItem) => buildTaskItem(file, taskItem, lines))
					.filter((task): task is TaskItem => task !== null)
					.sort((left, right) => left.line - right.line);

				return {
					file,
					noteTitle: file.basename,
					tasks,
				};
			}),
		);

		return groups
			.filter((group) => group.tasks.length > 0)
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
			if (sourceFile instanceof TFile && sourceFile.extension === "md") {
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

	private toggleTaskInEditor(editor: Editor, task: TaskItem, completed: boolean): void {
		const lines = collectEditorLines(editor);
		const targetLine = findTaskLine(lines, task);

		if (targetLine === null) {
			throw new Error("The task moved before it could be updated. Refresh and try again.");
		}

		const nextLine = setTaskCompletion(lines[targetLine], completed);
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
		const snapshot = this.plugin.getSnapshot();
		const { markdown, renderedTasks } = buildRenderedDocument(
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
			this.addJumpButton(checkbox, task);
		}

		if (snapshot.showConnections) {
			const headings = Array.from(sizerEl.querySelectorAll<HTMLHeadingElement>("h2"));

			for (const headingEl of headings) {
				this.decorateConnectionsContext(headingEl);
			}
		}
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

		for (const filter of ["all", "pending", "completed"] as TaskFilter[]) {
			const buttonEl = filterEl.createEl("button", {
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

		const archiveButtonEl = filterEl.createEl("button", {
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

		const connectionsButtonEl = filterEl.createEl("button", {
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

	private decorateConnectionsContext(headingEl: HTMLHeadingElement): void {
		const headingBlockEl = headingEl.closest(".el-h2") ?? headingEl;
		const nextBlockEl = headingBlockEl.nextElementSibling;

		if (!nextBlockEl) {
			return;
		}

		const paragraphEl =
			nextBlockEl instanceof HTMLParagraphElement
				? nextBlockEl
				: nextBlockEl.querySelector(":scope > p");

		if (!(paragraphEl instanceof HTMLParagraphElement)) {
			return;
		}

		if (!paragraphEl.textContent?.trim().startsWith("Related to:")) {
			return;
		}

		paragraphEl.addClass("vault-tasks-view__connections");

		const labelEl = paragraphEl.querySelector("span");
		if (labelEl instanceof HTMLSpanElement) {
			labelEl.addClass("vault-tasks-view__connections-label");
		}

		const linkEls = Array.from(
			paragraphEl.querySelectorAll<HTMLAnchorElement>("a.internal-link"),
		);
		for (const linkEl of linkEls) {
			linkEl.addClass("vault-tasks-view__connections-link");
		}
	}
}

function buildRenderedDocument(
	snapshot: TaskSnapshot,
	metadataCache: VaultTasksPlugin["app"]["metadataCache"],
	getBacklinkFiles: (file: TFile) => TFile[],
): { markdown: string; renderedGroups: TaskGroup[]; renderedTasks: TaskItem[] } {
	const sections: string[] = [];
	const renderedGroups: TaskGroup[] = [];
	const renderedTasks: TaskItem[] = [];

	for (const group of snapshot.groups) {
		const visibleTasks = group.tasks.filter((task) => matchesFilter(task, snapshot.filter));

		if (visibleTasks.length === 0) {
			continue;
		}

		const linkText = escapeWikiLinkText(metadataCache.fileToLinktext(group.file, "/", true));
		const noteTitle = escapeWikiLinkText(group.noteTitle);

		sections.push(`## [[${linkText}|${noteTitle}]]`);
		renderedGroups.push(group);

		if (snapshot.showConnections) {
			const backlinks = getBacklinkFiles(group.file);

			if (backlinks.length > 0) {
				sections.push(buildConnectionsLine(backlinks, metadataCache));
			}
		}

		for (const task of visibleTasks) {
			sections.push(task.renderedLine);
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
			renderedTasks,
		};
	}

	return {
		markdown: sections.join("\n").trim(),
		renderedGroups,
		renderedTasks,
	};
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

function buildTaskItem(file: TFile, taskItem: ListItemCache, lines: string[]): TaskItem | null {
	const line = taskItem.position.start.line;
	const rawLine = lines[line];

	if (rawLine === undefined) {
		return null;
	}

	const text = extractTaskText(rawLine);
	if (text === null) {
		return null;
	}

	return {
		completed: taskItem.task !== " ",
		file,
		key: `${file.path}:${line}`,
		line,
		rawLine,
		renderedLine: rawLine.trimStart(),
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

function matchesFilter(task: TaskItem, filter: TaskFilter): boolean {
	switch (filter) {
		case "pending":
			return !task.completed;
		case "completed":
			return task.completed;
		default:
			return true;
	}
}

function setTaskCompletion(rawLine: string, completed: boolean): string | null {
	const match = rawLine.match(TASK_LINE_PATTERN);

	if (!match) {
		return null;
	}

	return `${match[1]}${completed ? "x" : " "}${match[3]}`;
}

function updateTaskInContent(content: string, task: TaskItem, completed: boolean): string {
	const newline = content.includes("\r\n") ? "\r\n" : "\n";
	const lines = content.split(/\r?\n/);
	const targetLine = findTaskLine(lines, task);

	if (targetLine === null) {
		throw new Error("The task moved before it could be updated. Refresh and try again.");
	}

	const nextLine = setTaskCompletion(lines[targetLine], completed);
	if (nextLine === null) {
		throw new Error("The source line is no longer a standard Markdown task.");
	}

	lines[targetLine] = nextLine;
	return lines.join(newline);
}
