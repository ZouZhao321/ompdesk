import assert from "node:assert/strict";
import test from "node:test";

const { CLIENT_LOG_ENDPOINT, installClientErrorReporter } = await import("./client-error-report.ts");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("installs on the default window target and posts bounded reports", async (t) => {
  const posts = [];
  const uninstall = installClientErrorReporter({
    buildVersion: "1.2.3",
    fetch: async (input, init) => {
      posts.push({ input, init, body: JSON.parse(init.body) });
      return new Response(null, { status: 204 });
    },
  });
  t.after(() => uninstall());

  globalThis.dispatchEvent(Object.assign(new ErrorEvent("error", { message: "boom", error: new Error("boom") }), {}));
  await flush();

  assert.equal(posts.length, 1);
  assert.equal(posts[0].input, CLIENT_LOG_ENDPOINT);
  assert.equal(posts[0].init.method, "POST");
  assert.equal(posts[0].init.keepalive, true);
  assert.equal(posts[0].body.kind, "error");
  assert.equal(posts[0].body.message, "boom");
  assert.equal(posts[0].body.buildVersion, "1.2.3");
  assert.equal(typeof posts[0].body.stack, "string");
  assert.equal(posts[0].body.url, undefined, "the default location is absent in this runtime");

  // 资源加载失败的事件没有 message 和 error，不该产生报告。
  globalThis.dispatchEvent(new ErrorEvent("error", {}));
  await flush();
  assert.equal(posts.length, 1);

  globalThis.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new Error("promise exploded") }));
  await flush();
  assert.equal(posts.length, 2);
  assert.equal(posts[1].body.kind, "unhandledrejection");
  assert.equal(posts[1].body.message, "promise exploded");

  uninstall();
  globalThis.dispatchEvent(new ErrorEvent("error", { message: "after uninstall", error: new Error("x") }));
  await flush();
  assert.equal(posts.length, 2, "uninstalling removes both listeners");
});

test("swallows transport failures and unknown rejection reasons", async (t) => {
  const posts = [];
  const uninstall = installClientErrorReporter({
    fetch: async (input) => {
      posts.push(input);
      throw new Error("network down");
    },
  });
  t.after(() => uninstall());

  globalThis.dispatchEvent(new ErrorEvent("error", { message: "offline", error: new Error("offline") }));
  globalThis.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: "just a string" }));
  await flush();

  assert.equal(posts.length, 2);
  assert.equal(
    posts.every((input) => input === CLIENT_LOG_ENDPOINT),
    true,
  );
});
