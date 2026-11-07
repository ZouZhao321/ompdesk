import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { configureLogging, flushLogs } = await import("./logging.ts");
const { withRequestLog } = await import("./api-request-log.ts");

function createTempDir(t, prefix) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	return dir;
}

async function useTempTransport(t) {
	const dir = createTempDir(t, "ompdesk-write-log-");
	await configureLogging({ file: dir, stdout: false, env: { NODE_ENV: "production" } });
	return dir;
}

function readRecords(dir) {
	const records = [];
	for (const name of fs.readdirSync(dir)) {
		const text = fs.readFileSync(path.join(dir, name), "utf8");
		for (const line of text.split(/\r?\n/)) {
			if (line.trim()) records.push(JSON.parse(line));
		}
	}
	return records;
}

function writeRecords(dir) {
	return readRecords(dir).filter((entry) => entry.message === "http.request" && entry.method === "POST");
}

function writeRequest({ requestId, url, contentType = "application/json", body = '{"value":1}' }) {
	return new Request(url, {
		method: "POST",
		headers: {
			host: "localhost:30141",
			"content-type": contentType,
			"x-ompdesk-request-id": requestId,
		},
		body,
	});
}

test("records every write status and leaves the response untouched", async (t) => {
	const dir = await useTempTransport(t);
	const statuses = [200, 400, 409, 415, 500];
	let bodyUsedOnEntry;

	for (const status of statuses) {
		const handler = withRequestLog("/api/skills", async (request) => {
			bodyUsedOnEntry = request.bodyUsed;
			const payload = await request.json();
			return Response.json(
				{ status, received: payload },
				{
					status,
					headers: { "X-Write-Route": "skills" },
				},
			);
		});

		const response = await handler(
			writeRequest({
				requestId: `req-write-${status}`,
				url: "http://localhost:30141/api/skills",
			}),
		);

		assert.equal(bodyUsedOnEntry, false, "the wrapper must not read the request body");
		assert.equal(response.status, status);
		assert.equal(response.headers.get("x-write-route"), "skills");
		assert.deepEqual(await response.json(), { status, received: { value: 1 } });
	}
	flushLogs();

	const records = writeRecords(dir);
	assert.deepEqual(
		records.map((record) => record.status),
		statuses,
	);
	const levels = records.map((record) => record.level);
	assert.deepEqual(levels, ["info", "warn", "warn", "warn", "error"]);

	for (const [index, record] of records.entries()) {
		assert.equal(record.requestId, `req-write-${statuses[index]}`);
		assert.equal(record.route, "/api/skills");
		assert.equal(record.method, "POST");
		assert.equal(record.subsystem, "http");
		assert.equal(record.source, "ompdesk");
		assert.equal(record.slow, false);
		assert.equal(typeof record.durationMs, "number");
		assert.ok(record.durationMs >= 0);
	}
});

test("records a thrown write handler as 500 and rethrows the original error", async (t) => {
	const dir = await useTempTransport(t);
	const failure = new Error("write exploded");
	const handler = withRequestLog("/api/settings", () => {
		throw failure;
	});

	await assert.rejects(
		handler(writeRequest({ requestId: "req-write-throw", url: "http://localhost:30141/api/settings" })),
		(error) => error === failure,
	);
	flushLogs();

	const [record] = writeRecords(dir);
	assert.ok(record, "a thrown handler still records its request");
	assert.equal(record.requestId, "req-write-throw");
	assert.equal(record.route, "/api/settings");
	assert.equal(record.status, 500);
	assert.equal(record.level, "error");
	assert.equal(record.failed, true);
	assert.equal(record.error.message, "write exploded");
});

test("wrapped write routes keep their status codes and bodies", async (t) => {
	const dir = await useTempTransport(t);
	const { POST: validateCwd } = await import("../app/api/cwd/validate/route.ts");
	const { PUT: updateWebAccess } = await import("../app/api/web-access/route.ts");
	const workDir = createTempDir(t, "ompdesk-write-cwd-");

	const success = await validateCwd(
		writeRequest({
			requestId: "req-cwd-ok",
			url: "http://localhost:30141/api/cwd/validate",
			body: JSON.stringify({ cwd: workDir }),
		}),
	);
	assert.equal(success.status, 200);
	assert.deepEqual(await success.json(), { success: true, cwd: fs.realpathSync(workDir) });

	const missing = await validateCwd(
		writeRequest({
			requestId: "req-cwd-400",
			url: "http://localhost:30141/api/cwd/validate",
			body: "{}",
		}),
	);
	assert.equal(missing.status, 400);
	assert.deepEqual(await missing.json(), { error: "Path is required" });

	const wrongType = await updateWebAccess(
		new Request("http://localhost:30141/api/web-access", {
			method: "PUT",
			headers: {
				host: "localhost:30141",
				"content-type": "text/plain",
				"x-ompdesk-request-id": "req-web-access-415",
			},
			body: "not json",
		}),
	);
	assert.equal(wrongType.status, 415);
	assert.deepEqual(await wrongType.json(), { error: "Expected a JSON body" });
	flushLogs();

	const records = readRecords(dir).filter((entry) => entry.message === "http.request");
	const byRequestId = new Map(records.map((record) => [record.requestId, record]));

	assert.equal(byRequestId.get("req-cwd-ok")?.route, "/api/cwd/validate");
	assert.equal(byRequestId.get("req-cwd-ok")?.status, 200);
	assert.equal(byRequestId.get("req-cwd-400")?.route, "/api/cwd/validate");
	assert.equal(byRequestId.get("req-cwd-400")?.status, 400);
	assert.equal(byRequestId.get("req-web-access-415")?.route, "/api/web-access");
	assert.equal(byRequestId.get("req-web-access-415")?.method, "PUT");
	assert.equal(byRequestId.get("req-web-access-415")?.status, 415);
	assert.equal(byRequestId.get("req-web-access-415")?.level, "warn");
});
