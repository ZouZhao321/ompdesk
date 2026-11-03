import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import {
  assertStrippedGitEnv,
  gitSubprocessCalls,
  hasCreateGitEnvProperty,
  subprocessCallSiteLines,
} from "../test-support/git-env-guard.mjs";

const jiti = createJiti(import.meta.url);
const {
  buildSkillUpdateArgs,
  checkSkillUpdate,
  checkSkillUpdates,
  skillUpdateKey,
} = await jiti.import("./skill-updates.ts");

function install(overrides = {}) {
  return {
    package: "owner/repo@example-skill",
    scope: "global",
    source: "owner/repo",
    sourceType: "github",
    skillsShUrl: "https://skills.sh/owner/repo/example-skill",
    skillPath: "skills/example-skill/SKILL.md",
    versionHash: "current-hash",
    canCheckForUpdates: true,
    ...overrides,
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("compares a global lock version with the remote Git tree", async () => {
  const seen = [];
  const upToDate = await checkSkillUpdate(install(), {
    fetcher: async (url) => {
      seen.push(url);
      return jsonResponse({
        sha: "root-hash",
        tree: [{ type: "tree", path: "skills/example-skill", sha: "current-hash" }],
      });
    },
  });

  assert.equal(upToDate.state, "up-to-date");
  assert.equal(upToDate.latestVersion, "current-hash");
  assert.match(seen[0], /repos\/owner\/repo\/git\/trees\/HEAD/);

  const available = await checkSkillUpdate(install(), {
    fetcher: async () => jsonResponse({
      sha: "root-hash",
      tree: [{ type: "tree", path: "skills/example-skill", sha: "next-hash" }],
    }),
  });
  assert.equal(available.state, "update-available");
  assert.equal(available.currentVersion, "current-hash");
  assert.equal(available.latestVersion, "next-hash");
});

test("uses the repository hash for a root global skill", async () => {
  const result = await checkSkillUpdate(install({ skillPath: "SKILL.md" }), {
    fetcher: async () => jsonResponse({ sha: "next-root", tree: [] }),
  });

  assert.equal(result.state, "update-available");
  assert.equal(result.latestVersion, "next-root");
});

test("compares a project lock version with the skills.sh snapshot", async () => {
  let requestedUrl = "";
  const result = await checkSkillUpdate(install({ scope: "project" }), {
    skillsApiBase: "https://skills.test",
    fetcher: async (url) => {
      requestedUrl = url;
      return jsonResponse({ hash: "current-hash" });
    },
  });

  assert.equal(result.state, "up-to-date");
  assert.equal(
    requestedUrl,
    "https://skills.test/api/download/owner/repo/example-skill",
  );
});

test("returns unsupported without making a remote request", async () => {
  let called = false;
  const result = await checkSkillUpdate(
    install({ canCheckForUpdates: false, versionHash: undefined }),
    { fetcher: async () => { called = true; return jsonResponse({}); } },
  );

  assert.equal(result.state, "unsupported");
  assert.equal(called, false);
});

test("returns a scoped error when the remote check fails", async () => {
  const result = await checkSkillUpdate(install(), {
    fetcher: async () => jsonResponse({}, 503),
  });

  assert.equal(result.state, "error");
  assert.equal(result.message, "HTTP 503");
  assert.equal(skillUpdateKey(install()), "global\0owner/repo@example-skill");
});

test("falls back to Git when the GitHub API is rate limited", async () => {
  let resolved = false;
  const result = await checkSkillUpdate(install(), {
    fetcher: async () => jsonResponse({}, 403),
    resolveGitTreeHash: async () => {
      resolved = true;
      return "next-hash";
    },
  });

  assert.equal(resolved, true);
  assert.equal(result.state, "update-available");
  assert.equal(result.latestVersion, "next-hash");
});

test("builds Pi-only update commands for each scope", () => {
  assert.deepEqual(buildSkillUpdateArgs(install()), [
    "skills",
    "add",
    "owner/repo/skills/example-skill",
    "--skill",
    "example-skill",
    "-y",
    "--agent",
    "claude-code",
    "-g",
  ]);
  assert.deepEqual(buildSkillUpdateArgs(install({ scope: "project" })), [
    "skills",
    "add",
    "owner/repo/skills/example-skill",
    "--skill",
    "example-skill",
    "-y",
    "--agent",
    "claude-code",
  ]);
  assert.deepEqual(buildSkillUpdateArgs(install({ ref: "release/v2" })), [
    "skills",
    "add",
    "owner/repo/skills/example-skill#release%2Fv2",
    "--skill",
    "example-skill",
    "-y",
    "--agent",
    "claude-code",
    "-g",
  ]);
});

test("reuses one remote request for skills from the same GitHub source", async () => {
  let requests = 0;
  const results = await checkSkillUpdates([
    install(),
    install({
      package: "owner/repo@another-skill",
      skillPath: "skills/another-skill/SKILL.md",
      versionHash: "another-hash",
    }),
  ], {
    fetcher: async () => {
      requests++;
      return jsonResponse({
        sha: "root-hash",
        tree: [
          { type: "tree", path: "skills/example-skill", sha: "current-hash" },
          { type: "tree", path: "skills/another-skill", sha: "another-hash" },
        ],
      });
    },
  });

  assert.equal(requests, 1);
  assert.deepEqual(results.map((item) => item.state), ["up-to-date", "up-to-date"]);
});

test("Git 回退的每次子进程调用都使用剥离后的 Git 环境", () => {
  // 钩子注入的 GIT_DIR、对象目录与配置参数会盖过 `--git-dir=<临时仓库>`：每次调用
  // 都必须显式传 createGitEnv()，漏一处回退检查就会读到钩子仓库。
  const source = readFileSync(new URL("./skill-updates.ts", import.meta.url), "utf8");
  const calls = gitSubprocessCalls(source, "skill-updates.ts");

  // 扫描器只认首参为字面量 `"git"` 的调用，首参存进变量的新调用它一条也扫不到：只数
  // 识别到的条数会在漏扫时照样通过。逐调用点核对模块里每个子进程调用都被扫到；清单按
  // `SUBPROCESS_ENTRY_POINTS` 与本地别名建，模块改用 `spawn`、`execFileSync` 也算数。
  // 扫描结果与调用点清单同时为空时下面的比对也会通过：先钉住模块里确有 Git 回退调用点，
  // 扫描器认不出它们时在这里失败，而不是让「剥离后的环境」守卫空转。
  assert.ok(
    calls.length > 0,
    "Git 回退调用点必须被扫描到：skill-updates.ts 里的子进程调用一条都没扫到，"
      + "守卫等于空转；先确认扫描器还能认出这些调用",
  );
  assert.deepEqual(
    calls.map((call) => call.line),
    subprocessCallSiteLines(source, "skill-updates.ts"),
    "skill-updates.ts 的每个子进程调用都必须以字面量 \"git\" 起首并被扫描到"
      + "（本模块只起 git 子进程）；新增 git 调用还要传 env: createGitEnv()，"
      + "首参存进变量的话请改回字面量",
  );
  assertStrippedGitEnv(calls, "skill-updates.ts");
});

test("源码扫描认得共享的 options 变量，也只挑 git 调用", () => {
  const source = [
    "const gitOptions = { timeout: 1000, env: createGitEnv() };",
    'await execFileAsync("git", ["status"], gitOptions);',
    'await execFileAsync("git", ["diff"], { env: createGitEnv() });',
    'await execFileAsync("git", ["log"], { timeout: 1000 });',
    'await execFileAsync("node", ["-v"], gitOptions);',
  ].join("\n");

  const calls = gitSubprocessCalls(source);

  // 只留下三条 git 调用；第三条没有剥离环境，必须被判成不合格。
  assert.deepEqual(calls.map((call) => call.line), [2, 3, 4]);
  assert.deepEqual(calls.map((call) => call.options !== null), [true, true, true]);
  assert.deepEqual(calls.map((call) => hasCreateGitEnvProperty(call.options)), [true, true, false]);
});

test("源码扫描按首参认 git，不认函数名", () => {
  // 换名字的包装（`spawn`、`execFileSync`）、指向包装的别名、模板字面量与 `exec` 那种
  // options 在第二位的形状都要扫到；`"git"` 存进变量再传的调用 AST 追不到，靠模块清单兜底。
  const source = [
    'spawn("git", ["status"], { env: createGitEnv() });',
    'execFileSync("git", ["diff"], { env: createGitEnv() });',
    'exec(`git`, { env: createGitEnv() });',
    'await run("git", ["log"], gitOptions);',
    "const gitOptions = { env: createGitEnv() };",
    'await run(GIT, ["log"], { env: createGitEnv() });',
    'runSync("node", ["-v"], { env: createGitEnv() });',
  ].join("\n");

  const calls = gitSubprocessCalls(source);

  assert.deepEqual(calls.map((call) => call.line), [1, 2, 3, 4]);
  assert.deepEqual(calls.map((call) => call.options !== null), [true, true, true, true]);
  assert.deepEqual(
    calls.map((call) => hasCreateGitEnvProperty(call.options)),
    [true, true, true, true],
  );
});

test("源码扫描按作用域解析同名的 options 变量", () => {
  // 同名声明出现在不同块里时各归各的作用域。按名字建一张全局表会让后出现的声明盖掉
  // 前面的，块内没剥离环境的调用就会被外层那份合规声明判成合规。
  const source = [
    "const gitOptions = { env: createGitEnv() };",
    "{",
    "  const gitOptions = { timeout: 1000 };",
    '  execFileSync("git", ["status"], gitOptions);',
    "}",
    'execFileSync("git", ["diff"], gitOptions);',
  ].join("\n");

  const calls = gitSubprocessCalls(source);

  assert.deepEqual(calls.map((call) => call.line), [4, 6]);
  assert.deepEqual(
    calls.map((call) => hasCreateGitEnvProperty(call.options)),
    [false, true],
    "块内的声明只作用于块内，块外的调用仍取文件级那份",
  );
});

test("源码扫描不拿兄弟作用域里的同名声明充数", () => {
  // 调用所在的作用域链上没有这份声明时，扫描器认不出它的初始值；宁可判成「没传 options」
  // 让断言失败，也不能猜一份别处的声明当作合规依据。
  const source = [
    "{",
    "  const gitOptions = { env: createGitEnv() };",
    "  useOptions(gitOptions);",
    "}",
    "{",
    '  execFileSync("git", ["log"], gitOptions);',
    "}",
  ].join("\n");

  const calls = gitSubprocessCalls(source);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options, null);
});

test("调用点清单覆盖全部子进程入口与本地别名", () => {
  // 首参存进变量的调用扫描器追不到：模块级断言必须按调用点核对，只数识别到的条数
  // 会在漏扫时照样通过。清单同样不能只钉一个入口名，否则模块改用 `spawn` 后合规调用
  // 会被判成漏扫。
  const source = [
    'await execFile("git", ["status"], { env: createGitEnv() });',
    'spawn("git", ["diff"], { env: createGitEnv() });',
    'cp.execFileSync("git", ["log"], { env: createGitEnv() });',
    "const execFileAsync = promisify(execFile);",
    "const gitBinary = process.env.GIT_BINARY;",
    'await execFileAsync(gitBinary, ["status"], { env: createGitEnv() });',
  ].join("\n");

  assert.deepEqual(subprocessCallSiteLines(source), [1, 2, 3, 6]);
  // 第 6 行首参存进变量的调用扫描器认不到，清单里这一条就是漏扫的证据。
  assert.deepEqual(gitSubprocessCalls(source).map((call) => call.line), [1, 2, 3]);
});
