import test from "node:test";
import assert from "node:assert/strict";
import {
	extractDeferredUntil,
	extractFrontmatterValue,
	extractHiddenFromTaskList,
	normalizeDeferredUntil,
	normalizeFrontmatterBoolean,
} from "../src/lib/frontmatter";

test("extracts deferred-until from current and legacy keys", () => {
	const current = `---\ndeferred-until: 2026-04-10\n---\n`;
	const legacy = `---\ndeffered-until: 2026-04-11\n---\n`;

	assert.equal(extractDeferredUntil(current), "2026-04-10");
	assert.equal(extractDeferredUntil(legacy), "2026-04-11");
});

test("normalizes quoted deferred dates", () => {
	assert.equal(normalizeDeferredUntil('"2026-04-12"'), "2026-04-12");
	assert.equal(normalizeDeferredUntil("'2026-04-12'"), "2026-04-12");
	assert.equal(normalizeDeferredUntil("tomorrow"), null);
});

test("extracts and normalizes boolean frontmatter flags", () => {
	const content = `---\nhide-from-vault-tasks: yes\n---\n`;

	assert.equal(extractHiddenFromTaskList(content), true);
	assert.equal(extractFrontmatterValue(content, "hide-from-vault-tasks"), "yes");
	assert.equal(normalizeFrontmatterBoolean("off"), false);
});
