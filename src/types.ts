import type { TFile } from "obsidian";

export type TaskFilter = "all" | "pending" | "completed";
export type TaskViewLocation = "main" | "sidebar";
export type TaskStatusMode = "standard" | "extended";
export type PendingMode = "todo-only" | "todo-and-in-progress";
export type NoteSortMode =
	| "title-asc"
	| "title-desc"
	| "path-asc"
	| "path-desc"
	| "task-count-desc"
	| "task-count-asc";
export type SectionSortMode = "source" | "heading-asc" | "heading-desc";
export type TaskSortMode = "source" | "text-asc" | "text-desc" | "status-source";
export type SectionFilter = { kind: "heading"; heading: string } | { kind: "none" } | null;

export interface VaultTasksSettings {
	defaultFilter: TaskFilter;
	excludeFolders: string[];
	includeCancelledInCompleted: boolean;
	includeFolders: string[];
	openLocation: TaskViewLocation;
	pendingMode: PendingMode;
	persistSectionFilter: boolean;
	savedSectionFilter: SectionFilter;
	sectionSort: SectionSortMode;
	showConnectionsByDefault: boolean;
	showSectionHeadings: boolean;
	statusMode: TaskStatusMode;
	taskSort: TaskSortMode;
	noteSort: NoteSortMode;
}

export interface TaskItem {
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

export interface TaskGroup {
	deferredUntil: string | null;
	file: TFile;
	hiddenFromTaskList: boolean;
	noteTitle: string;
	tasks: TaskItem[];
}

export interface TaskSectionGroup {
	file: TFile;
	heading: string;
	line: number;
	tasks: TaskItem[];
}

export interface TaskSnapshot {
	error: string | null;
	filter: TaskFilter;
	groups: TaskGroup[];
	refreshing: boolean;
	sectionFilter: SectionFilter;
	settings: VaultTasksSettings;
	showConnections: boolean;
}

export interface VisibleTaskGroup {
	group: TaskGroup;
	tasks: TaskItem[];
}

export interface AvailableSectionFilters {
	hasNoSection: boolean;
	headings: string[];
}

export interface RenderSectionBucket {
	heading: string | null;
	line: number;
	tasks: TaskItem[];
}

export interface ViewScrollAnchor {
	key: string;
	offset: number;
	type: "group" | "section" | "task";
}

export interface ViewScrollState {
	fallbackAnchor: ViewScrollAnchor | null;
	primaryAnchor: ViewScrollAnchor | null;
	scrollTop: number;
}
