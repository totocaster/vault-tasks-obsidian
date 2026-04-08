import {
	Component,
	ItemView,
	Keymap,
	MarkdownRenderer,
	MarkdownView,
	Menu,
	setIcon,
	type WorkspaceLeaf,
} from "obsidian";
import {
	filterIcon,
	filterLabel,
	TASK_STATUS_CANCELLED,
	TASK_STATUS_DEFERRED,
	TASK_STATUS_DONE,
	TASK_STATUS_IN_PROGRESS,
	TASK_STATUS_TODO,
	VIEW_TITLE,
	VIEW_TYPE_TASKS,
} from "./config";
import { DeferUntilModal } from "./defer-until-modal";
import { isCheckboxCheckedStatus } from "./lib/filtering";
import { buildRenderedDocument } from "./logic";
import type {
	TaskFilter,
	TaskGroup,
	TaskItem,
	TaskSectionGroup,
	ViewScrollAnchor,
	ViewScrollState,
} from "./types";
import type VaultTasksPlugin from "./plugin";

export class VaultTasksView extends ItemView {
	private archiveButtonEl: HTMLButtonElement | null = null;
	private connectionsButtonEl: HTMLButtonElement | null = null;
	private filterButtons = new Map<TaskFilter, HTMLButtonElement>();
	private headerFilterEl: HTMLDivElement | null = null;
	private markdownHostEl: HTMLDivElement | null = null;
	private renderComponent: Component | null = null;
	private renderedTasks = new Map<string, TaskItem>();
	private sectionFilterButtonEl: HTMLButtonElement | null = null;
	private sectionFilterChipEl: HTMLButtonElement | null = null;

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
		this.sectionFilterButtonEl = null;
		this.sectionFilterChipEl = null;
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
		this.updateSectionFilterControls();
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

		const checkboxes = Array.from(
			sizerEl.querySelectorAll<HTMLInputElement>("input[type='checkbox']"),
		);

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
			this.decorateHeadingActions(headingEl, group);
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
		this.updateSectionFilterControls();
	}

	private ensureHeaderFilters(): void {
		if (this.headerFilterEl?.isConnected) {
			return;
		}

		const actionsEl =
			this.containerEl.querySelector<HTMLElement>(".view-actions") ??
			this.containerEl
				.closest(".workspace-leaf-content")
				?.querySelector<HTMLElement>(".view-actions");

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

		const sectionGroupEl = filterEl.createDiv({
			cls: "vault-tasks-view__header-group",
		});

		const sectionFilterButtonEl = sectionGroupEl.createEl("button", {
			cls: ["clickable-icon", "view-action", "vault-tasks-view__header-filter"],
			attr: {
				"data-tooltip-position": "bottom",
				"aria-label": "Filter by section",
				title: "Filter by section",
				type: "button",
			},
		});
		setIcon(sectionFilterButtonEl, "filter");

		this.registerDomEvent(sectionFilterButtonEl, "click", (event) => {
			this.showSectionFilterMenu(event);
		});

		this.sectionFilterButtonEl = sectionFilterButtonEl;

		const sectionFilterChipEl = sectionGroupEl.createEl("button", {
			cls: "vault-tasks-view__header-chip is-hidden",
			attr: {
				"data-tooltip-position": "bottom",
				type: "button",
			},
		});

		this.registerDomEvent(sectionFilterChipEl, "click", () => {
			void this.plugin.setSectionFilter(null);
		});

		this.sectionFilterChipEl = sectionFilterChipEl;

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

	private updateSectionFilterControls(): void {
		if (this.sectionFilterButtonEl) {
			const hasSectionFilter = this.plugin.getSectionFilter() !== null;
			this.sectionFilterButtonEl.toggleClass("is-active", hasSectionFilter);
			this.sectionFilterButtonEl.setAttr("aria-pressed", hasSectionFilter ? "true" : "false");
		}

		if (!this.sectionFilterChipEl) {
			return;
		}

		const sectionFilter = this.plugin.getSectionFilter();
		const label =
			sectionFilter?.kind === "none"
				? "No section"
				: sectionFilter?.kind === "heading"
					? sectionFilter.heading
					: null;

		if (!label) {
			this.sectionFilterChipEl.addClass("is-hidden");
			this.sectionFilterChipEl.empty();
			this.sectionFilterChipEl.removeAttribute("aria-label");
			this.sectionFilterChipEl.removeAttribute("title");
			return;
		}

		this.sectionFilterChipEl.removeClass("is-hidden");
		this.sectionFilterChipEl.setText(label);
		this.sectionFilterChipEl.setAttr("aria-label", `Clear section filter: ${label}`);
		this.sectionFilterChipEl.setAttr("title", `Clear section filter: ${label}`);
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

	private showSectionFilterMenu(event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();

		const menu = new Menu();
		const activeFilter = this.plugin.getSectionFilter();
		const availableFilters = this.plugin.getAvailableSectionFilters(this.plugin.getFilter());

		menu.addItem((item) => {
			item
				.setTitle("All sections")
				.setIcon("list")
				.setChecked(activeFilter === null)
				.onClick(() => {
					void this.plugin.setSectionFilter(null);
				});
		});

		if (availableFilters.hasNoSection || activeFilter?.kind === "none") {
			menu.addItem((item) => {
				item
					.setTitle("No section")
					.setChecked(activeFilter?.kind === "none")
					.onClick(() => {
						void this.plugin.setSectionFilter({ kind: "none" });
					});
			});
		}

		const sectionHeadings = new Set(availableFilters.headings);
		if (activeFilter?.kind === "heading") {
			sectionHeadings.add(activeFilter.heading);
		}

		const sortedHeadings = Array.from(sectionHeadings).sort((left, right) =>
			left.localeCompare(right),
		);

		if (sortedHeadings.length > 0) {
			menu.addSeparator();
			for (const heading of sortedHeadings) {
				menu.addItem((item) => {
					item
						.setTitle(heading)
						.setChecked(activeFilter?.kind === "heading" && activeFilter.heading === heading)
						.onClick(() => {
							void this.plugin.setSectionFilter({ kind: "heading", heading });
						});
				});
			}
		} else if (!availableFilters.hasNoSection && activeFilter === null) {
			menu.addSeparator();
			menu.addItem((item) => {
				item.setTitle("No sections available").setDisabled(true);
			});
		}

		menu.showAtMouseEvent(event);
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

		if (!key || (type !== "group" && type !== "section" && type !== "task")) {
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
			scrollState.primaryAnchor && this.findScrollAnchorElement(scrollState.primaryAnchor)
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

	private decorateHeadingActions(headingEl: HTMLHeadingElement, group: TaskGroup): void {
		const headingBlockEl = headingEl.closest<HTMLElement>(".el-h2") ?? headingEl;
		headingBlockEl.addClass("vault-tasks-view__note-heading-block");
		headingEl.addClass("vault-tasks-view__note-heading");

		const actionsEl = headingBlockEl.createDiv({
			cls: "vault-tasks-view__note-actions",
		});
		const isPinned = this.plugin.isNotePinned(group.file);

		this.createHeadingAction(actionsEl, {
			alwaysVisible: isPinned,
			ariaLabel: isPinned ? `Unpin ${group.noteTitle}` : `Pin ${group.noteTitle}`,
			icon: "pin",
			isPinned,
			onClick: async () => {
				if (this.plugin.isNotePinned(group.file)) {
					await this.plugin.unpinNote(group.file);
					return;
				}

				await this.plugin.pinNote(group.file);
			},
			title: isPinned ? "Unpin note" : "Pin note",
		});

		if (!isPinned) {
			return;
		}

		this.createHeadingAction(actionsEl, {
			ariaLabel: `Move ${group.noteTitle} up`,
			disabled: !this.plugin.canMovePinnedNote(group.file, "up"),
			icon: "arrow-up",
			onClick: async () => {
				await this.plugin.movePinnedNote(group.file, "up");
			},
			title: "Move pinned note up",
		});

		this.createHeadingAction(actionsEl, {
			ariaLabel: `Move ${group.noteTitle} down`,
			disabled: !this.plugin.canMovePinnedNote(group.file, "down"),
			icon: "arrow-down",
			onClick: async () => {
				await this.plugin.movePinnedNote(group.file, "down");
			},
			title: "Move pinned note down",
		});
	}

	private createHeadingAction(
		containerEl: HTMLElement,
		options: {
			alwaysVisible?: boolean;
			ariaLabel: string;
			disabled?: boolean;
			icon: string;
			isPinned?: boolean;
			onClick: () => Promise<void>;
			title: string;
		},
	): void {
		const actionEl = createEl("span", {
			cls: "vault-tasks-view__note-action",
			attr: {
				"aria-label": options.ariaLabel,
				"data-tooltip-position": "bottom",
				title: options.title,
			},
		});
		setIcon(actionEl, options.icon);

		if (options.alwaysVisible) {
			actionEl.addClass("is-always-visible");
		}

		if (options.isPinned) {
			actionEl.addClass("is-pinned");
		}

		if (options.disabled) {
			actionEl.addClass("is-disabled");
			actionEl.setAttr("aria-disabled", "true");
			containerEl.appendChild(actionEl);
			return;
		}

		actionEl.setAttr("role", "button");
		actionEl.setAttr("tabindex", "0");

		this.registerDomEvent(actionEl, "click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			void options.onClick();
		});

		this.registerDomEvent(actionEl, "keydown", (event) => {
			if (event.key !== "Enter" && event.key !== " ") {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			void options.onClick();
		});

		containerEl.appendChild(actionEl);
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

	private applyTaskStatusesToRenderedTasks(tasks: TaskItem[]): void {
		for (const task of tasks) {
			const listItemEl = this.contentEl.querySelector<HTMLElement>(
				`li[data-task-key="${CSS.escape(task.key)}"]`,
			);

			if (!listItemEl) {
				continue;
			}

			this.applyTaskStatusToElement(listItemEl, task);
		}
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

		const statusActions: Array<{ title: string; icon: string; symbol: string }> =
			this.plugin.getSettings().statusMode === "standard"
				? [
						{ title: "Todo", icon: "circle", symbol: TASK_STATUS_TODO },
						{ title: "Done", icon: "check", symbol: TASK_STATUS_DONE },
					]
				: [
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

							this.applyTaskStatusesToRenderedTasks([task]);
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
					.setTitle(this.plugin.isNotePinned(group.file) ? "Unpin" : "Pin to top")
					.setIcon("pin")
					.onClick(() => {
						void (this.plugin.isNotePinned(group.file)
							? this.plugin.unpinNote(group.file)
							: this.plugin.pinNote(group.file));
					});
			});
			menu.addItem((item) => {
				item
					.setTitle("Move up")
					.setIcon("arrow-up")
					.setDisabled(!this.plugin.canMovePinnedNote(group.file, "up"))
					.onClick(() => {
						void this.plugin.movePinnedNote(group.file, "up");
					});
			});
			menu.addItem((item) => {
				item
					.setTitle("Move down")
					.setIcon("arrow-down")
					.setDisabled(!this.plugin.canMovePinnedNote(group.file, "down"))
					.onClick(() => {
						void this.plugin.movePinnedNote(group.file, "down");
					});
			});
			menu.addSeparator();
			menu.addItem((item) => {
				item
					.setTitle("Complete all")
					.setIcon("check")
					.onClick(() => {
						void (async () => {
							const updatedTasks = await this.plugin.setTasksStatus(
								group.tasks,
								TASK_STATUS_DONE,
							);
							this.applyTaskStatusesToRenderedTasks(updatedTasks);
						})();
					});
			});
			if (this.plugin.getSettings().statusMode === "extended") {
				menu.addItem((item) => {
					item
						.setTitle("Cancel pending")
						.setIcon("minus")
						.onClick(() => {
							void (async () => {
								const updatedTasks = await this.plugin.setTasksStatus(
									group.tasks,
									TASK_STATUS_CANCELLED,
									{
										onlyUnchecked: true,
									},
								);
								this.applyTaskStatusesToRenderedTasks(updatedTasks);
							})();
						});
				});
			}
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

			const activeSectionFilter = this.plugin.getSectionFilter();
			const menu = new Menu();
			menu.addItem((item) => {
				item
					.setTitle("Show only this section")
					.setIcon("filter")
					.setChecked(
						activeSectionFilter?.kind === "heading" &&
							activeSectionFilter.heading === section.heading,
					)
					.onClick(() => {
						void this.plugin.setSectionFilter({
							kind: "heading",
							heading: section.heading,
						});
					});
			});
			menu.addSeparator();
			menu.addItem((item) => {
				item
					.setTitle("Complete all")
					.setIcon("check")
					.onClick(() => {
						void (async () => {
							const updatedTasks = await this.plugin.setTasksStatus(
								section.tasks,
								TASK_STATUS_DONE,
							);
							this.applyTaskStatusesToRenderedTasks(updatedTasks);
						})();
					});
			});
			if (this.plugin.getSettings().statusMode === "extended") {
				menu.addItem((item) => {
					item
						.setTitle("Cancel pending")
						.setIcon("minus")
						.onClick(() => {
							void (async () => {
								const updatedTasks = await this.plugin.setTasksStatus(
									section.tasks,
									TASK_STATUS_CANCELLED,
									{
										onlyUnchecked: true,
									},
								);
								this.applyTaskStatusesToRenderedTasks(updatedTasks);
							})();
						});
				});
			}
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
