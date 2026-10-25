# 凭据与模型配置的写入

凭据存放在 omp 的 SQLite `agent.db` 中，通过 `AuthStorage` 访问，不在 `auth.json`。写入走命名空间方法：`authStorage.credentials.set()` / `credentials.remove()` 与 `authStorage.oauth.login()`，使 CLI 与 ompdesk 共享一个存储与一把锁。API-key 状态端点绝不返回原始 key。

提供方列表由能力驱动：`lib/provider-listing-runtime.ts` 把 catalog、OAuth 注册表与已存凭据折叠成 `lib/provider-listing.ts` 期望的扁平结构，双认证提供方因此只出现一次；`storeCredentialsAs` 与 id 不同的 OAuth 登录，用 catalog 使用的 id 作为键。

`models.yml` 是 YAML：读时依次找 `models.yml`、`models.yaml`、`models.json`，写回固定 `models.yml`。头值指向环境变量时写成裸名称（`X-Token: MY_VAR`），不写 `$MY_VAR`——omp 按精确名查环境。

任何改动凭据或 `models.yml` 的代码都必须同时调用 `invalidateOmpRuntime()` 与 `invalidateModelsCache()`。
