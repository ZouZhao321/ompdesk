import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";
import { readSourceFile } from "../test-support/source-text.ts";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { LogsPanelView } = await jiti.import("./LogsPanelView.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const styles = new Proxy({}, { get: (_target, key) => String(key) });
const noop = () => {};

function props(overrides = {}) {
  return {
    styles,
    files: [],
    file: null,
    entries: [],
    level: "all",
    keyword: "",
    follow: true,
    paused: false,
    loading: false,
    error: null,
    catchingUp: false,
    selectedFile: null,
    expandedOffset: null,
    onLevelChange: noop,
    onKeywordChange: noop,
    onFileChange: noop,
    onFollowChange: noop,
    onTogglePause: noop,
    onRefresh: noop,
    onToggleEntry: noop,
    ...overrides,
  };
}

function render(overrides, initialLocale = "en") {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, { initialLocale }, React.createElement(LogsPanelView, props(overrides))),
  );
}

function entry(offset, message, extra = {}) {
  const level = typeof extra.level === "string" ? extra.level : "info";
  return {
    offset,
    length: 32,
    raw: JSON.stringify({ level, message, ...extra }),
    level,
    timestamp: "2026-10-24T15:00:00.000+08:00",
    source: "ompdesk",
    subsystem: "http",
    message,
    fields: { level, message, ...extra },
  };
}

test("distinguishes an empty file list from a load failure and a loading state", () => {
  assert.match(render(), /No log file yet/);
  assert.match(render(), /data-kind="no-files"/);

  const loading = render({ loading: true });
  assert.match(loading, /Loading logs/);
  assert.match(loading, /role="status"/);

  const failed = render({ error: "connect ECONNREFUSED" });
  assert.match(failed, /Could not load logs/);
  assert.match(failed, /connect ECONNREFUSED/);
  assert.match(failed, /role="alert"/);
});

test("shows no-matches separately from a genuinely empty file", () => {
  const file = {
    name: "omp.2026-10-24.4242.log",
    size: 10,
    modifiedAt: "2026-10-24T15:00:00.000Z",
    current: true,
  };
  assert.match(render({ files: [file], file, level: "warn" }), /No matching entries/);
  assert.match(render({ files: [file], file }), /This log file is empty/);
});

test("does not claim no matches while a truncated page is still catching up", () => {
  const file = {
    name: "omp.2026-10-24.4242.log",
    size: 10,
    modifiedAt: "2026-10-24T15:00:00.000Z",
    current: true,
  };
  const html = render({ files: [file], file, level: "warn", catchingUp: true });

  assert.match(html, /Catching up/);
  assert.match(html, /data-kind="catching-up"/);
  assert.equal(html.includes("No matching entries"), false, html);
});

test("renders level badges, messages, and file metadata", () => {
  const file = {
    name: "omp.2026-10-24.4242.log",
    size: 1_536,
    modifiedAt: "2026-10-24T15:00:00.000Z",
    current: true,
  };
  const html = render({
    files: [file],
    file,
    entries: [entry(0, "http.request", { level: "error" })],
  });

  assert.match(html, /data-level="error"/);
  assert.match(html, />error</);
  assert.match(html, /http\.request/);
  assert.match(html, /1\.5 KB/);
  assert.match(html, /active/);
  assert.match(html, /download="omp\.2026-10-24\.4242\.log"/);
  assert.match(html, /href="\/api\/logs\?download=1&amp;file=omp\.2026-10-24\.4242\.log"/);
});

test("expands one entry into its full field JSON", () => {
  const html = render({
    files: [
      {
        name: "omp.2026-10-24.4242.log",
        size: 10,
        modifiedAt: "2026-10-24T15:00:00.000Z",
        current: true,
      },
    ],
    file: {
      name: "omp.2026-10-24.4242.log",
      size: 10,
      modifiedAt: "2026-10-24T15:00:00.000Z",
      current: true,
    },
    entries: [entry(0, "http.request", { requestId: "req-1", durationMs: 42 })],
    expandedOffset: 0,
  });

  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /&quot;requestId&quot;: &quot;req-1&quot;/);
  assert.match(html, /&quot;durationMs&quot;: 42/);
});

test("preserves unparseable lines with their parse error", () => {
  const file = {
    name: "omp.2026-10-24.4242.log",
    size: 10,
    modifiedAt: "2026-10-24T15:00:00.000Z",
    current: true,
  };
  const raw = {
    offset: 0,
    length: 8,
    raw: "not json",
    level: null,
    timestamp: null,
    source: "sdk",
    subsystem: null,
    message: "not json",
    fields: {},
    parseError: "Unexpected token",
  };
  const html = render({ files: [file], file, entries: [raw], expandedOffset: 0 });

  assert.match(html, />raw</);
  assert.match(html, /parseError: Unexpected token/);
  assert.match(html, /not json/);
});

test("shows follow and pause state in the controls", () => {
  const following = render();
  assert.match(following, /aria-pressed="true"/);
  assert.match(following, />Following</);

  const paused = render({ paused: true, follow: false });
  assert.match(paused, /Polling paused/);
  assert.match(paused, />Resume</);
  assert.match(paused, />Follow latest</);
});

test("renders the panel chrome in Chinese", () => {
  const html = render({}, "zh-CN");

  assert.match(html, />日志</);
  assert.match(html, /当前服务进程的日志文件/);
  assert.match(html, />下载</);
  assert.match(html, />级别</);
  assert.match(html, /aria-label="日志级别"/);
  assert.match(html, />关键词</);
  assert.match(html, /placeholder="按文本过滤"/);
  assert.match(html, /aria-label="日志文件"/);
  assert.match(html, />暂无文件</);
  assert.match(html, />正在跟随</);
  assert.match(html, />暂停</);
  assert.match(html, />刷新</);
  assert.match(html, />未选择文件</);
  assert.match(html, /全部级别/);
  assert.equal(html.includes("All levels"), false, html);
  assert.equal(html.includes("No file yet"), false, html);
});

test("localizes empty states and keeps server errors verbatim", () => {
  const loading = render({ loading: true }, "zh-CN");
  assert.match(loading, /正在加载日志/);
  assert.match(loading, /正在读取当前进程日志/);

  const failed = render({ error: "connect ECONNREFUSED" }, "zh-CN");
  assert.match(failed, /无法加载日志/);
  assert.match(failed, /connect ECONNREFUSED/);

  const file = {
    name: "omp.2026-10-24.4242.log",
    size: 10,
    modifiedAt: "2026-10-24T15:00:00.000Z",
    current: true,
  };
  const noMatches = render({ files: [file], file, level: "warn" }, "zh-CN");
  assert.match(noMatches, /没有匹配的条目/);
  assert.match(noMatches, /只读取该文件的最新部分/);

  const paused = render({ files: [file], file, paused: true, follow: false }, "zh-CN");
  assert.match(paused, />跟随最新</);
  assert.match(paused, />继续</);
  assert.match(paused, /轮询已暂停/);
  assert.match(paused, />当前</);
  assert.match(paused, /最后写入 /);
});

test("keeps the narrow-screen layout rules", async () => {
  const css = await readSourceFile(new URL("./LogsPanel.module.css", import.meta.url));
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(
    css,
    /@media \(max-width: 760px\)[\s\S]*?\.entrySummary \{[\s\S]*?grid-template-columns: auto minmax\(0, 1fr\)/,
  );
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.field, \.searchField, \.fileField \{ flex: 1 1 100%/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.actions \{ display: grid/);
});
