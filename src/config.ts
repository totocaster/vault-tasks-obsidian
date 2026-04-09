import type {
	NoteSortMode,
	SectionSortMode,
	TaskFilter,
	TaskSortMode,
	VaultTasksSettings,
} from "./types";

export const VIEW_TYPE_TASKS = "vault-tasks-view";
export const VIEW_TITLE = "Vault tasks";
export const DEFERRED_UNTIL_KEY = "deferred-until";
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
