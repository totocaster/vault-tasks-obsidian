import {
	DATE_PATTERN,
	DEFERRED_UNTIL_KEY,
	FRONTMATTER_PATTERN,
	HIDDEN_FROM_TASKS_KEY,
	LEGACY_DEFERRED_UNTIL_KEY,
} from "../config";

export function extractDeferredUntil(content: string): string | null {
	return normalizeDeferredUntil(
		extractFrontmatterValue(content, DEFERRED_UNTIL_KEY) ??
			extractFrontmatterValue(content, LEGACY_DEFERRED_UNTIL_KEY),
	);
}

export function extractHiddenFromTaskList(content: string): boolean {
	return normalizeFrontmatterBoolean(extractFrontmatterValue(content, HIDDEN_FROM_TASKS_KEY)) ?? false;
}

export function normalizeDeferredUntil(value: string | null): string | null {
	const unquotedValue = unquoteFrontmatterValue(value);

	return DATE_PATTERN.test(unquotedValue) ? unquotedValue : null;
}

export function extractFrontmatterValue(content: string, key: string): string | null {
	const frontmatterMatch = content.match(FRONTMATTER_PATTERN);
	if (!frontmatterMatch) {
		return null;
	}

	const frontmatter = frontmatterMatch[1];
	const valueMatch = frontmatter.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
	return valueMatch ? valueMatch[1] : null;
}

export function normalizeFrontmatterBoolean(value: unknown): boolean | null {
	if (typeof value === "boolean") {
		return value;
	}

	if (typeof value !== "string") {
		return null;
	}

	switch (unquoteFrontmatterValue(value).toLowerCase()) {
		case "true":
		case "yes":
		case "on":
			return true;
		case "false":
		case "no":
		case "off":
			return false;
		default:
			return null;
	}
}

function unquoteFrontmatterValue(value: string | null): string {
	if (value === null) {
		return "";
	}

	const trimmedValue = value.trim();
	return (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
		(trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))
		? trimmedValue.slice(1, -1)
		: trimmedValue;
}
