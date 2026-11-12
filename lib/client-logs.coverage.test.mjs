import assert from "node:assert/strict";
import test from "node:test";

const { createClientLogHandler, CLIENT_LOG_MAX_BODY_BYTES } = await import("./client-logs.ts");

function streamingRequest(reader) {
  return {
    headers: new Headers({ "content-type": "application/json" }),
    body: {
      getReader() {
        return reader;
      },
    },
  };
}

function rejectingReader(chunks) {
  let index = 0;
  return {
    released: 0,
    async read() {
      if (index >= chunks.length) throw new Error("client disconnected");
      return { done: false, value: chunks[index++] };
    },
    async cancel() {
      throw new Error("stream already closed");
    },
    releaseLock() {
      this.released += 1;
    },
  };
}

test("reports a disconnected body even when cancelling it also fails", async () => {
  const reader = rejectingReader([new Uint8Array(4)]);
  const handler = createClientLogHandler();
  const response = await handler(streamingRequest(reader));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Request body could not be read" });
  assert.equal(reader.released, 1);
});

test("reports an oversized chunked body even when cancelling it also fails", async () => {
  const reader = rejectingReader([new Uint8Array(CLIENT_LOG_MAX_BODY_BYTES + 1)]);
  const handler = createClientLogHandler();
  const response = await handler(streamingRequest(reader));

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "Request body is too large" });
  assert.equal(reader.released, 1);
});
