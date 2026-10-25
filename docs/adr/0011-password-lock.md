# 密码锁在 proxy 中校验

`bin/web-auth-store.js` 是密码锁的唯一来源，它位于 `bin/` 且使用 CommonJS：启动器在解析 Bun 之前就需要它，而发布到 npm 的 `files` 只包含 `bin`、`.next`、`public`、`next.config.ts` 与 `package.json`，`lib/` 无法承载。`bin/web-auth-store.d.ts` 是类型检查依据，两者需要同步。

密码只以 scrypt 摘要形式存放在 `<agentDir>/ompdesk-auth.json`（`0600`，原子替换），没有任何方式读回，`/recover` 与 `--reset-password` 因此存在。`proxy.ts` 运行在 Next.js 的 Node 运行时，那里可用 `node:fs` 与 `node:crypto`；它不 import omp SDK，因为 `next.config.ts` 只为服务端构建 externalize `@oh-my-pi/*`。

`resolveWebAuthPolicy()` 区分凭据文件缺失（未上锁）与不可读（`unavailable` -> 503）：把两者合并会让不可读时失败开放，静默解锁服务。成功校验缓存五分钟，键包含摘要，密码变更后缓存自动失效。`/recover` 与 `POST /api/web-access/recovery` 是仅有的未认证路径，它们仍经过主机允许列表与跨站检查，恢复码只打印在服务端 stdout。
