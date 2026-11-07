#!/usr/bin/env bun
/**
 * 推送前校验：先确认锁文件一致，再跑与 CI 完全相同的 `bun run ci`
 * （format → typecheck → test → build → smoke:dev）。流水线只在 package.json 里定义一次，
 * 这里不再抄一份步骤清单，避免钩子与 CI 分叉。
 *
 * 锁文件用 `bun install --frozen-lockfile --dry-run` 校验：CI 上它会真的安装，
 * 这里只确认 package.json 与 bun.lock 没有脱节，几毫秒完成，不动 node_modules。
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

const STEPS = [
	{ name: "锁文件一致性", args: ["install", "--frozen-lockfile", "--dry-run"] },
	{ name: "CI 流水线", args: ["run", "ci"] },
];

for (const step of STEPS) {
	process.stdout.write(`\n[verify] ${step.name}\n`);
	const result = spawnSync(process.execPath, step.args, {
		cwd: ROOT,
		stdio: "inherit",
		env: process.env,
	});
	if (result.status !== 0) {
		process.stderr.write(`\n[verify] ${step.name} 失败，推送中止。CI 会跑同一条流水线。\n`);
		process.exit(result.status ?? 1);
	}
}

process.stdout.write("\n[verify] 锁文件一致性与 CI 流水线全部通过\n");
