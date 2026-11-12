import assert from "node:assert/strict";
import test from "node:test";

const { parseFormDataWithinLimit, RequestBodyTooLargeError } = await import("./bounded-form-data.ts");

test("cancels the body and reports the size limit when the cancel itself fails", async () => {
  let cancelled = 0;
  let released = 0;
  const request = {
    headers: new Headers(),
    body: {
      getReader() {
        return {
          async read() {
            return { done: false, value: new Uint8Array(8) };
          },
          async cancel() {
            cancelled += 1;
            throw new Error("stream already closed");
          },
          releaseLock() {
            released += 1;
          },
        };
      },
    },
  };

  await assert.rejects(parseFormDataWithinLimit(request, 4), RequestBodyTooLargeError);
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
});

test("rejects a declared oversized body before reading it", async () => {
  let read = false;
  const request = {
    headers: new Headers({ "content-length": "2048" }),
    body: {
      getReader() {
        read = true;
        throw new Error("must not read");
      },
    },
  };

  await assert.rejects(parseFormDataWithinLimit(request, 1024), RequestBodyTooLargeError);
  assert.equal(read, false);
});
