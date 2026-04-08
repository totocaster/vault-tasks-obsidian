import {
	type CachedMetadata,
	type Editor,
	type HeadingCache,
	type ListItemCache,
	type TFile,
	normalizePath,
} from "obsidian";
import {
	DATE_PATTERN,
	DEFAULT_SETTINGS,
	DEFERRED_UNTIL_KEY,
	filterDescription,
	FRONTMATTER_PATTERN,
	HIDDEN_FROM_TASKS_KEY,
	LEGACY_DEFERRED_UNTIL_KEY,
	TASK_LINE_PATTERN,
	TASK_STATUS_CANCELLED,
	TASK_STATUS_DEFERRED,
	TASK_STATUS_DONE,
	TASK_STATUS_IN_PROGRESS,
	TASK_STATUS_TODO,
	TASK_TEXT_PATTERN,
} from "./config";
import type {
	NoteSortMode,
	RenderSectionBucket,
	SectionFilter,
	SectionSortMode,
	TaskFilter,
	TaskGroup,
	TaskItem,
	TaskSectionGroup,
	TaskSnapshot,
	TaskSortMode,
	VisibleTaskGroup,
	VaultTasksSettings,
} from "./types";

export function buildRenderedDocument(
	snapshot: TaskSnapshot,
	metadataCache: VaultTasksMetadataCache,
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
	const visibleGroups = getVisibleTaskGroups(snapshot, today);
	sortVisibleTaskGroups(visibleGroups, snapshot.settings.noteSort);

	for (const visibleGroup of visibleGroups) {
		const { group, tasks } = visibleGroup;
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

		const sectionBuckets = buildRenderSectionBuckets(tasks);
		sortRenderSectionBuckets(sectionBuckets, snapshot.settings.sectionSort);

		for (const sectionBucket of sectionBuckets) {
			sortTasks(sectionBucket.tasks, snapshot.settings.taskSort);

			let renderedSection: TaskSectionGroup | null = null;
			if (snapshot.settings.showSectionHeadings && sectionBucket.heading !== null) {
				sections.push(`### ${sectionBucket.heading}`);
				renderedSection = {
					file: group.file,
					heading: sectionBucket.heading,
					line: sectionBucket.line,
					tasks: [],
				};
				renderedSections.push(renderedSection);
			}

			for (const task of sectionBucket.tasks) {
				sections.push(task.renderedLine);
				renderedSection?.tasks.push(task);
				renderedTasks.push(task);
			}
		}

		sections.push("");
	}

	if (sections.length === 0) {
		const emptyMessage =
			snapshot.error ?? buildEmptyStateMessage(snapshot.filter, snapshot.sectionFilter);

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

type VaultTasksMetadataCache = {
	fileToLinktext: (file: TFile, sourcePath: string, omitMdExtension?: boolean) => string;
};

export function buildDeferredUntilLine(deferredUntil: string): string {
	return `<span class="vault-tasks-view__deferred-label">Deferred until:</span> ${deferredUntil}`;
}

export function buildConnectionsLine(
	backlinks: TFile[],
	metadataCache: VaultTasksMetadataCache,
): string {
	const renderedLinks = backlinks.map((backlinkFile) => {
		const linkText = escapeWikiLinkText(metadataCache.fileToLinktext(backlinkFile, "/", true));
		return `[[${linkText}]]`;
	});

	return `<span class="vault-tasks-view__connections-label">Related to:</span> ${renderedLinks.join(", ")}`;
}

export function getVisibleTaskGroups(
	snapshot: TaskSnapshot,
	today: string,
): VisibleTaskGroup[] {
	const visibleGroups: VisibleTaskGroup[] = [];

	for (const group of snapshot.groups) {
		if (snapshot.filter === "pending" && isDeferred(group.deferredUntil, today)) {
			continue;
		}

		const visibleTasks = group.tasks.filter(
			(task) =>
				matchesFilter(task, snapshot.filter, snapshot.settings) &&
				matchesSectionFilter(task, snapshot.sectionFilter),
		);

		if (visibleTasks.length === 0) {
			continue;
		}

		visibleGroups.push({
			group,
			tasks: [...visibleTasks],
		});
	}

	return visibleGroups;
}

export function buildRenderSectionBuckets(tasks: TaskItem[]): RenderSectionBucket[] {
	const buckets: RenderSectionBucket[] = [];
	let currentBucket: RenderSectionBucket | null = null;
	let currentBucketKey: string | null = null;

	for (const task of tasks) {
		const bucketKey =
			task.sectionHeading !== null && task.sectionLine !== null
				? `${task.sectionLine}:${task.sectionHeading}`
				: "__none__";

		if (bucketKey !== currentBucketKey) {
			currentBucketKey = bucketKey;
			currentBucket = {
				heading: task.sectionHeading,
				line: task.sectionLine ?? task.line,
				tasks: [],
			};
			buckets.push(currentBucket);
		}

		if (!currentBucket) {
			continue;
		}

		currentBucket.tasks.push(task);
	}

	return buckets;
}

export function buildTaskItem(
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

export function collectEditorLines(editor: Editor): string[] {
	const lines: string[] = [];

	for (let index = 0; index < editor.lineCount(); index += 1) {
		lines.push(editor.getLine(index));
	}

	return lines;
}

export function escapeWikiLinkText(text: string): string {
	return text.replace(/([\\[\]|])/g, "\\$1");
}

export function extractTaskText(rawLine: string): string | null {
	const match = rawLine.match(TASK_TEXT_PATTERN);
	return match ? match[1] : null;
}

export function extractDeferredUntil(content: string): string | null {
	return normalizeDeferredUntil(
		extractFrontmatterValue(content, DEFERRED_UNTIL_KEY) ??
			extractFrontmatterValue(content, LEGACY_DEFERRED_UNTIL_KEY),
	);
}

export function extractHiddenFromTaskList(content: string): boolean {
	return normalizeFrontmatterBoolean(extractFrontmatterValue(content, HIDDEN_FROM_TASKS_KEY)) ?? false;
}

export function getSectionFilterLabel(sectionFilter: SectionFilter): string | null {
	if (!sectionFilter) {
		return null;
	}

	if (sectionFilter.kind === "none") {
		return "No section";
	}

	return sectionFilter.heading;
}

export function buildEmptyStateMessage(
	filter: TaskFilter,
	sectionFilter: SectionFilter,
): string {
	const baseMessage =
		filter === "all" ? "No tasks." : `No ${filterDescription(filter)} tasks.`;
	const sectionLabel = getSectionFilterLabel(sectionFilter);

	if (!sectionLabel) {
		return baseMessage;
	}

	if (sectionFilter?.kind === "none") {
		return `${baseMessage.slice(0, -1)} without a section.`;
	}

	return `${baseMessage.slice(0, -1)} in ${sectionLabel}.`;
}

export function getTodayDateString(): string {
	return formatDate(new Date());
}

export function getTomorrowDateString(): string {
	const tomorrow = new Date();
	tomorrow.setDate(tomorrow.getDate() + 1);
	return formatDate(tomorrow);
}

export function isDeferred(deferredUntil: string | null, today: string): boolean {
	return deferredUntil !== null && deferredUntil > today;
}

export function isFutureDate(date: string): boolean {
	return DATE_PATTERN.test(date) && date >= getTomorrowDateString();
}

export function isHiddenFromTaskListFrontmatter(
	frontmatter: Record<string, unknown> | null | undefined,
): boolean {
	if (!frontmatter) {
		return false;
	}

	return normalizeFrontmatterBoolean(frontmatter[HIDDEN_FROM_TASKS_KEY]) ?? false;
}

export function findTaskLine(lines: string[], task: TaskItem): number | null {
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

export function getTaskListItems(cache: CachedMetadata | null): ListItemCache[] {
	if (!cache?.listItems) {
		return [];
	}

	return cache.listItems.filter((item): item is ListItemCache => item.task !== undefined);
}

export function getHeadingCaches(cache: CachedMetadata | null): HeadingCache[] {
	if (!cache?.headings) {
		return [];
	}

	return [...cache.headings].sort(
		(left, right) => left.position.start.line - right.position.start.line,
	);
}

export function matchesFilter(
	task: TaskItem,
	filter: TaskFilter,
	settings: VaultTasksSettings,
): boolean {
	switch (filter) {
		case "pending":
			return isPendingTaskStatus(task.statusSymbol, settings);
		case "completed":
			return isCompletedTaskStatus(task.statusSymbol, settings);
		default:
			return true;
	}
}

export function matchesSectionFilter(task: TaskItem, sectionFilter: SectionFilter): boolean {
	if (!sectionFilter) {
		return true;
	}

	if (sectionFilter.kind === "none") {
		return task.sectionHeading === null;
	}

	return task.sectionHeading === sectionFilter.heading;
}

export function isSameSectionFilter(left: SectionFilter, right: SectionFilter): boolean {
	if (left === right) {
		return true;
	}

	if (!left || !right || left.kind !== right.kind) {
		return false;
	}

	if (left.kind === "none") {
		return true;
	}

	if (right.kind === "none") {
		return false;
	}

	return left.heading === right.heading;
}

export function setTaskStatusSymbol(rawLine: string, statusSymbol: string): string | null {
	const match = rawLine.match(TASK_LINE_PATTERN);

	if (!match) {
		return null;
	}

	return `${match[1]}${statusSymbol}${match[3]}`;
}

export function getTaskStatusSymbol(rawLine: string): string | null {
	const match = rawLine.match(TASK_LINE_PATTERN);
	return match ? match[2] : null;
}

export function findTaskSection(taskLine: number, headings: HeadingCache[]): HeadingCache | null {
	let nearestHeading: HeadingCache | null = null;

	for (const heading of headings) {
		if (heading.position.start.line >= taskLine) {
			break;
		}

		nearestHeading = heading;
	}

	return nearestHeading;
}

export function updateSpecificTasksInEditor(
	editor: Editor,
	tasks: TaskItem[],
	statusSymbol: string,
	options?: { onlyUnchecked?: boolean },
): { updatedCount: number; updatedTasks: TaskItem[] } {
	const lines = collectEditorLines(editor);
	let updatedCount = 0;
	const updatedTasks: TaskItem[] = [];

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
		updatedTasks.push(task);
	}

	return {
		updatedCount,
		updatedTasks,
	};
}

export function updateTaskStatusInContent(
	content: string,
	task: TaskItem,
	statusSymbol: string,
): string {
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

export function updateSpecificTasksInContent(
	content: string,
	tasks: TaskItem[],
	statusSymbol: string,
	options?: { onlyUnchecked?: boolean },
): { content: string; updatedCount: number; updatedTasks: TaskItem[] } {
	const newline = content.includes("\r\n") ? "\r\n" : "\n";
	const lines = content.split(/\r?\n/);
	let updatedCount = 0;
	const updatedTasks: TaskItem[] = [];

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
		updatedTasks.push(task);
	}

	return {
		content: lines.join(newline),
		updatedCount,
		updatedTasks,
	};
}

export function isCheckboxCheckedStatus(statusSymbol: string): boolean {
	return statusSymbol !== TASK_STATUS_TODO;
}

export function isCompletedTaskStatus(
	statusSymbol: string,
	settings: VaultTasksSettings,
): boolean {
	return (
		statusSymbol === TASK_STATUS_DONE ||
		statusSymbol === "X" ||
		(settings.includeCancelledInCompleted && statusSymbol === TASK_STATUS_CANCELLED)
	);
}

export function isPendingTaskStatus(
	statusSymbol: string,
	settings: VaultTasksSettings,
): boolean {
	return (
		statusSymbol === TASK_STATUS_TODO ||
		(settings.pendingMode === "todo-and-in-progress" &&
			statusSymbol === TASK_STATUS_IN_PROGRESS)
	);
}

export function normalizeTaskStatusSymbol(statusSymbol: string | undefined): string {
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

export function normalizeSettings(value: unknown): VaultTasksSettings {
	const candidate = isObjectRecord(value) ? value : {};
	const defaultFilter = normalizeTaskFilterValue(candidate.defaultFilter);
	const persistSectionFilter = candidate.persistSectionFilter === true;

	return {
		defaultFilter,
		excludeFolders: normalizeFolderList(candidate.excludeFolders),
		includeCancelledInCompleted:
			typeof candidate.includeCancelledInCompleted === "boolean"
				? candidate.includeCancelledInCompleted
				: DEFAULT_SETTINGS.includeCancelledInCompleted,
		includeFolders: normalizeFolderList(candidate.includeFolders),
		openLocation: normalizeTaskViewLocationValue(candidate.openLocation),
		pendingMode: normalizePendingModeValue(candidate.pendingMode),
		persistSectionFilter,
		savedSectionFilter: persistSectionFilter
			? normalizeSectionFilter(candidate.savedSectionFilter)
			: null,
		sectionSort: normalizeSectionSortModeValue(candidate.sectionSort),
		showConnectionsByDefault:
			typeof candidate.showConnectionsByDefault === "boolean"
				? candidate.showConnectionsByDefault
				: DEFAULT_SETTINGS.showConnectionsByDefault,
		showSectionHeadings:
			typeof candidate.showSectionHeadings === "boolean"
				? candidate.showSectionHeadings
				: DEFAULT_SETTINGS.showSectionHeadings,
		statusMode: normalizeTaskStatusModeValue(candidate.statusMode),
		taskSort: normalizeTaskSortModeValue(candidate.taskSort),
		noteSort: normalizeNoteSortModeValue(candidate.noteSort),
	};
}

export function matchesFolderScope(path: string, settings: VaultTasksSettings): boolean {
	const normalizedPath = normalizePath(path);
	const hasIncludedFolder =
		settings.includeFolders.length === 0 ||
		settings.includeFolders.some((folder) => isPathInFolder(normalizedPath, folder));

	if (!hasIncludedFolder) {
		return false;
	}

	return !settings.excludeFolders.some((folder) => isPathInFolder(normalizedPath, folder));
}

export function isPathInFolder(path: string, folder: string): boolean {
	return path === folder || path.startsWith(`${folder}/`);
}

export function sortVisibleTaskGroups(
	visibleGroups: VisibleTaskGroup[],
	noteSort: NoteSortMode,
): void {
	visibleGroups.sort((left, right) => compareVisibleTaskGroups(left, right, noteSort));
}

export function compareVisibleTaskGroups(
	left: VisibleTaskGroup,
	right: VisibleTaskGroup,
	noteSort: NoteSortMode,
): number {
	switch (noteSort) {
		case "title-desc":
			return compareStrings(
				right.group.noteTitle,
				left.group.noteTitle,
				left.group.file.path,
				right.group.file.path,
			);
		case "path-asc":
			return compareStrings(
				left.group.file.path,
				right.group.file.path,
				left.group.noteTitle,
				right.group.noteTitle,
			);
		case "path-desc":
			return compareStrings(
				right.group.file.path,
				left.group.file.path,
				left.group.noteTitle,
				right.group.noteTitle,
			);
		case "task-count-desc":
			return (
				right.tasks.length - left.tasks.length ||
				compareStrings(
					left.group.noteTitle,
					right.group.noteTitle,
					left.group.file.path,
					right.group.file.path,
				)
			);
		case "task-count-asc":
			return (
				left.tasks.length - right.tasks.length ||
				compareStrings(
					left.group.noteTitle,
					right.group.noteTitle,
					left.group.file.path,
					right.group.file.path,
				)
			);
		case "title-asc":
		default:
			return compareStrings(
				left.group.noteTitle,
				right.group.noteTitle,
				left.group.file.path,
				right.group.file.path,
			);
	}
}

export function sortRenderSectionBuckets(
	sectionBuckets: RenderSectionBucket[],
	sectionSort: SectionSortMode,
): void {
	sectionBuckets.sort((left, right) => {
		if (left.heading === null && right.heading === null) {
			return left.line - right.line;
		}

		if (left.heading === null) {
			return -1;
		}

		if (right.heading === null) {
			return 1;
		}

		switch (sectionSort) {
			case "heading-asc":
				return compareStrings(left.heading, right.heading, String(left.line), String(right.line));
			case "heading-desc":
				return compareStrings(right.heading, left.heading, String(left.line), String(right.line));
			case "source":
			default:
				return left.line - right.line || left.heading.localeCompare(right.heading);
		}
	});
}

export function sortTasks(tasks: TaskItem[], taskSort: TaskSortMode): void {
	tasks.sort((left, right) => compareTasks(left, right, taskSort));
}

export function compareTasks(left: TaskItem, right: TaskItem, taskSort: TaskSortMode): number {
	switch (taskSort) {
		case "text-asc":
			return compareStrings(left.text, right.text, String(left.line), String(right.line));
		case "text-desc":
			return compareStrings(right.text, left.text, String(left.line), String(right.line));
		case "status-source":
			return (
				getTaskStatusSortRank(left.statusSymbol) - getTaskStatusSortRank(right.statusSymbol) ||
				left.line - right.line ||
				left.text.localeCompare(right.text)
			);
		case "source":
		default:
			return left.line - right.line || left.text.localeCompare(right.text);
	}
}

export function getTaskStatusSortRank(statusSymbol: string): number {
	switch (statusSymbol) {
		case TASK_STATUS_TODO:
			return 0;
		case TASK_STATUS_IN_PROGRESS:
			return 1;
		case TASK_STATUS_DEFERRED:
			return 2;
		case TASK_STATUS_DONE:
		case "X":
			return 3;
		case TASK_STATUS_CANCELLED:
			return 4;
		default:
			return 5;
	}
}

export function compareStrings(
	left: string,
	right: string,
	leftFallback: string,
	rightFallback: string,
): number {
	return left.localeCompare(right) || leftFallback.localeCompare(rightFallback);
}

export function normalizeSectionFilter(value: unknown): SectionFilter {
	if (!isObjectRecord(value) || typeof value.kind !== "string") {
		return null;
	}

	if (value.kind === "none") {
		return { kind: "none" };
	}

	if (value.kind === "heading" && typeof value.heading === "string" && value.heading.trim().length > 0) {
		return {
			kind: "heading",
			heading: value.heading.trim(),
		};
	}

	return null;
}

export function normalizeFolderList(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return Array.from(
		new Set(
			value
				.filter((entry): entry is string => typeof entry === "string")
				.map((entry) => normalizeFolderPath(entry))
				.filter((entry) => entry.length > 0),
		),
	);
}

export function parseFolderListInput(value: string): string[] {
	return normalizeFolderList(
		value
			.split(/\r?\n|,/)
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0),
	);
}

export function formatFolderList(folders: string[]): string {
	return folders.join("\n");
}

export function normalizeFolderPath(path: string): string {
	let normalizedPath = normalizePath(path.trim());
	while (normalizedPath.endsWith("/")) {
		normalizedPath = normalizedPath.slice(0, -1);
	}

	return normalizedPath === "." ? "" : normalizedPath;
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function formatDate(date: Date): string {
	const year = String(date.getFullYear());
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function normalizeDeferredUntil(value: string | null): string | null {
	const unquotedValue = unquoteFrontmatterValue(value);

	return DATE_PATTERN.test(unquotedValue) ? unquotedValue : null;
}

export function extractFrontmatterValue(content: string, key: string): string | null {
	const frontmatterMatch = content.match(FRONTMATTER_PATTERN);
	if (!frontmatterMatch) {
		return null;
	}

	const frontmatter = frontmatterMatch[1];
	const valueMatch = frontmatter.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
	return valueMatch ? valueMatch[1] : null;
}

export function normalizeFrontmatterBoolean(value: unknown): boolean | null {
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

export function unquoteFrontmatterValue(value: string | null): string {
	if (value === null) {
		return "";
	}

	const trimmedValue = value.trim();
	return (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
		(trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))
		? trimmedValue.slice(1, -1)
		: trimmedValue;
}

function normalizeTaskFilterValue(value: unknown): TaskFilter {
	return value === "all" || value === "completed" || value === "pending"
		? value
		: DEFAULT_SETTINGS.defaultFilter;
}

function normalizeTaskViewLocationValue(value: unknown): VaultTasksSettings["openLocation"] {
	return value === "sidebar" || value === "main" ? value : DEFAULT_SETTINGS.openLocation;
}

function normalizeTaskStatusModeValue(value: unknown): VaultTasksSettings["statusMode"] {
	return value === "standard" || value === "extended" ? value : DEFAULT_SETTINGS.statusMode;
}

function normalizePendingModeValue(value: unknown): VaultTasksSettings["pendingMode"] {
	return value === "todo-only" || value === "todo-and-in-progress"
		? value
		: DEFAULT_SETTINGS.pendingMode;
}

function normalizeNoteSortModeValue(value: unknown): VaultTasksSettings["noteSort"] {
	switch (value) {
		case "title-asc":
		case "title-desc":
		case "path-asc":
		case "path-desc":
		case "task-count-desc":
		case "task-count-asc":
			return value;
		default:
			return DEFAULT_SETTINGS.noteSort;
	}
}

function normalizeSectionSortModeValue(value: unknown): VaultTasksSettings["sectionSort"] {
	return value === "source" || value === "heading-asc" || value === "heading-desc"
		? value
		: DEFAULT_SETTINGS.sectionSort;
}

function normalizeTaskSortModeValue(value: unknown): VaultTasksSettings["taskSort"] {
	return value === "source" ||
		value === "text-asc" ||
		value === "text-desc" ||
		value === "status-source"
		? value
		: DEFAULT_SETTINGS.taskSort;
}
