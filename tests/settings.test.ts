import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../src/config";
import {
	formatFolderList,
	matchesFolderScope,
	normalizeFolderList,
	normalizeSettings,
	parseFolderListInput,
} from "../src/lib/settings";

test("normalizes settings with defaults and persisted section filter", () => {
	const settings = normalizeSettings({
		defaultFilter: "all",
		pinnedNotePaths: ["Inbox.md", "./Projects/Alpha.md", "Inbox.md"],
		persistSectionFilter: true,
		savedSectionFilter: { kind: "heading", heading: "Work" },
		showConnectionsByDefault: true,
	});

	assert.equal(settings.defaultFilter, "all");
	assert.deepEqual(settings.pinnedNotePaths, ["Inbox.md", "Projects/Alpha.md"]);
	assert.equal(settings.persistSectionFilter, true);
	assert.deepEqual(settings.savedSectionFilter, { kind: "heading", heading: "Work" });
	assert.equal(settings.showConnectionsByDefault, true);
	assert.equal(settings.taskSort, DEFAULT_SETTINGS.taskSort);
});

test("parses and formats folder lists", () => {
	const folders = parseFolderListInput("Projects\nInbox,\n./Areas/");

	assert.deepEqual(folders, ["Projects", "Inbox", "Areas"]);
	assert.equal(formatFolderList(folders), "Projects\nInbox\nAreas");
	assert.deepEqual(normalizeFolderList(["Projects/", "Projects", "Areas"]), ["Projects", "Areas"]);
});

test("matches include and exclude folder scope", () => {
	const settings = {
		...DEFAULT_SETTINGS,
		includeFolders: ["Projects"],
		excludeFolders: ["Projects/Archive"],
	};

	assert.equal(matchesFolderScope("Projects/Active/Task.md", settings), true);
	assert.equal(matchesFolderScope("Projects/Archive/Task.md", settings), false);
	assert.equal(matchesFolderScope("Inbox/Task.md", settings), false);
});
