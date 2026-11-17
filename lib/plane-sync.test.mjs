import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { LINK_SOURCE, desiredStateName, externalIdFor, planBackfill, rankItemMatches } =
  await jiti.import("./plane-sync.ts");

const pr = (number, title, state = "MERGED") => ({
  number,
  title,
  state,
  mergedAt: state === "MERGED" ? "2026-11-01T00:00:00Z" : null,
  updatedAt: "2026-11-01T00:00:00Z",
  url: `https://example.test/pull/${number}`,
});

const item = (sequenceId, name, externalId = null) => ({
  id: `id-${sequenceId}`,
  sequenceId,
  name,
  stateId: "state",
  externalId,
});

test("关联键带仓库名与编号", () => {
  assert.equal(LINK_SOURCE, "github-pr");
  assert.equal(externalIdFor("ZouZhao321/ompdesk", 160), "ZouZhao321/ompdesk#160");
});

test("PR 状态映射到三列", () => {
  assert.equal(desiredStateName(pr(1, "x", "MERGED")), "Done");
  assert.equal(desiredStateName(pr(1, "x", "OPEN")), "In Progress");
  assert.equal(desiredStateName(pr(1, "x", "CLOSED")), "Todo");
});

test("按 PR 标题给工作项排序", () => {
  const ranked = rankItemMatches("test(daemon): 无控制台下的会话导出", [
    item(190, "test(daemon): 无控制台下的会话导出"),
    item(50, "文件树：目录加载失败显示授权提示"),
  ]);
  assert.equal(ranked[0].item.sequenceId, 190);
});

test("回填跳过已有键的项", () => {
  const suggestions = planBackfill(
    [pr(1, "fix(sidebar): 归档列表翻不到最后一条")],
    [item(194, "fix(sidebar): 归档列表翻不到最后一条", "ZouZhao321/ompdesk#1")],
  );
  assert.deepEqual(suggestions, []);
});

test("回填给标题相同的项直接关联", () => {
  const suggestions = planBackfill(
    [pr(160, "fix(worktree): 统一项目根路径写法")],
    [item(193, "fix(worktree): 统一项目根路径写法")],
  );
  assert.equal(suggestions[0].verdict, "link");
  assert.equal(suggestions[0].match.pr.number, 160);
});

test("回填忽略 WIP 标记与类型前缀的差异", () => {
  const suggestions = planBackfill(
    [pr(160, "[WIP] fix(worktree): 统一项目根路径写法")],
    [item(193, "统一项目根路径写法")],
  );
  assert.equal(suggestions[0].verdict, "link");
});

test("回填对并列候选只做提示", () => {
  const suggestions = planBackfill(
    [pr(1, "同一仓库在侧栏出现两行"), pr(2, "同一仓库在列表出现两行")],
    [item(193, "同一仓库在项目列表里出现两行")],
  );
  assert.equal(suggestions[0].verdict, "review");
});

test("回填对无关标题不写", () => {
  const suggestions = planBackfill([pr(1, "feat(viewer): 图片缩放")], [item(50, "文件树：目录加载失败显示授权提示")]);
  assert.equal(suggestions[0].verdict, "none");
  assert.equal(suggestions[0].match, null);
});

test("一个 PR 只分配给一个工作项", () => {
  const suggestions = planBackfill(
    [pr(160, "fix(worktree): 统一项目根路径写法")],
    [item(193, "fix(worktree): 统一项目根路径写法"), item(194, "fix(worktree): 统一项目根路径写法（副本）")],
  );
  const linked = suggestions.filter((entry) => entry.verdict === "link");
  assert.equal(linked.length, 1);
});
