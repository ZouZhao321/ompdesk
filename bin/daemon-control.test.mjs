import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const daemonModule = await import("./daemon-control.js");
const daemonApi = Object.assign({}, daemonModule.default, daemonModule);
const {
  CONTROL_TOKEN_HEADER,
  buildUrl,
  connectableHost,
  createControlToken,
  describeActivity,
  fetchActivity,
  formatStatus,
  isProcessAlive,
  listRecords,
  logFile,
  probePort,
  projectLabel,
  readRecord,
  recordFile,
  removeRecord,
  stateDir,
  stopRefusal,
  terminateInstance,
  waitForPort,
  writeRecord,
} = daemonApi;
const optionsModule = await import("./ompdesk-options.js");
const { parseLaunchOptions } = Object.assign({}, optionsModule.default, optionsModule);

async function withStateDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "ompdesk-daemon-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function record(overrides = {}) {
  return {
    pid: process.pid,
    host: "127.0.0.1",
    port: 30141,
    url: "http://127.0.0.1:30141",
    startedAt: "2026-11-07T10:00:00.000Z",
    controlToken: "a".repeat(48),
    log: "/tmp/ompdesk.log",
    ...overrides,
  };
}

test("实例记录按端口分开存放，读取时可还原", async () => {
  await withStateDir(async (dir) => {
    writeRecord(recordFile(dir, 30141), record());
    writeRecord(recordFile(dir, 30142), record({ port: 30142, url: "http://127.0.0.1:30142" }));

    assert.deepEqual(
      listRecords(dir).map((entry) => entry.port),
      [30141, 30142],
    );
    assert.equal(readRecord(recordFile(dir, 30141)).url, "http://127.0.0.1:30141");
  });
});

test("记录文件保持完整写入，读到的是同一次写入的内容", async () => {
  await withStateDir(async (dir) => {
    const file = recordFile(dir, 30141);
    writeRecord(file, record({ pid: 111 }));
    writeRecord(file, record({ pid: 222 }));

    assert.equal(readRecord(file).pid, 222);
    assert.match(await readFile(file, "utf8"), /"pid": 222/);
  });
});

test("删除记录后不再列出，重复删除不报错", async () => {
  await withStateDir(async (dir) => {
    const file = recordFile(dir, 30141);
    writeRecord(file, record());
    removeRecord(file);
    removeRecord(file);
    assert.deepEqual(listRecords(dir), []);
  });
});

test("已经退出的进程不会被当成运行中", async () => {
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore", windowsHide: true });
  await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(isProcessAlive(child.pid), false);
  assert.equal(isProcessAlive(process.pid), true);
});

test("端口探测区分开放与关闭", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
  const port = server.port;
  try {
    assert.equal(await probePort("127.0.0.1", port), true);
  } finally {
    server.stop(true);
  }
  assert.equal(await probePort("127.0.0.1", port), false);
});

test("控制端点带令牌返回项目活动，令牌不对时不返回数据", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (request.headers.get(CONTROL_TOKEN_HEADER) !== "secret") {
        return new Response("no", { status: 404 });
      }
      return Response.json({
        running: 1,
        waiting: 0,
        projects: [{ path: "/p/a", sessions: 2, running: 1, waiting: 0 }],
      });
    },
  });
  try {
    const base = { host: "127.0.0.1", port: server.port, url: buildUrl("127.0.0.1", server.port) };
    assert.deepEqual(await fetchActivity({ ...base, controlToken: "secret" }), {
      running: 1,
      waiting: 0,
      projects: [{ path: "/p/a", sessions: 2, running: 1, waiting: 0 }],
    });
    assert.equal(await fetchActivity({ ...base, controlToken: "wrong" }), null);
    assert.equal(await fetchActivity({ ...base }), null);
  } finally {
    server.stop(true);
  }
});

test("有任务在跑时拒绝停止，端点不响应时要求显式强制", () => {
  assert.match(stopRefusal({ running: 2, projects: [] }), /2 tasks are still running/);
  assert.match(stopRefusal({ running: 1, projects: [] }), /1 task is still running/);
  assert.equal(stopRefusal({ running: 0, projects: [] }), null);
  assert.match(stopRefusal(null), /--force/);
});

test("运行数缺失或不是整数时同样拒绝，不把不确定当成可以中断", () => {
  for (const activity of [{ projects: [] }, { running: "2", projects: [] }, { running: null }, { running: -1 }]) {
    assert.match(stopRefusal(activity), /--force/, JSON.stringify(activity));
  }
});

test("状态输出包含地址、进程与按项目的活动", () => {
  const lines = formatStatus(record(), {
    running: 1,
    waiting: 0,
    projects: [
      { path: "C:\\work\\ompdesk", sessions: 3, running: 1, waiting: 0 },
      { path: "/srv/quiet", sessions: 1, running: 0, waiting: 0 },
    ],
  });
  assert.equal(lines[0], "ompdesk is running at http://127.0.0.1:30141");
  assert.match(lines[1], /^pid \d+, started /);
  assert.match(lines[2], /^log /);
  assert.deepEqual(lines.slice(3), ["ompdesk: 3 sessions, 1 running", "quiet: 1 session"]);
});

test("状态输出在端点不响应时说明无法确认", () => {
  assert.deepEqual(formatStatus(record(), null).slice(3), [
    "Session state is unavailable: the instance did not answer the control endpoint.",
  ]);
  assert.deepEqual(formatStatus(null, null), ["ompdesk is not running."]);
});

test("运行总数与项目行不一致时单独说明，不停留在无法定位的状态", () => {
  const lines = describeActivity({
    running: 2,
    waiting: 0,
    projects: [{ path: "/work/a", sessions: 1, running: 1, waiting: 0 }],
  });
  assert.deepEqual(lines, ["a: 1 session, 1 running", "Not listed under a project yet: 1 running session."]);
});

test("没有可归位会话时不打印自相矛盾的空行", () => {
  assert.deepEqual(describeActivity({ running: 1, waiting: 0, projects: [] }), [
    "Not listed under a project yet: 1 running session.",
  ]);
  assert.deepEqual(describeActivity({ running: 1, waiting: 2, projects: [] }), [
    "Not listed under a project yet: 1 running, 2 waiting for input sessions.",
  ]);
  assert.deepEqual(describeActivity({ running: 3, waiting: 0, projects: [] }), [
    "Not listed under a project yet: 3 running sessions.",
  ]);
  assert.deepEqual(describeActivity({ running: 2, waiting: 3, projects: [] }), [
    "Not listed under a project yet: 2 running, 3 waiting for input sessions.",
  ]);
  assert.deepEqual(describeActivity({ running: 2, waiting: 0 }), ["State incomplete: 2 running."]);
});

test("活动输出区分运行、等待与只是有会话的项目", () => {
  assert.deepEqual(describeActivity({ running: 0, waiting: 0, projects: [] }), ["No sessions yet."]);
  assert.deepEqual(
    describeActivity({
      running: 2,
      waiting: 1,
      projects: [{ path: "/work/a", sessions: 4, running: 2, waiting: 1 }],
    }),
    ["a: 4 sessions, 2 running, 1 waiting for input"],
  );
});

test("命令解析识别 status、stop、foreground 与未知命令", () => {
  assert.equal(parseLaunchOptions([], {}).command, "start");
  assert.equal(parseLaunchOptions(["status"], {}).command, "status");
  assert.equal(parseLaunchOptions(["foreground"], {}).command, "foreground");
  assert.equal(parseLaunchOptions(["stop", "--force"], {}).command, "stop");
  assert.equal(parseLaunchOptions(["stop", "--force"], {}).force, true);
  assert.match(parseLaunchOptions(["nope"], {}).error, /Unknown command/);
  assert.equal(parseLaunchOptions(["status", "--port", "30200"], {}).portExplicit, true);
  assert.equal(parseLaunchOptions(["status"], {}).portExplicit, false);
  assert.equal(parseLaunchOptions(["status"], { PORT: "30141" }).portExplicit, false);
});

test("守护进程辅助函数覆盖地址、记录路径与令牌", () => {
  assert.equal(connectableHost("0.0.0.0"), "127.0.0.1");
  assert.equal(connectableHost("::"), "127.0.0.1");
  assert.equal(connectableHost("[::1]"), "::1");
  assert.equal(connectableHost(""), "127.0.0.1");
  assert.equal(connectableHost("10.0.0.5"), "10.0.0.5");

  assert.match(stateDir({ PI_CODING_AGENT_DIR: "C:/agent" }), /agent$/);
  assert.equal(logFile("/state", 30141).endsWith("ompdesk-daemon-30141.log"), true);
  assert.match(createControlToken(), /^[0-9a-f]{48}$/);

  assert.equal(projectLabel("/"), "/");
  assert.equal(projectLabel("C:\\work\\demo\\"), "demo");
  assert.equal(projectLabel(""), "(unknown)");
});

test("端口等待与进程终止处理边界输入", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
  try {
    assert.equal(await waitForPort("127.0.0.1", server.port, 1000, true), true);
  } finally {
    server.stop(true);
  }
  assert.equal(await waitForPort("127.0.0.1", server.port, 100, true), false);

  terminateInstance(undefined);
  terminateInstance(-1);
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  await new Promise((resolve) => child.on("exit", resolve));
  terminateInstance(child.pid, true);
});
