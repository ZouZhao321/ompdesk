import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  normalizeProjectKey,
  orderProjectPaths,
  projectDisplayName,
  togglePinnedProject,
} = await createJiti(import.meta.url).import("./project-order.ts");

test("keeps the incoming activity order when sorting by time", () => {
  const projects = ["/repo/beta", "/repo/alpha", "/repo/gamma"];
  assert.deepEqual(orderProjectPaths(projects, "time", []), projects);
});

test("sorts by the visible directory name and breaks ties with the full path", () => {
  const projects = ["/z/alpha", "/a/zeta", "/m/beta", "/x/beta"];
  assert.deepEqual(
    orderProjectPaths(projects, "name", []),
    ["/z/alpha", "/m/beta", "/x/beta", "/a/zeta"],
  );
});

test("puts pinned projects first in pin order under both sort modes", () => {
  const projects = ["/repo/alpha", "/repo/beta", "/repo/gamma"];
  const pinned = ["/repo/gamma", "/repo/alpha"];
  assert.deepEqual(
    orderProjectPaths(projects, "name", pinned),
    ["/repo/gamma", "/repo/alpha", "/repo/beta"],
  );
  assert.deepEqual(
    orderProjectPaths(projects, "time", pinned),
    ["/repo/gamma", "/repo/alpha", "/repo/beta"],
  );
});

test("matches pinned Windows paths regardless of slash style or case", () => {
  const projects = ["C:\\Repo\\Beta", "C:\\Repo\\alpha"];
  assert.deepEqual(
    orderProjectPaths(projects, "name", ["c:/repo/beta"]),
    ["C:\\Repo\\Beta", "C:\\Repo\\alpha"],
  );
});

test("appends new pins so the list order is the pin order", () => {
  assert.deepEqual(togglePinnedProject([], "/repo/alpha"), ["/repo/alpha"]);
  assert.deepEqual(togglePinnedProject(["/repo/beta"], "/repo/alpha"), ["/repo/beta", "/repo/alpha"]);
  assert.deepEqual(
    togglePinnedProject(["C:\\Repo\\Beta", "C:\\Repo\\Alpha"], "c:/repo/alpha"),
    ["C:\\Repo\\Beta"],
  );
});

test("unpins a project and leaves the remaining pin order untouched", () => {
  assert.deepEqual(
    togglePinnedProject(["C:\\Repo\\A", "C:\\Repo\\B", "C:\\Repo\\C"], "c:/repo/b"),
    ["C:\\Repo\\A", "C:\\Repo\\C"],
  );
});

test("normalizes drive-letter paths but keeps POSIX paths case-sensitive", () => {
  assert.equal(normalizeProjectKey("C:\\Repo\\Alpha"), "c:/repo/alpha");
  assert.equal(normalizeProjectKey("/Repo/Alpha"), "/Repo/Alpha");
});

test("derives the display name from the last path segment", () => {
  assert.equal(projectDisplayName("C:\\Users\\dev\\ompdesk\\"), "ompdesk");
  assert.equal(projectDisplayName("/home/dev/ompdesk"), "ompdesk");
});
