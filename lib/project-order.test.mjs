import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { orderProjectPaths, projectDisplayName } = await createJiti(import.meta.url).import("./project-order.ts");

test("derives the display name from the last path segment", () => {
  assert.equal(projectDisplayName("/Users/dev/my-app"), "my-app");
  assert.equal(projectDisplayName("/workspace/ompdesk"), "ompdesk");
  assert.equal(projectDisplayName("C:\\Users\\dev\\my-app"), "my-app");
});

test("ignores trailing path separators when deriving the display name", () => {
  assert.equal(projectDisplayName("/Users/dev/my-app/"), "my-app");
  assert.equal(projectDisplayName("/Users/dev/my-app///"), "my-app");
  assert.equal(projectDisplayName("C:\\Users\\dev\\my-app\\"), "my-app");
});

test("keeps the input order in time mode", () => {
  const projects = ["/w/zeta", "/w/alpha", "/w/zeta", "/w/beta"];

  assert.deepEqual(orderProjectPaths(projects, "time"), projects);
});

test("sorts by directory display name in name mode", () => {
  const projects = ["/w/beta", "/w/alpha", "/w/gamma"];

  assert.deepEqual(orderProjectPaths(projects, "name"), ["/w/alpha", "/w/beta", "/w/gamma"]);
});

test("orders numeric suffixes naturally in name mode", () => {
  const projects = ["/w/app10", "/w/app2", "/w/app9"];

  assert.deepEqual(orderProjectPaths(projects, "name"), ["/w/app2", "/w/app9", "/w/app10"]);
});

test("breaks display-name ties on the full path in name mode", () => {
  const projects = ["/projects/gamma/app", "/projects/alpha/app", "/projects/beta/app"];

  assert.deepEqual(orderProjectPaths(projects, "name"), [
    "/projects/alpha/app",
    "/projects/beta/app",
    "/projects/gamma/app",
  ]);
});

test("returns an empty list for an empty input in both modes", () => {
  assert.deepEqual(orderProjectPaths([], "time"), []);
  assert.deepEqual(orderProjectPaths([], "name"), []);
});

test("leaves the input array untouched in both modes", () => {
  const projects = ["/w/beta", "/w/alpha"];

  orderProjectPaths(projects, "name");
  orderProjectPaths(projects, "time");

  assert.deepEqual(projects, ["/w/beta", "/w/alpha"]);
});
