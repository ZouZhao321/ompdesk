import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import ts from "typescript";

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

/**
 * 取出源码里每个 `execFileAsync("git", ...)` 调用，解析出它的 options 对象：用
 * TypeScript 的 AST 判定，不做字符配对。注释与字符串里的同名文本不会误算，参数里的
 * 括号也不会截断文本；正则扫源码则会把注释里出现的 `env: createGitEnv()` 也算进去，
 * 漏掉写在共享 options 变量里的那几处。
 */
function gitExecFileCalls(source) {
  const sourceFile = ts.createSourceFile(
    "skill-updates.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = new Map();
  const collectDeclarations = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      declarations.set(node.name.text, node);
    }
    ts.forEachChild(node, collectDeclarations);
  };
  collectDeclarations(sourceFile);

  const calls = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "execFileAsync"
      && ts.isStringLiteral(node.arguments[0])
      && node.arguments[0].text === "git"
    ) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      calls.push({ line, options: resolveObjectLiteral(node.arguments[2], declarations) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

/** 把 options 参数还原成对象字面量：直接写的字面量，或同文件的同名变量声明。 */
function resolveObjectLiteral(node, declarations) {
  if (ts.isObjectLiteralExpression(node)) return node;
  if (!ts.isIdentifier(node)) return null;
  const declaration = declarations.get(node.text);
  return declaration && ts.isObjectLiteralExpression(declaration.initializer)
    ? declaration.initializer
    : null;
}

/** 对象字面量里是否有 `env: createGitEnv()` 属性。 */
function hasCreateGitEnvProperty(objectLiteral) {
  return objectLiteral.properties.some((property) => {
    if (!ts.isPropertyAssignment(property)) return false;
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
      ? property.name.text
      : null;
    return name === "env"
      && ts.isCallExpression(property.initializer)
      && ts.isIdentifier(property.initializer.expression)
      && property.initializer.expression.text === "createGitEnv";
  });
}

test("Git 回退的每次子进程调用都使用剥离后的 Git 环境", () => {
  // 钩子注入的 GIT_DIR、对象目录与配置参数会盖过 `--git-dir=<临时仓库>`：三次调用
  // 都必须显式传 createGitEnv()，漏一处回退检查就会读到钩子仓库。
  const calls = gitExecFileCalls(readFileSync(new URL("./skill-updates.ts", import.meta.url), "utf8"));

  assert.equal(calls.length, 3, "回退检查共三次 git 调用");
  for (const { line, options } of calls) {
    assert.ok(options, `第 ${line} 行的 git 调用必须传 options 对象字面量`);
    assert.ok(hasCreateGitEnvProperty(options), `第 ${line} 行的 git 调用要传剥离后的环境 env: createGitEnv()`);
  }
});

test("源码扫描认得共享的 options 变量，也只挑 git 调用", () => {
  const source = [
    "const gitOptions = { timeout: 1000, env: createGitEnv() };",
    'await execFileAsync("git", ["status"], gitOptions);',
    'await execFileAsync("git", ["diff"], { env: createGitEnv() });',
    'await execFileAsync("git", ["log"], { timeout: 1000 });',
    'await execFileAsync("node", ["-v"], gitOptions);',
  ].join("\n");

  const calls = gitExecFileCalls(source);

  // 只留下三条 git 调用；第三条没有剥离环境，必须被判成不合格。
  assert.deepEqual(calls.map((call) => call.line), [2, 3, 4]);
  assert.deepEqual(calls.map((call) => call.options !== null), [true, true, true]);
  assert.deepEqual(calls.map((call) => hasCreateGitEnvProperty(call.options)), [true, true, false]);
});
