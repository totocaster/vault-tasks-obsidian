import test from "node:test";
import assert from "node:assert/strict";
import {
	TASK_STATUS_CANCELLED,
	TASK_STATUS_DONE,
	TASK_STATUS_IN_PROGRESS,
	TASK_STATUS_TODO,
} from "../src/config";
import { DEFAULT_SETTINGS } from "../src/config";
import {
	buildEmptyStateMessage,
	isCompletedTaskStatus,
	isPendingTaskStatus,
	matchesFilter,
	matchesSectionFilter,
} from "../src/lib/filtering";
import type { TaskItem } from "../src/types";

function makeTask(overrides: Partial<TaskItem>): TaskItem {
	return {
		file: { path: "Note.md", basename: "Note" } as TaskItem["file"],
		key: "Note.md:1",
		line: 1,
		rawLine: "- [ ] task",
		renderedLine: "- [ ] task",
		sectionHeading: null,
		sectionLine: null,
		statusSymbol: TASK_STATUS_TODO,
		text: "task",
		...overrides,
	};
}

test("pending mode can include or exclude in-progress tasks", () => {
	assert.equal(
		isPendingTaskStatus(TASK_STATUS_IN_PROGRESS, {
			...DEFAULT_SETTINGS,
			pendingMode: "todo-and-in-progress",
		}),
		true,
	);
	assert.equal(
		isPendingTaskStatus(TASK_STATUS_IN_PROGRESS, {
			...DEFAULT_SETTINGS,
			pendingMode: "todo-only",
		}),
		false,
	);
});

test("completed mode can include or exclude cancelled tasks", () => {
	assert.equal(
		isCompletedTaskStatus(TASK_STATUS_CANCELLED, {
			...DEFAULT_SETTINGS,
			includeCancelledInCompleted: true,
		}),
		true,
	);
	assert.equal(
		isCompletedTaskStatus(TASK_STATUS_CANCELLED, {
			...DEFAULT_SETTINGS,
			includeCancelledInCompleted: false,
		}),
		false,
	);
	assert.equal(isCompletedTaskStatus(TASK_STATUS_DONE, DEFAULT_SETTINGS), true);
});

test("matches task and section filters together", () => {
	const task = makeTask({
		sectionHeading: "Work",
		sectionLine: 10,
		statusSymbol: TASK_STATUS_TODO,
	});

	assert.equal(matchesFilter(task, "pending", DEFAULT_SETTINGS), true);
	assert.equal(matchesFilter(task, "completed", DEFAULT_SETTINGS), false);
	assert.equal(matchesSectionFilter(task, { kind: "heading", heading: "Work" }), true);
	assert.equal(matchesSectionFilter(task, { kind: "none" }), false);
});

test("builds contextual empty state messages", () => {
	assert.equal(buildEmptyStateMessage("pending", null), "No pending tasks.");
	assert.equal(
		buildEmptyStateMessage("all", { kind: "heading", heading: "Work" }),
		"No tasks in Work.",
	);
});
