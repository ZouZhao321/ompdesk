## What

<!-- 改了什么。用自己的话写一句，说明行为变化涉及哪个页面或流程。 -->

## Why

<!-- 为什么改。关联 issue 时写 `fixes #N`。 -->

## Testing

<!-- 跑了哪些命令，以及实际操作了哪个界面或流程、观察到的结果。 -->

---

- [ ] `bun run typecheck` 通过
- [ ] 改动范围的 eslint 无 error（全仓 `bun run lint` 的存量 error 不算，见 CI 说明）
- [ ] `bun test` 通过
- [ ] 涉及界面的改动已在浏览器实际操作验证
