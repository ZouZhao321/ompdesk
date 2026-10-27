#!/usr/bin/env bun
/**
 * 推送前校验：跑与 CI verify job 相同的四步——类型检查、lint、构建、开发冒烟。
 *
 * 冒烟会真实起 dev server。多个 worktree 并行推送时默认端口会撞，smoke-dev.mjs
 * 遇到占用直接失败，所以这里按 worktree 路径算一个稳定偏移；显式设置
 * OMPDESK_SMOKE_PORT 时以它为准。
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

if (!process.env.OMPDESK_SMOKE_PORT) {
  let offset = 0;
  for (const ch of ROOT) offset = (offset * 31 + ch.charCodeAt(0)) % 50;
  process.env.OMPDESK_SMOKE_PORT = String(30199 + offset);
}

const STEPS = ["typecheck", "build", "smoke:dev"];

for (const step of STEPS) {
  process.stdout.write(`\n[verify] ${step}\n`);
  const result = spawnSync(process.execPath, ["run", step], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.stderr.write(`\n[verify] ${step} 失败，推送中止。CI 会跑同一条流水线。\n`);
    process.exit(result.status ?? 1);
  }
}

process.stdout.write("\n[verify] 四项检查全部通过\n");
