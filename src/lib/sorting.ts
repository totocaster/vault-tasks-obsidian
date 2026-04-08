import {
	TASK_STATUS_CANCELLED,
	TASK_STATUS_DEFERRED,
	TASK_STATUS_DONE,
	TASK_STATUS_IN_PROGRESS,
	TASK_STATUS_TODO,
} from "../config";
import type {
	NoteSortMode,
	RenderSectionBucket,
	SectionSortMode,
	TaskItem,
	TaskSortMode,
	VisibleTaskGroup,
} from "../types";

export function sortVisibleTaskGroups(
	visibleGroups: VisibleTaskGroup[],
	noteSort: NoteSortMode,
	pinnedNotePaths: string[] = [],
): void {
	visibleGroups.sort((left, right) =>
		compareVisibleTaskGroups(left, right, noteSort, pinnedNotePaths),
	);
}

function compareVisibleTaskGroups(
	left: VisibleTaskGroup,
	right: VisibleTaskGroup,
	noteSort: NoteSortMode,
	pinnedNotePaths: string[] = [],
): number {
	const leftPinnedIndex = getPinnedNoteIndex(left.group.file.path, pinnedNotePaths);
	const rightPinnedIndex = getPinnedNoteIndex(right.group.file.path, pinnedNotePaths);

	if (leftPinnedIndex !== -1 || rightPinnedIndex !== -1) {
		if (leftPinnedIndex === -1) {
			return 1;
		}

		if (rightPinnedIndex === -1) {
			return -1;
		}

		return leftPinnedIndex - rightPinnedIndex;
	}

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

function getPinnedNoteIndex(path: string, pinnedNotePaths: string[]): number {
	return pinnedNotePaths.indexOf(path);
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

function compareTasks(left: TaskItem, right: TaskItem, taskSort: TaskSortMode): number {
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

function getTaskStatusSortRank(statusSymbol: string): number {
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

function compareStrings(
	left: string,
	right: string,
	leftFallback: string,
	rightFallback: string,
): number {
	return left.localeCompare(right) || leftFallback.localeCompare(rightFallback);
}
