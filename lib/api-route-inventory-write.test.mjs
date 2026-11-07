import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const APP_API_DIR = fileURLToPath(new URL("../app/api", import.meta.url));
const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

/**
 * Sanity floor for the scanner: it must keep finding at least every write
 * handler the API exposes, so a broken matcher cannot turn this test green.
 */
const MIN_WRITE_HANDLERS = 31;

function listRouteFiles(dir) {
	const files = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const absolute = path.join(dir, entry.name);
		if (entry.isDirectory()) files.push(...listRouteFiles(absolute));
		else if (entry.name === "route.ts") files.push(absolute);
	}
	return files;
}

function relativeRouteFile(file) {
	return path.relative(APP_API_DIR, file).split(path.sep).join("/");
}

function routeTemplate(relative) {
	return `/api/${relative.replace(/\/route\.ts$/, "")}`;
}

/** Handler names a route file exports for a write method, wrapped or not. */
function exportedWriteHandlers(source) {
	const found = new Set();
	const declarations = /\bexport\s+(?:async\s+)?(?:function|const|let|var)\s+(POST|PUT|PATCH|DELETE)\b/g;
	for (const match of source.matchAll(declarations)) found.add(match[1]);
	for (const match of source.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
		for (const specifier of match[1].split(",")) {
			const name = specifier
				.trim()
				.split(/\s+as\s+/)
				.pop()
				?.trim();
			if (name && WRITE_METHODS.includes(name)) found.add(name);
		}
	}
	return [...found].sort();
}

/** Route template passed to `withRequestLog`, or undefined when not wrapped. */
function wrappedRouteTemplate(source, method) {
	const pattern = new RegExp(
		`\\bexport\\s+const\\s+${method}\\s*(?::[^=]+)?=\\s*withRequestLog\\(\\s*(["'\`])([^"'\`]+)\\1`,
	);
	return source.match(pattern)?.[2];
}

const routeFiles = listRouteFiles(APP_API_DIR).map((file) => ({
	relative: relativeRouteFile(file),
	source: fs.readFileSync(file, "utf8"),
}));

const writeRoutes = routeFiles
	.map(({ relative, source }) => ({ relative, methods: exportedWriteHandlers(source) }))
	.filter(({ methods }) => methods.length > 0);

test("the write inventory discovers every write handler under app/api", () => {
	const total = writeRoutes.reduce((count, { methods }) => count + methods.length, 0);
	assert.ok(total >= MIN_WRITE_HANDLERS, `expected at least ${MIN_WRITE_HANDLERS} write handlers, found ${total}`);

	const files = new Set(writeRoutes.map(({ relative }) => relative));
	assert.ok(files.has("sessions/[id]/route.ts"), "nested route files must be discovered");
	assert.ok(files.has("files/[...path]/route.ts"), "catch-all route files must be discovered");
});

test("every write handler is exported through withRequestLog with its route template", () => {
	const sources = new Map(routeFiles.map(({ relative, source }) => [relative, source]));
	for (const { relative, methods } of writeRoutes) {
		const source = sources.get(relative);
		const expectedTemplate = routeTemplate(relative);
		for (const method of methods) {
			assert.equal(
				wrappedRouteTemplate(source, method),
				expectedTemplate,
				`${relative}: ${method} must be exported as withRequestLog("${expectedTemplate}", ...)`,
			);
		}
	}
});
