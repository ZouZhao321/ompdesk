/**
 * 折叠开关的读取回落。
 *
 * 会话转写是否折叠压缩历史是展示项：读设置失败（agent.db 被锁、项目配置损坏）时
 * 必须按不折叠处理，不能因为一个展示开关就让整个会话读取返回 500。这里用一个
 * 无法解析项目层的 cwd 制造失败，验证 helper 不抛异常、返回 false。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { shouldCollapseCompactedHistory } = await jiti.import("./transcript-collapse.ts");

test("未配置该开关时网页端默认不折叠", async () => {
 assert.equal(await shouldCollapseCompactedHistory(undefined), false);
});

test("cwd 无法读取项目配置时回落为不折叠，不抛出", async () => {
 // Windows 上保留设备名无法作为目录打开，cloneForCwd 读取项目层会失败。
 const brokenCwd = "Z:/ompdesk-not-a-real-root/\u0000invalid";
 await assert.doesNotReject(() => shouldCollapseCompactedHistory(brokenCwd));
 assert.equal(await shouldCollapseCompactedHistory(brokenCwd), false);
});
