import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { coverageTestArgs, LCOV_PATH } from "./test-command.ts";

const ROOT = path.resolve(import.meta.dir, "../..");

const WORKFLOW = readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
const PACKAGE = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const SCRIPTS = PACKAGE.scripts;

/** 单个作业的文本：从 `  name:` 起到下一个同级作业止。 */
function jobBlock(yaml, name) {
  const marker = `\n  ${name}:\n`;
  const start = yaml.indexOf(marker);
  assert.notEqual(start, -1, `工作流里没有 ${name} 作业`);
  const rest = yaml.slice(start + marker.length);
  const next = rest.search(/\n  [a-z][a-z-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * 作业里真正的单行执行步骤；注释行不以 `run:` 开头，不会误收。
 * `run: |` 这类块标量只收壳（内容是多行脚本），不在这里判定。
 */
function runCommands(yaml) {
  return [...yaml.matchAll(/^\s*run:\s*(\S.*)$/gm)]
    .map((match) => match[1].trim())
    .filter((command) => command !== "|" && command !== ">");
}

/** `ci` 脚本按 `&&` 拆成有序的步骤名，`bun run ` 前缀去掉。 */
function ciSteps(script) {
  return script.split("&&").map((step) => step.trim().replace(/^bun run /, ""));
}

test("verify 作业只调用 package.json 的 ci 入口，不另抄步骤", () => {
  const commands = runCommands(jobBlock(WORKFLOW, "verify"));

  assert.deepEqual(commands, ["bun install --frozen-lockfile", "bun run ci"]);
  // 具体步骤只在 package.json 定义一次：工作流里出现任何一条都在抄第二份。
  for (const step of ciSteps(SCRIPTS.ci)) {
    assert.ok(
      !commands.some((command) => command !== "bun run ci" && command.includes(step)),
      `工作流不应直接执行 ${step}，改 package.json 的 ci 脚本`,
    );
  }
});

test("检查与本地跑同一条命令：verify、推送前钩子、两个门禁步骤都指向同一份定义", () => {
  assert.equal(SCRIPTS.verify, "bun run ci");
  assert.equal(SCRIPTS["coverage:exports"], "bun scripts/coverage-gate.mjs --exports-only");
  assert.equal(SCRIPTS["coverage:gate"], "bun scripts/coverage-gate.mjs");

  // 覆盖率的测试参数来自共享定义，脚本与 package.json 都不另写一份。
  const gateScript = readFileSync(path.join(ROOT, "scripts", "coverage-gate.mjs"), "utf8");
  assert.match(gateScript, /coverageTestArgs\(/);
  assert.doesNotMatch(SCRIPTS["coverage:gate"], /--coverage/);
  assert.doesNotMatch(SCRIPTS["coverage:exports"], /--coverage/);

  const verifyPush = readFileSync(path.join(ROOT, "scripts", "verify-push.mjs"), "utf8");
  assert.match(verifyPush, /args:\s*\["run",\s*"ci"\]/);
});

test("步骤顺序：静态引用检查在测试之前，构建与冒烟在最后", () => {
  const steps = ciSteps(SCRIPTS.ci);

  assert.deepEqual(steps, ["format", "typecheck", "coverage:exports", "coverage:gate", "build", "smoke:dev"]);
  // 只用 `&&` 串联：静态检查失败时不再跑测试，测试失败时不再构建。
  assert.doesNotMatch(SCRIPTS.ci, /\|\||;/);
});

test("整套流程只跑两次测试：本次插桩运行与分叉点基准运行", () => {
  const steps = ciSteps(SCRIPTS.ci);

  // 不插桩的 `bun test` 不进流水线：它只回答「测试过没过」，与覆盖率判定用的是两次
  // 不同的运行，结论可能互相矛盾。本地的 `bun run test` 仍然保留。
  assert.ok(!steps.includes("test"));
  assert.equal(SCRIPTS.test, "bun test");
  // 本次运行由门禁脚本自己发起，基准运行由 lib/coverage-gate/base-coverage.ts 发起，
  // 两者都用 coverageTestArgs 这一份定义。
  assert.ok(steps.includes("coverage:gate"));
});

test("覆盖率产物路径与报告读取的 lcov 相同，作为构建附件保留", () => {
  const coverageDirArg = coverageTestArgs().find((arg) => arg.startsWith("--coverage-dir="));
  assert.equal(coverageDirArg, "--coverage-dir=.tmp/coverage-gate");
  assert.equal(LCOV_PATH, `${coverageDirArg.slice("--coverage-dir=".length)}/lcov.info`);

  const upload = WORKFLOW.slice(WORKFLOW.indexOf("Upload coverage artifact"));
  assert.match(upload, /^ +path: (.+)$/m);
  assert.equal(/^ +path: (.+)$/m.exec(upload)[1].trim(), LCOV_PATH);
  assert.match(upload, /retention-days: \d+/);
  // 判定失败时产物同样要在，上传不依赖前一步结论。
  assert.match(upload, /if: always\(\)/);
});
