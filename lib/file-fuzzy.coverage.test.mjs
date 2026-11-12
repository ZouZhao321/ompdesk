import assert from "node:assert/strict";
import test from "node:test";

const { buildAtInsertText, buildAtMentionText, buildEntriesFromFiles, extractAtQuery, filterFileEntries } =
  await import("./file-fuzzy.ts");

test("detects plain and quoted @tokens immediately before the cursor", () => {
  assert.deepEqual(extractAtQuery("hello @src/ma"), { start: 6, query: "src/ma", quoted: false });
  assert.deepEqual(extractAtQuery("@"), { start: 0, query: "", quoted: false });
  assert.deepEqual(extractAtQuery("@src"), { start: 0, query: "src", quoted: false });
  assert.deepEqual(extractAtQuery('type @"my dir/fi'), { start: 5, query: "my dir/fi", quoted: true });
  assert.deepEqual(extractAtQuery('@"a'), { start: 0, query: "a", quoted: true });
});

test("ignores @tokens that are not preceded by the start of the line or whitespace", () => {
  assert.equal(extractAtQuery("foo@bar"), null);
  assert.equal(extractAtQuery("a@b c"), null);
  assert.equal(extractAtQuery('@"a" tail'), null);
  assert.equal(extractAtQuery("nothing here"), null);
});

test("derives directory entries and orders entries shallow-first then alphabetically", () => {
  const entries = buildEntriesFromFiles([
    "src/app.ts",
    "src/components/ChatInput.tsx",
    "project files/design brief.md",
    "",
  ]);

  assert.deepEqual(
    entries.map((entry) => `${entry.isDir ? "d" : "f"}:${entry.path}`),
    [
      "d:project files",
      "d:src",
      "f:project files/design brief.md",
      "f:src/app.ts",
      "d:src/components",
      "f:src/components/ChatInput.tsx",
    ],
  );
  assert.deepEqual(buildEntriesFromFiles([]), []);
});

const fixtureEntries = buildEntriesFromFiles([
  "src/app.ts",
  "src/components/ChatInput.tsx",
  "src/components/chat-something.ts",
  "README.md",
  "project files/design brief.md",
]);

test("returns the base order when the query is empty and truncates at the limit", () => {
  assert.deepEqual(filterFileEntries(fixtureEntries, ""), fixtureEntries);
  assert.deepEqual(
    filterFileEntries(fixtureEntries, "", 2).map((entry) => entry.path),
    fixtureEntries.slice(0, 2).map((entry) => entry.path),
  );
  assert.deepEqual(filterFileEntries(fixtureEntries, "zzz"), []);
});

test("ranks exact, prefix, substring and path matches above fuzzy ones", () => {
  const top = filterFileEntries(fixtureEntries, "app.ts");
  assert.equal(top[0].path, "src/app.ts");
  assert.equal(top[0].isDir, false);

  const prefix = filterFileEntries(fixtureEntries, "app");
  assert.equal(prefix[0].path, "src/app.ts");

  const basenameSubstring = filterFileEntries(fixtureEntries, "chatinput");
  assert.equal(basenameSubstring[0].path, "src/components/ChatInput.tsx");

  const pathSubstring = filterFileEntries(fixtureEntries, "compon");
  const pathSubstringPaths = pathSubstring.map((entry) => entry.path);
  assert.ok(pathSubstringPaths.includes("src/components/ChatInput.tsx"));
  assert.ok(pathSubstringPaths.includes("src/components"));
  assert.equal(pathSubstring[0].path, "src/components");
  assert.equal(pathSubstring[0].isDir, true);

  const fuzzy = filterFileEntries(fixtureEntries, "chinp");
  assert.equal(fuzzy[0].path, "src/components/ChatInput.tsx");

  assert.deepEqual(filterFileEntries(fixtureEntries, "readme"), [{ path: "README.md", isDir: false }]);
});

test("ranks directory queries against the full path so drill-down keeps the menu open", () => {
  const inside = filterFileEntries(fixtureEntries, "src/");
  assert.ok(inside.length > 0);
  for (const entry of inside) assert.ok(entry.path.startsWith("src/"), entry.path);
  assert.ok(!inside.some((entry) => entry.path === "src"));

  const fuzzyPath = filterFileEntries(fixtureEntries, "sr/app");
  assert.equal(fuzzyPath[0].path, "src/app.ts");

  assert.equal(
    filterFileEntries(fixtureEntries, "src/components/chat-something.ts")[0].path,
    "src/components/chat-something.ts",
  );
});

test("builds insertion text for files, directories, and quoted paths", () => {
  assert.deepEqual(buildAtInsertText("notes/todo.md", false), { text: "@notes/todo.md ", cursorOffset: 15 });
  assert.deepEqual(buildAtInsertText("project files/design brief.md", false), {
    text: '@"project files/design brief.md" ',
    cursorOffset: 33,
  });
  assert.deepEqual(buildAtInsertText("src", true), { text: "@src/", cursorOffset: 5 });
  assert.deepEqual(buildAtInsertText("project files", true), {
    text: '@"project files/"',
    cursorOffset: 16,
  });
  assert.deepEqual(buildAtInsertText("notes/todo.md", false, true), {
    text: '@"notes/todo.md" ',
    cursorOffset: 17,
  });
  assert.deepEqual(buildAtInsertText("src", true, true), { text: '@"src/"', cursorOffset: 6 });
});

test("closes directory mentions with a trailing slash and space", () => {
  assert.equal(buildAtMentionText("src", true), "@src/ ");
  assert.equal(buildAtMentionText("project files", true), '@"project files/" ');
});
