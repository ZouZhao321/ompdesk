import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test, { after, beforeEach } from "node:test";
import { mock } from "bun:test";

/**
 * `scripts/release.ts` 的可执行部分是 `import.meta.main` 之后的分发，内部函数默认不导出。
 * 这里用加载期插件给模块补上导出，让每个函数能被单独驱动；`node:child_process` 换成
 * 记录调用的替身，`git`、`gh` 一次也不会真的执行。
 */
const ROOT = path.join(import.meta.dir, "..");
const TASK_DIR = path.join(ROOT, ".tmp", "release-coverage");
const RELEASE_PATH = path.join(ROOT, "scripts", "release.ts");
const PACKAGE_VERSION = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

rmSync(TASK_DIR, { recursive: true, force: true });

const commands = [];
let respond = () => ({ status: 0, stdout: "", stderr: "" });

mock.module("node:child_process", () => ({
  spawnSync: (file, args, options) => {
    const record = { file, args, options };
    commands.push(record);
    return respond(record) ?? { status: 0, stdout: "", stderr: "" };
  },
}));

Bun.plugin({
  name: "expose-release-internals",
  setup(build) {
    build.onLoad({ filter: /release\.ts$/ }, (args) => {
      if (path.resolve(args.path) !== RELEASE_PATH) return undefined;
      const source = readFileSync(args.path, "utf8");
      // 模块作为入口运行时才会进 `import.meta.main` 那段分发；这里的加载就是它的
      // 入口，因此把守卫打开，并用一段安全的 argv 让它走 `notes` 分支。
      const asEntry = source.replace("if (import.meta.main) {", "if (true) {");
      return {
        contents: `${asEntry}\nexport { fail, run, git, readPackageVersion, writePackageVersion, latestTag, assertRepoState, resolveTarget, assertTagAbsent, renderPrBody, cmdPrepare, watchCI, cmdFinish, cmdNotes };\n`,
        loader: "ts",
      };
    });
  },
});

const previousArgvValue = [...process.argv];
const cliOutput = [];
const originalWrite = process.stdout.write;
process.argv = [process.execPath, RELEASE_PATH, "notes", PACKAGE_VERSION];
process.stdout.write = (chunk) => {
  cliOutput.push(String(chunk));
  return true;
};
let release;
try {
  release = await import("./release.ts");
} finally {
  process.stdout.write = originalWrite;
  process.argv = previousArgvValue;
}

const originalSleepSync = Bun.sleepSync;

after(() => {
  mock.restore();
  Bun.sleepSync = originalSleepSync;
  rmSync(TASK_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  commands.length = 0;
  respond = () => ({ status: 0, stdout: "", stderr: "" });
});

function result(status, stdout = "", stderr = "") {
  return { status, stdout, stderr };
}

/**
 * 按命令名给出替身结果。默认是一套「在 main 上、工作区干净、最新标签就是当前版本」的
 * 现场，单个用例只覆盖自己关心的那几条。
 */
function responder(options = {}) {
  const {
    branch = "main",
    status = "",
    mergeBase = 0,
    describe = `v${PACKAGE_VERSION}`,
    localTag = false,
    remoteTag = "",
    checkIgnore = 0,
    headSha = "0123456789abcdef",
    remoteUrl = "https://github.com/owner/repo.git",
    prUrl = "https://github.com/owner/repo/pull/42",
    ciRuns = [],
    ciStatus = 0,
  } = options;
  let ciCall = 0;

  return (record) => {
    if (record.file === "git") {
      const sub = record.args[0];
      switch (sub) {
        case "branch":
          return result(0, `${branch}\n`);
        case "status":
          return result(0, status);
        case "fetch":
        case "tag":
        case "push":
        case "add":
        case "commit":
        case "worktree":
          return result(0, "");
        case "merge-base":
          return result(mergeBase, "");
        case "describe":
          return result(0, describe ? `${describe}\n` : "");
        case "rev-parse":
          if (record.args.includes("--verify")) return result(localTag ? 0 : 1, "");
          return result(0, `${headSha}\n`);
        case "ls-remote":
          return result(0, remoteTag);
        case "remote":
          return result(0, `${remoteUrl}\n`);
        case "check-ignore":
          return result(checkIgnore, "");
        default:
          return result(0, "");
      }
    }
    if (record.file === "gh" && record.args[0] === "run") {
      const runs = ciRuns[Math.min(ciCall, ciRuns.length - 1)] ?? [];
      ciCall += 1;
      return result(ciStatus, JSON.stringify(runs));
    }
    if (record.file === "gh" && record.args[0] === "pr") {
      return result(0, `${prUrl}\n`);
    }
    return result(0, "");
  };
}

function useCommands(options) {
  respond = responder(options);
}

/** `fail()` 以 `process.exit(1)` 收尾；这里把它换成异常，好断言失败信息。 */
function expectFailure(run) {
  const originalExit = process.exit;
  const originalError = console.error;
  const messages = [];
  let exitCode;
  process.exit = (code) => {
    exitCode = code;
    throw new Error("__release_fail__");
  };
  console.error = (...args) => {
    messages.push(args.map((value) => String(value)).join(" "));
  };
  try {
    run();
  } catch (error) {
    assert.equal(error.message, "__release_fail__", `unexpected error: ${error.message}`);
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }
  assert.equal(exitCode, 1, "fail() must exit with 1");
  return messages.join("\n");
}

function captureConsole(run) {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => {
    lines.push(args.map((value) => String(value)).join(" "));
  };
  try {
    run();
  } finally {
    console.log = originalLog;
  }
  return lines.join("\n");
}

test("the CLI entry point dispatches the notes command with the version argument", () => {
  const output = cliOutput.join("");

  assert.ok(output.trim().length > 0, "the entry point printed the release notes");
  assert.match(output, /^- /m);
});

test("run returns stdout/stderr and passes cwd, inherit and stdin through", () => {
  respond = () => result(0, "hi\n", "");
  const piped = release.run(["printf", "hi"]);
  assert.deepEqual(piped, { code: 0, stdout: "hi\n", stderr: "" });
  assert.equal(commands[0].options.cwd, ROOT);
  assert.equal(commands[0].options.stdio, "pipe");
  assert.equal(commands[0].options.encoding, "utf8");

  const inherited = release.run(["x"], { cwd: TASK_DIR, inherit: true, stdin: "input", allowFailure: true });
  assert.equal(inherited.code, 0);
  assert.equal(commands[1].options.cwd, TASK_DIR);
  assert.equal(commands[1].options.stdio, "inherit");
  assert.equal(commands[1].options.input, "input");
});

test("run exits on a failing command unless the caller allows it", () => {
  respond = () => result(2, "", "boom\n");

  const message = expectFailure(() => release.run(["nope", "--flag"]));
  assert.match(message, /nope --flag 退出码 2/);
  assert.match(message, /boom/);

  const allowed = release.run(["nope"], { allowFailure: true });
  assert.deepEqual(allowed, { code: 2, stdout: "", stderr: "boom\n" });
});

test("git runs with the stripped environment and exits on failure", () => {
  respond = (record) => (record.args[0] === "status" ? result(0, "clean") : result(3, "", "fatal\n"));

  const statusResult = release.git(["status"]);
  assert.equal(statusResult.stdout, "clean");
  assert.equal(commands[0].file, "git");
  assert.equal(commands[0].options.cwd, ROOT);
  assert.equal(commands[0].options.env.GIT_DIR, undefined, "hook-injected GIT_DIR must not reach the child");
  assert.equal(commands[0].options.stdio, "pipe");

  const message = expectFailure(() => release.git(["push"]));
  assert.match(message, /git push 退出码 3/);
  assert.match(message, /fatal/);
});

test("readPackageVersion reads the manifest and refuses one without a version", () => {
  assert.equal(release.readPackageVersion(), PACKAGE_VERSION);

  const manifestDir = path.join(TASK_DIR, "no-version");
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(path.join(manifestDir, "package.json"), JSON.stringify({ name: "no-version" }));

  const message = expectFailure(() => release.readPackageVersion(manifestDir));
  assert.match(message, /package\.json 没有 version 字段/);
});

test("writePackageVersion rewrites only the version field", () => {
  const manifestDir = path.join(TASK_DIR, "write-version");
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    path.join(manifestDir, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { test: "bun test" } }, null, 2),
  );

  release.writePackageVersion(manifestDir, "9.9.9");

  const written = readFileSync(path.join(manifestDir, "package.json"), "utf8");
  assert.equal(
    written,
    `${JSON.stringify({ name: "fixture", version: "9.9.9", scripts: { test: "bun test" } }, null, 2)}\n`,
  );
});

test("latestTag normalizes the tag, defaults to 0.0.0 and rejects non-version tags", () => {
  useCommands({ describe: "v1.2.3" });
  assert.equal(release.latestTag(), "1.2.3");

  useCommands({ describe: "" });
  assert.equal(release.latestTag(), "0.0.0");

  useCommands({ describe: "nightly" });
  assert.match(
    expectFailure(() => release.latestTag()),
    /最新标签 nightly 不是版本标签/,
  );
});

test("assertRepoState requires main, a clean tree and an up-to-date HEAD", () => {
  useCommands({});
  release.assertRepoState();
  assert.ok(
    commands.some((record) => record.args[0] === "fetch"),
    "the tags are fetched before comparing",
  );

  useCommands({ branch: "feature/x" });
  assert.match(
    expectFailure(() => release.assertRepoState()),
    /发版必须在 main 上执行/,
  );

  useCommands({ branch: "" });
  assert.match(
    expectFailure(() => release.assertRepoState()),
    /分离 HEAD/,
  );

  useCommands({ status: " M package.json\n" });
  assert.match(
    expectFailure(() => release.assertRepoState()),
    /工作区不干净/,
  );

  useCommands({ mergeBase: 1 });
  assert.match(
    expectFailure(() => release.assertRepoState()),
    /HEAD 落后于 origin\/main/,
  );
});

test("resolveTarget accepts bumps and exact versions, and rejects everything else", () => {
  assert.equal(release.resolveTarget("patch", "1.0.0"), "1.0.1");
  assert.equal(release.resolveTarget("minor", "1.0.0"), "1.1.0");
  assert.equal(release.resolveTarget("major", "1.0.0"), "2.0.0");
  assert.equal(release.resolveTarget("v2.3.4", "1.0.0"), "2.3.4");

  assert.match(
    expectFailure(() => release.resolveTarget("2.3", "1.0.0")),
    /版本号「2\.3」不合法/,
  );
});

test("assertTagAbsent rejects a local or a remote tag", () => {
  useCommands({ localTag: true });
  assert.match(
    expectFailure(() => release.assertTagAbsent("v1.0.29")),
    /本地已有标签 v1\.0\.29/,
  );

  useCommands({ remoteTag: "abc123 refs/tags/v1.0.29\n" });
  assert.match(
    expectFailure(() => release.assertTagAbsent("v1.0.29")),
    /远端已有标签 v1\.0\.29/,
  );

  useCommands({});
  release.assertTagAbsent("v1.0.29");
  assert.ok(commands.some((record) => record.args[0] === "ls-remote"));
});

test("renderPrBody spells out the release checklist and the changelog section", () => {
  const body = release.renderPrBody("1.0.29", "- fix(sidebar)：某条更新");

  assert.match(body, /^## What$/m);
  assert.match(body, /发布 1\.0\.29/);
  assert.match(body, /bun scripts\/release\.ts finish 1\.0\.29/);
  assert.match(body, /## Testing/);
  assert.match(body, /- \[x\] `bun test` 通过/);
  assert.match(body, /## 发布内容\n\n- fix\(sidebar\)：某条更新/);
});

test("cmdPrepare dry run stops before writing when the changelog has nothing unreleased", () => {
  useCommands({});

  // promoteChangelog 直接抛错：它描述的是更新记录本身不成立，不是「用法错误」。
  assert.throws(() => release.cmdPrepare("patch", true), /段落是空的/);
  assert.ok(
    commands.some((record) => record.args[0] === "check-ignore"),
    "the worktree ignore rule is checked",
  );
});

test("cmdPrepare refuses a package version that drifted from the latest tag", () => {
  useCommands({ describe: "v0.0.1" });

  const message = expectFailure(() => release.cmdPrepare("patch", true));
  assert.match(message, /与最新标签 v0\.0\.1 不一致/);
});

test("cmdPrepare refuses a target that is not greater than the latest tag", () => {
  useCommands({});

  const message = expectFailure(() => release.cmdPrepare(PACKAGE_VERSION, true));
  assert.match(message, /必须大于最新标签/);
});

test("cmdPrepare refuses a repository where .worktrees is not ignored", () => {
  useCommands({ checkIgnore: 1 });

  assert.match(
    expectFailure(() => release.cmdPrepare("patch", true)),
    /没有被 Git 忽略/,
  );
});

test("watchCI returns once every run completed successfully", () => {
  useCommands({
    ciRuns: [
      [
        { databaseId: 1, name: "test", status: "completed", conclusion: "success" },
        { databaseId: 2, name: "lint", status: "completed", conclusion: "skipped" },
      ],
    ],
  });

  const output = captureConsole(() => release.watchCI("0123456789abcdef", "owner/repo"));
  assert.match(output, /CI 全部通过（2 条运行）/);
});

test("watchCI waits for pending runs and reports progress once", () => {
  Bun.sleepSync = () => {};
  useCommands({
    ciRuns: [
      [{ databaseId: 7, name: "build", status: "in_progress", conclusion: null }],
      [{ databaseId: 7, name: "build", status: "completed", conclusion: "success" }],
    ],
  });

  const output = captureConsole(() => release.watchCI("0123456789abcdef", "owner/repo"));
  assert.match(output, /CI 进行中：0\/1/);
  assert.match(output, /CI 全部通过（1 条运行）/);
});

test("watchCI waits for CI to start when no run is listed yet", () => {
  Bun.sleepSync = () => {};
  useCommands({
    ciRuns: [[], [{ databaseId: 9, name: "test", status: "completed", conclusion: "success" }]],
  });

  const output = captureConsole(() => release.watchCI("0123456789abcdef", "owner/repo"));
  assert.match(output, /等待 CI 启动…/);
  assert.match(output, /CI 全部通过（1 条运行）/);
});

test("watchCI exits with the failing run's URL", () => {
  useCommands({
    ciRuns: [[{ databaseId: 314, name: "test", status: "completed", conclusion: "failure" }]],
  });

  const message = expectFailure(() => release.watchCI("0123456789abcdef", "owner/repo"));
  assert.match(message, /CI 未通过/);
  assert.match(message, /test：failure https:\/\/github\.com\/owner\/repo\/actions\/runs\/314/);
});

test("watchCI treats a failing gh invocation as 'no runs yet'", () => {
  Bun.sleepSync = () => {};
  let call = 0;
  respond = () => {
    call += 1;
    if (call === 1) return result(1, "", "gh: not authenticated\n");
    return result(0, JSON.stringify([{ databaseId: 1, name: "test", status: "completed", conclusion: "success" }]));
  };

  const output = captureConsole(() => release.watchCI("0123456789abcdef", "owner/repo"));
  assert.match(output, /等待 CI 启动…/);
  assert.match(output, /CI 全部通过（1 条运行）/);
});

test("cmdFinish dry run prints the tag plan without tagging anything", () => {
  useCommands({});

  const output = captureConsole(() => release.cmdFinish(`v${PACKAGE_VERSION}`, true));
  assert.match(output, /提交：01234567/);
  assert.match(output, new RegExp(`标签：v${PACKAGE_VERSION.replace(/\./g, "\\.")}`));
  assert.match(output, /仓库：owner\/repo/);
  assert.match(output, /发布说明：/);
  assert.match(output, /只做检查，没有打标签、没有推送/);
  assert.ok(!commands.some((record) => record.args[0] === "tag"), "a dry run must not create the tag");
});

test("cmdFinish pushes the tag and then watches CI", () => {
  useCommands({ ciRuns: [[{ databaseId: 5, name: "test", status: "completed", conclusion: "success" }]] });

  const output = captureConsole(() => release.cmdFinish(PACKAGE_VERSION, false));
  assert.match(output, new RegExp(`已推出 v${PACKAGE_VERSION.replace(/\./g, "\\.")}`));
  assert.match(output, /发布完成/);
  const tagCall = commands.find((record) => record.args[0] === "tag");
  assert.ok(tagCall, "the annotated tag is created");
  const pushCall = commands.find((record) => record.args[0] === "push");
  assert.ok(pushCall.args.includes(`refs/tags/v${PACKAGE_VERSION}`));
});

test("cmdFinish refuses a version that does not match package.json", () => {
  useCommands({});

  assert.match(
    expectFailure(() => release.cmdFinish("9.9.9", true)),
    /package\.json 的版本是/,
  );
});

test("cmdFinish refuses an invalid version string", () => {
  assert.match(
    expectFailure(() => release.cmdFinish("latest", true)),
    /版本号「latest」不合法/,
  );
});

test("cmdNotes prints the changelog section for the version", () => {
  const written = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    written.push(String(chunk));
    return true;
  };
  try {
    release.cmdNotes(PACKAGE_VERSION);
  } finally {
    process.stdout.write = originalWrite;
  }

  const output = written.join("");
  assert.ok(output.trim().length > 0, "the release notes are printed");
  assert.match(output, /^- /m);
  assert.doesNotMatch(output, /^## /m, "only the section body is printed");
});

test("cmdNotes refuses an invalid version string", () => {
  assert.match(
    expectFailure(() => release.cmdNotes("1.0")),
    /版本号「1\.0」不合法/,
  );
});
