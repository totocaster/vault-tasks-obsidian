import {
	type CachedMetadata,
	type Editor,
	type HeadingCache,
	type ListItemCache,
	type TFile,
} from "obsidian";
import {
	DATE_PATTERN,
	HIDDEN_FROM_TASKS_KEY,
	TASK_LINE_PATTERN,
	TASK_STATUS_CANCELLED,
	TASK_STATUS_DEFERRED,
	TASK_STATUS_DONE,
	TASK_STATUS_IN_PROGRESS,
	TASK_STATUS_TODO,
	TASK_TEXT_PATTERN,
} from "./config";
import { normalizeFrontmatterBoolean } from "./lib/frontmatter";
import {
	buildEmptyStateMessage,
	matchesFilter,
	matchesSectionFilter,
} from "./lib/filtering";
import {
	sortRenderSectionBuckets,
	sortTasks,
	sortVisibleTaskGroups,
} from "./lib/sorting";
import type {
	RenderSectionBucket,
	TaskGroup,
	TaskItem,
	TaskSectionGroup,
	TaskSnapshot,
	VisibleTaskGroup,
} from "./types";

type VaultTasksMetadataCache = {
	fileToLinktext: (file: TFile, sourcePath: string, omitMdExtension?: boolean) => string;
};

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

	sortVisibleTaskGroups(
		visibleGroups,
		snapshot.settings.noteSort,
		snapshot.settings.pinnedNotePaths,
	);

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

		currentBucket?.tasks.push(task);
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

export function setTaskStatusSymbol(rawLine: string, statusSymbol: string): string | null {
	const match = rawLine.match(TASK_LINE_PATTERN);

	if (!match) {
		return null;
	}

	return `${match[1]}${statusSymbol}${match[3]}`;
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

function escapeWikiLinkText(text: string): string {
	return text.replace(/([\\[\]|])/g, "\\$1");
}

function extractTaskText(rawLine: string): string | null {
	const match = rawLine.match(TASK_TEXT_PATTERN);
	return match ? match[1] : null;
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

function formatDate(date: Date): string {
	const year = String(date.getFullYear());
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}
