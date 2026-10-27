# ompdesk 部署

部署方式有三种：本机运行、Docker、经 Tailscale 远程访问。三种方式共用一条必须遵守的规则：ompdesk 只监听本机回环地址，外部访问一律经 Tailscale。

## 硬要求：只绑回环

- ompdesk 的监听地址固定为 `127.0.0.1`。桌面版、`ompdesk`、`bun run dev`、`bun run start` 都遵守这一条。
- 宿主机上不绑 `0.0.0.0`：不传 `--hostname 0.0.0.0`，不设 `OMPDESK_HOSTNAME=0.0.0.0`。仓库不提供局域网直连的启动脚本，`bun run dev` 与 `bun run start` 只绑回环。
- 路由器不为 30141 做端口转发，云主机安全组不放行 30141，不使用 `tailscale funnel`。
- 手机、平板、另一台电脑等非本机设备，一律经 Tailscale 转发访问，步骤见 [tailscale.md](./tailscale.md)。
- 容器是唯一例外：容器内的进程绑 `0.0.0.0`，宿主机发布端口时只发到 `127.0.0.1`。对外暴露与否按宿主机的监听地址判定，与容器内部无关。

这条要求来自 ompdesk 的能力：它能读写文件、执行命令、消耗模型额度。任何能连上端口的人都能做同样的事，因此端口的可达范围等于信任范围。

## 本机运行

```bash
bunx ompdesk@latest        # 或 bun add -g ompdesk 后运行 ompdesk
```

浏览器打开 `http://127.0.0.1:30141`。换端口用 `ompdesk --port 8080` 或 `PORT=8080 ompdesk`。桌面版与 `bun run dev`、`bun run start` 固定使用 30141。

## Docker

```bash
OMPDESK_PASSWORD='<密码>' OMP_UID=$(id -u) OMP_GID=$(id -g) docker compose up --build
```

宿主机端口发布到回环，`$HOME/.omp` 挂进容器以复用会话与配置。卷布局与 UID/GID 匹配见 [docker.md](./docker.md)。

## 远程访问

用 Tailscale 把回环端口转发进 tailnet，公网不开放任何端口：

```bash
tailscale serve --bg --tcp=30141 tcp://localhost:30141
```

手机上打开 `http://<tailnet IPv4>:30141`。完整步骤、验证命令、故障对照与安全边界见 [tailscale.md](./tailscale.md)。

## 密码

除纯本机回环访问外，任何入口都必须先设密码：设置 → Access，或 `ompdesk --authenticated`，或 `OMPDESK_PASSWORD`。未设密码时 ompdesk 以开放模式运行，能连上端口的人不需要凭据。凭据存储、恢复流程与明文传输的取舍见 [authentication.md](./authentication.md)。

## 部署后的检查

```bash
# ompdesk 的监听只在回环；出现 0.0.0.0:30141 说明违反了硬要求
netstat -ano | findstr :30141   # Windows
netstat -ano | grep 30141       # Linux / macOS
```

经 Tailscale 访问时，同一端口上还会出现一条 tailnet 地址的监听，那属于 Tailscale 进程的转发，不是 ompdesk。再执行 [tailscale.md](./tailscale.md) 里的四条验证。
