import test from "node:test";
import assert from "node:assert/strict";
import {
	TASK_STATUS_DONE,
	TASK_STATUS_IN_PROGRESS,
	TASK_STATUS_TODO,
} from "../src/config";
import {
	sortRenderSectionBuckets,
	sortTasks,
	sortVisibleTaskGroups,
} from "../src/lib/sorting";
import type { RenderSectionBucket, TaskItem, VisibleTaskGroup } from "../src/types";

function makeTask(
	line: number,
	text: string,
	statusSymbol = TASK_STATUS_TODO,
): TaskItem {
	return {
		file: { path: "Note.md", basename: "Note" } as TaskItem["file"],
		key: `Note.md:${line}`,
		line,
		rawLine: `- [ ] ${text}`,
		renderedLine: `- [ ] ${text}`,
		sectionHeading: null,
		sectionLine: null,
		statusSymbol,
		text,
	};
}

test("sorts visible groups by visible task count", () => {
	const groups: VisibleTaskGroup[] = [
		{
			group: { file: { path: "A.md", basename: "A" } as TaskItem["file"], noteTitle: "A", deferredUntil: null, hiddenFromTaskList: false, tasks: [] },
			tasks: [makeTask(1, "one")],
		},
		{
			group: { file: { path: "B.md", basename: "B" } as TaskItem["file"], noteTitle: "B", deferredUntil: null, hiddenFromTaskList: false, tasks: [] },
			tasks: [makeTask(1, "one"), makeTask(2, "two")],
		},
	];

	sortVisibleTaskGroups(groups, "task-count-desc");
	assert.deepEqual(groups.map((group) => group.group.noteTitle), ["B", "A"]);
});

test("sorts section buckets alphabetically", () => {
	const buckets: RenderSectionBucket[] = [
		{ heading: "Work", line: 10, tasks: [makeTask(10, "a")] },
		{ heading: "Archive", line: 20, tasks: [makeTask(20, "b")] },
	];

	sortRenderSectionBuckets(buckets, "heading-asc");
	assert.deepEqual(buckets.map((bucket) => bucket.heading), ["Archive", "Work"]);
});

test("sorts tasks by status then source order", () => {
	const tasks = [
		makeTask(3, "done", TASK_STATUS_DONE),
		makeTask(2, "in progress", TASK_STATUS_IN_PROGRESS),
		makeTask(1, "todo", TASK_STATUS_TODO),
	];

	sortTasks(tasks, "status-source");
	assert.deepEqual(tasks.map((task) => task.line), [1, 2, 3]);
});
