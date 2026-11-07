import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
	return import("./file-paths.ts");
}

test("builds file API urls with encoded paths", async () => {
	const { getFileApiUrl } = await loadSubject();

	assert.equal(getFileApiUrl("C:\\work\\a b.png", "read"), "/api/files/C%3A/work/a%20b.png?type=read");
	assert.equal(getFileApiUrl("/work/x.png", "download"), "/api/files/work/x.png?type=download");
});

test("adds the session id only when one is given", async () => {
	const { getFileApiUrl } = await loadSubject();

	assert.equal(getFileApiUrl("/work/x.png", "read", "s-1"), "/api/files/work/x.png?type=read&sessionId=s-1");
	assert.equal(getFileApiUrl("/work/x.png", "read", null), "/api/files/work/x.png?type=read");
});

test("passes extra query parameters through", async () => {
	const { getFileApiUrl } = await loadSubject();

	assert.equal(
		getFileApiUrl("/work", "upload", undefined, { conflict: "rename" }),
		"/api/files/work?type=upload&conflict=rename",
	);
});
