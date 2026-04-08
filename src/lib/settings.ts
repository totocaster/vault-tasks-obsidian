import { DEFAULT_SETTINGS } from "../config";
import type { SectionFilter, TaskFilter, VaultTasksSettings } from "../types";

export function normalizeSettings(value: unknown): VaultTasksSettings {
	const candidate = isObjectRecord(value) ? value : {};
	const defaultFilter = normalizeTaskFilter(candidate.defaultFilter);
	const persistSectionFilter = candidate.persistSectionFilter === true;

	return {
		defaultFilter,
		excludeFolders: normalizeFolderList(candidate.excludeFolders),
		includeCancelledInCompleted:
			typeof candidate.includeCancelledInCompleted === "boolean"
				? candidate.includeCancelledInCompleted
				: DEFAULT_SETTINGS.includeCancelledInCompleted,
		includeFolders: normalizeFolderList(candidate.includeFolders),
		openLocation: normalizeTaskViewLocation(candidate.openLocation),
		pendingMode: normalizePendingMode(candidate.pendingMode),
		pinnedNotePaths: normalizeNotePathList(candidate.pinnedNotePaths),
		persistSectionFilter,
		savedSectionFilter: persistSectionFilter
			? normalizeSectionFilter(candidate.savedSectionFilter)
			: null,
		sectionSort: normalizeSectionSortMode(candidate.sectionSort),
		showConnectionsByDefault:
			typeof candidate.showConnectionsByDefault === "boolean"
				? candidate.showConnectionsByDefault
				: DEFAULT_SETTINGS.showConnectionsByDefault,
		showSectionHeadings:
			typeof candidate.showSectionHeadings === "boolean"
				? candidate.showSectionHeadings
				: DEFAULT_SETTINGS.showSectionHeadings,
		statusMode: normalizeTaskStatusMode(candidate.statusMode),
		taskSort: normalizeTaskSortMode(candidate.taskSort),
		noteSort: normalizeNoteSortMode(candidate.noteSort),
	};
}

export function matchesFolderScope(path: string, settings: VaultTasksSettings): boolean {
	const normalizedPath = normalizeFolderPath(path);
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

export function normalizeTaskFilter(value: unknown): TaskFilter {
	return value === "all" || value === "completed" || value === "pending"
		? value
		: DEFAULT_SETTINGS.defaultFilter;
}

export function normalizeTaskViewLocation(
	value: unknown,
): VaultTasksSettings["openLocation"] {
	return value === "sidebar" || value === "main" ? value : DEFAULT_SETTINGS.openLocation;
}

export function normalizeTaskStatusMode(
	value: unknown,
): VaultTasksSettings["statusMode"] {
	return value === "standard" || value === "extended" ? value : DEFAULT_SETTINGS.statusMode;
}

export function normalizePendingMode(value: unknown): VaultTasksSettings["pendingMode"] {
	return value === "todo-only" || value === "todo-and-in-progress"
		? value
		: DEFAULT_SETTINGS.pendingMode;
}

export function normalizeNoteSortMode(value: unknown): VaultTasksSettings["noteSort"] {
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

export function normalizeSectionSortMode(value: unknown): VaultTasksSettings["sectionSort"] {
	return value === "source" || value === "heading-asc" || value === "heading-desc"
		? value
		: DEFAULT_SETTINGS.sectionSort;
}

export function normalizeTaskSortMode(value: unknown): VaultTasksSettings["taskSort"] {
	return value === "source" ||
		value === "text-asc" ||
		value === "text-desc" ||
		value === "status-source"
		? value
		: DEFAULT_SETTINGS.taskSort;
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

export function normalizeNotePathList(value: unknown): string[] {
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
	return path
		.replace(/\\/g, "/")
		.trim()
		.replace(/^\.\/+/, "")
		.replace(/\/+/g, "/")
		.replace(/\/$/, "");
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
