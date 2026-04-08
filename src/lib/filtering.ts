import {
	TASK_STATUS_CANCELLED,
	TASK_STATUS_DONE,
	TASK_STATUS_IN_PROGRESS,
	TASK_STATUS_TODO,
} from "../config";
import { filterDescription } from "../config";
import type { SectionFilter, TaskFilter, TaskItem, VaultTasksSettings } from "../types";

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
