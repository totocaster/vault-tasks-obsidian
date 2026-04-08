import type {
	NoteSortMode,
	PendingMode,
	SectionSortMode,
	TaskFilter,
	TaskSortMode,
	TaskStatusMode,
	TaskViewLocation,
	VaultTasksSettings,
} from "./types";

export const VIEW_TYPE_TASKS = "vault-tasks-view";
export const VIEW_TITLE = "Vault tasks";
export const DEFERRED_UNTIL_KEY = "deferred-until";
export const LEGACY_DEFERRED_UNTIL_KEY = "deffered-until";
export const HIDDEN_FROM_TASKS_KEY = "hide-from-vault-tasks";
export const TASK_STATUS_CANCELLED = "-";
export const TASK_STATUS_DEFERRED = ">";
export const TASK_STATUS_DONE = "x";
export const TASK_STATUS_IN_PROGRESS = "/";
export const TASK_STATUS_TODO = " ";
export const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
export const TASK_LINE_PATTERN = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\].*)$/;
export const TASK_TEXT_PATTERN = /^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s?(.*)$/;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const DEFAULT_SETTINGS: VaultTasksSettings = {
	defaultFilter: "pending",
	excludeFolders: [],
	includeCancelledInCompleted: true,
	includeFolders: [],
	openLocation: "main",
	pendingMode: "todo-and-in-progress",
	pinnedNotePaths: [],
	persistSectionFilter: false,
	savedSectionFilter: null,
	sectionSort: "source",
	showConnectionsByDefault: false,
	showSectionHeadings: true,
	statusMode: "extended",
	taskSort: "source",
	noteSort: "title-asc",
};

export const NOTE_SORT_LABELS: Record<NoteSortMode, string> = {
	"title-asc": "Title (A-Z)",
	"title-desc": "Title (Z-A)",
	"path-asc": "Path (A-Z)",
	"path-desc": "Path (Z-A)",
	"task-count-desc": "Visible task count (high-low)",
	"task-count-asc": "Visible task count (low-high)",
};

export const SECTION_SORT_LABELS: Record<SectionSortMode, string> = {
	source: "Source order",
	"heading-asc": "Heading (A-Z)",
	"heading-desc": "Heading (Z-A)",
};

export const TASK_SORT_LABELS: Record<TaskSortMode, string> = {
	source: "Source order",
	"text-asc": "Task text (A-Z)",
	"text-desc": "Task text (Z-A)",
	"status-source": "Status, then source order",
};

export function filterLabel(filter: TaskFilter): string {
	switch (filter) {
		case "pending":
			return "Pending";
		case "completed":
			return "Completed";
		default:
			return "All";
	}
}

export function filterIcon(filter: TaskFilter): "list" | "circle" | "check" {
	switch (filter) {
		case "pending":
			return "circle";
		case "completed":
			return "check";
		default:
			return "list";
	}
}

export function filterDescription(filter: TaskFilter): string {
	switch (filter) {
		case "pending":
			return "pending";
		case "completed":
			return "completed";
		default:
			return "all";
	}
}

export function normalizeTaskFilter(value: unknown): TaskFilter {
	return value === "all" || value === "completed" || value === "pending"
		? value
		: DEFAULT_SETTINGS.defaultFilter;
}

export function normalizeTaskViewLocation(value: unknown): TaskViewLocation {
	return value === "sidebar" || value === "main" ? value : DEFAULT_SETTINGS.openLocation;
}

export function normalizeTaskStatusMode(value: unknown): TaskStatusMode {
	return value === "standard" || value === "extended" ? value : DEFAULT_SETTINGS.statusMode;
}

export function normalizePendingMode(value: unknown): PendingMode {
	return value === "todo-only" || value === "todo-and-in-progress"
		? value
		: DEFAULT_SETTINGS.pendingMode;
}

export function normalizeNoteSortMode(value: unknown): NoteSortMode {
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

export function normalizeSectionSortMode(value: unknown): SectionSortMode {
	return value === "source" || value === "heading-asc" || value === "heading-desc"
		? value
		: DEFAULT_SETTINGS.sectionSort;
}

export function normalizeTaskSortMode(value: unknown): TaskSortMode {
	return value === "source" ||
		value === "text-asc" ||
		value === "text-desc" ||
		value === "status-source"
		? value
		: DEFAULT_SETTINGS.taskSort;
}
