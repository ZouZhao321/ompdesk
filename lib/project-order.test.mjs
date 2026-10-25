import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const projectOrder = await createJiti(import.meta.url).import("./project-order.ts");
// 逐项取导出：新导出缺失时只让对应用例失败，既有用例保持可运行。
const { orderProjectPaths, projectDisplayName } = projectOrder;
const { normalizeProjectKey, togglePinnedProject } = projectOrder;
const { dedupePinnedProjects, placeSelectedProject } = projectOrder;

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

test("breaks display-name ties that differ only by case on the full path", () => {
  const expected = ["/w/App", "/w/app"];

  assert.deepEqual(orderProjectPaths(["/w/app", "/w/App"], "name"), expected);
  assert.deepEqual(orderProjectPaths(["/w/App", "/w/app"], "name"), expected);
});

test("breaks display-name ties that differ only by numeric spelling on the full path", () => {
  const expected = ["/w/app01", "/w/app1"];

  assert.deepEqual(orderProjectPaths(["/w/app1", "/w/app01"], "name"), expected);
  assert.deepEqual(orderProjectPaths(["/w/app01", "/w/app1"], "name"), expected);
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

test("normalizes Windows paths to forward slashes and folds their letter case", () => {
  assert.equal(normalizeProjectKey("C:\\Users\\Dev\\My-App"), "c:/users/dev/my-app");
  assert.equal(normalizeProjectKey("D:\\Work\\ompdesk"), "d:/work/ompdesk");
});

test("keeps the letter case of POSIX paths when normalizing", () => {
  assert.equal(normalizeProjectKey("/Users/Dev/My-App"), "/Users/Dev/My-App");
  assert.notEqual(normalizeProjectKey("/Users/Dev/app"), normalizeProjectKey("/users/dev/app"));
});

test("keeps two-argument ordering unchanged when pinned projects are omitted", () => {
  const projects = ["/w/beta", "/w/alpha", "/w/gamma"];

  for (const mode of ["time", "name"]) {
    assert.deepEqual(orderProjectPaths(projects, mode), orderProjectPaths(projects, mode, []));
  }
});

test("puts pinned projects first in time mode", () => {
  const projects = ["/w/zeta", "/w/alpha", "/w/beta"];

  assert.deepEqual(orderProjectPaths(projects, "time", ["/w/beta"]), ["/w/beta", "/w/zeta", "/w/alpha"]);
});

test("puts pinned projects first in name mode", () => {
  const projects = ["/w/alpha", "/w/beta", "/w/gamma"];

  assert.deepEqual(orderProjectPaths(projects, "name", ["/w/gamma"]), ["/w/gamma", "/w/alpha", "/w/beta"]);
});

test("orders several pinned projects by pin order rather than by name", () => {
  const projects = ["/w/alpha", "/w/beta", "/w/gamma"];
  const pinned = ["/w/gamma", "/w/alpha"];

  assert.deepEqual(orderProjectPaths(projects, "name", pinned), ["/w/gamma", "/w/alpha", "/w/beta"]);
  assert.deepEqual(orderProjectPaths(projects, "time", pinned), ["/w/gamma", "/w/alpha", "/w/beta"]);
});

test("ignores pinned projects that are not in the project list", () => {
  const projects = ["/w/alpha", "/w/beta"];

  assert.deepEqual(orderProjectPaths(projects, "time", ["/missing/gone", "/w/beta"]), ["/w/beta", "/w/alpha"]);
});

test("lists a pinned project once even when its pin entry is duplicated", () => {
  const projects = ["E:\\Work\\Third", "C:\\Work\\App", "D:\\Work\\Other"];
  const pinned = ["c:/work/app", "C:\\Work\\App", "D:\\Work\\Other"];

  assert.deepEqual(orderProjectPaths(projects, "time", pinned), [
    "C:\\Work\\App",
    "D:\\Work\\Other",
    "E:\\Work\\Third",
  ]);
});

test("matches pinned projects by normalized key", () => {
  const projects = ["C:\\Work\\Zeta", "D:\\Work\\Alpha"];

  assert.deepEqual(orderProjectPaths(projects, "name", ["c:/work/zeta"]), ["C:\\Work\\Zeta", "D:\\Work\\Alpha"]);
});

test("appends a newly pinned project to the end of the pin list", () => {
  assert.deepEqual(togglePinnedProject(["/w/alpha"], "/w/beta"), ["/w/alpha", "/w/beta"]);
  assert.deepEqual(togglePinnedProject([], "/w/beta"), ["/w/beta"]);
});

test("unpins a project while keeping the remaining pin order", () => {
  assert.deepEqual(togglePinnedProject(["/w/alpha", "/w/beta", "/w/gamma"], "/w/beta"), ["/w/alpha", "/w/gamma"]);
});

test("toggles Windows paths regardless of separators and letter case", () => {
  assert.deepEqual(togglePinnedProject(["C:\\Work\\App"], "c:/work/app"), []);
  assert.deepEqual(togglePinnedProject(["c:/work/app"], "C:\\Work\\App"), []);
});

test("leaves the pin list untouched when toggling", () => {
  const pinned = ["/w/alpha"];

  togglePinnedProject(pinned, "/w/beta");
  togglePinnedProject(pinned, "/w/alpha");

  assert.deepEqual(pinned, ["/w/alpha"]);
});

test("dedupes the pin list by normalized key while keeping the first spelling", () => {
  assert.deepEqual(
    dedupePinnedProjects(["c:/work/app", "C:\\Work\\App", "/w/beta", "c:/work/app"]),
    ["c:/work/app", "/w/beta"],
  );
  assert.deepEqual(dedupePinnedProjects(["/w/alpha", "/w/beta"]), ["/w/alpha", "/w/beta"]);
  assert.deepEqual(dedupePinnedProjects([]), []);
});

test("places a pinned selected project at its pin rank", () => {
  const pinned = ["/w/gamma", "/w/alpha"];
  const ordered = orderProjectPaths(["/w/gamma", "/w/beta"], "time", pinned);

  assert.deepEqual(ordered, ["/w/gamma", "/w/beta"]);
  assert.deepEqual(placeSelectedProject(ordered, "/w/alpha", pinned), ["/w/gamma", "/w/alpha", "/w/beta"]);
});

test("places a pinned selected project ahead of the pinned block when it ranks first", () => {
  const pinned = ["/w/alpha", "/w/gamma"];
  const ordered = orderProjectPaths(["/w/gamma", "/w/beta"], "time", pinned);

  assert.deepEqual(ordered, ["/w/gamma", "/w/beta"]);
  assert.deepEqual(placeSelectedProject(ordered, "/w/alpha", pinned), ["/w/alpha", "/w/gamma", "/w/beta"]);
});

test("places an unpinned selected project after the pinned block", () => {
  const pinned = ["/w/beta"];
  const ordered = orderProjectPaths(["/w/beta", "/w/gamma"], "name", pinned);

  assert.deepEqual(ordered, ["/w/beta", "/w/gamma"]);
  assert.deepEqual(placeSelectedProject(ordered, "/w/alpha", pinned), ["/w/beta", "/w/alpha", "/w/gamma"]);
});

test("keeps an already present selected project in place", () => {
  const ordered = ["/w/beta", "/w/alpha"];

  assert.deepEqual(placeSelectedProject(ordered, "/w/alpha", []), ordered);
  assert.deepEqual(
    placeSelectedProject(["C:\\Work\\App", "/w/beta"], "c:/work/app", []),
    ["C:\\Work\\App", "/w/beta"],
  );
});

test("appends the selected project when the list is empty", () => {
  assert.deepEqual(placeSelectedProject([], "/w/alpha", ["/w/alpha"]), ["/w/alpha"]);
});

test("leaves the ordered list untouched when placing the selected project", () => {
  const ordered = ["/w/beta", "/w/gamma"];

  placeSelectedProject(ordered, "/w/alpha", ["/w/beta"]);

  assert.deepEqual(ordered, ["/w/beta", "/w/gamma"]);
});
