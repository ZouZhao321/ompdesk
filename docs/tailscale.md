# 手机通过 Tailscale 访问 ompdesk

手机与电脑不在同一个 WiFi 时，用 Tailscale 建立一条私有通路访问 ompdesk。电脑上不开放任何公网端口，路由器不需要做端口转发，ompdesk 进程本身仍然只监听本机回环地址。

## 连接方式

```mermaid
flowchart LR
  phone["手机，同一 tailnet"] -->|WireGuard 加密| ts["Tailscale 虚拟网卡<br/>100.x.y.z:30141"]
  ts -->|TCP 转发| loop["127.0.0.1:30141"]
  loop --> app["ompdesk 进程"]
```

两个监听互不依赖。ompdesk 只绑回环，关掉 Tailscale 不影响本机浏览器访问；Tailscale 只做转发，ompdesk 停掉后 tailnet 入口连接失败。公网接口上没有任何监听。

## 首次设置

1. 电脑与手机安装 Tailscale，登录同一个 tailnet。手机上确认开关处于打开状态。
2. 在电脑上启动 ompdesk：桌面版、`ompdesk`、`bun run start` 或 `bun run dev` 都行。
3. 打开密码锁。这是必做项，理由见下面的安全边界：设置 → Access 设一个密码，或启动前设 `OMPDESK_PASSWORD`，或运行 `ompdesk --authenticated`。
4. 建立 tailnet 转发，`--bg` 让它重启后仍然存在：

   ```bash
   tailscale serve --bg --tcp=30141 tcp://localhost:30141
   ```

5. 在手机上打开 `http://<tailnet IPv4>:30141`。地址取电脑的 tailnet IPv4，用 `tailscale ip -4` 读取。登录用户名固定为 `omp`，密码是第 3 步设置的那个。

## 验证

在电脑上按顺序执行，前三条都符合才算配置正确。

```bash
# 1. 监听地址只有回环与 tailnet，没有 0.0.0.0
netstat -ano | findstr :30141   # Windows
netstat -ano | grep 30141       # Linux / macOS

# 2. tailnet 入口能拿到页面
curl -o /dev/null -w "%{http_code}\n" http://<tailnet IPv4>:30141/

# 3. 接口也通，不只是首页
curl -o /dev/null -w "%{http_code}\n" http://<tailnet IPv4>:30141/api/theme

# 4. 转发配置确实存在，且只对 tailnet 开放
tailscale serve status
```

第 2、3 条返回 `200`。第 1 条应看到 `127.0.0.1:30141` 的监听，以及 tailnet 的 IPv4、IPv6 监听；出现 `0.0.0.0:30141` 说明 ompdesk 绑到了所有网卡，改回回环。第 4 条的第一行末尾标着 `tailnet only`，其后是转发目标 `tcp://localhost:30141`，没有公网地址。

## 日常维护

```bash
tailscale serve status                                   # 查看当前转发
tailscale serve --bg --tcp=30141 tcp://localhost:30141   # 建立或重建 30141 的转发
tailscale serve reset                                    # 撤销本机全部转发

# 只撤掉 30141、保留其它端口：导出配置，删掉 "30141" 那一项，再写回
tailscale serve status --json > serve.json
tailscale serve set-config serve.json --all
```

`tailscale serve reset` 会一并清掉本机其它端口的转发。只撤一条时用最后两行。

转发指向的端口必须与 ompdesk 实际监听的端口一致。桌面版、`bun run dev`、`bun run start` 固定使用 30141；`ompdesk --port 8080` 与 `PORT=8080 ompdesk` 会换端口，此时转发命令里的两个 30141 都要改。

## 故障对照

- **`403 Untrusted request`**：地址里用了 MagicDNS 域名（`<machine>.<tailnet>.ts.net`）。程序只信任回环名、IP 字面量和 `OMPDESK_ALLOWED_HOSTS` 里列出的名字。直接用 tailnet IPv4 访问，或设置 `OMPDESK_ALLOWED_HOSTS=<machine>.<tailnet>.ts.net` 后重启 ompdesk。桌面版读取启动它时的环境变量。
- **`401 Authentication required`**：密码锁已开，浏览器没有带上凭据。清掉该站点的保存密码后重新输入，用户名 `omp`。
- **手机打不开，电脑本机能开**：手机 Tailscale 处于离线状态，或手机与电脑不在同一 tailnet。`tailscale status` 里能看到每台设备的在线状态。
- **页面能开但样式与热更新不生效**：用 `bun run dev` 时，Next 只允许 `next.config.ts` 中 `allowedDevOrigins` 列出的来源请求开发资源，tailnet 网段默认不在该列表里。改用 `bun run start`，或把 tailnet IPv4 加进 `allowedDevOrigins`。
- **端口被占用**：同一端口只能跑一个 ompdesk。桌面版遇到占用会直接报错退出，不会自己换端口。桌面版把启动日志写在系统临时目录的 `omp-desktop.log`，里面有实际监听的端口。先关掉占用进程。

## 安全边界

- **必须设密码。** 未设密码时 ompdesk 以开放模式运行，tailnet 里任何设备都能读写文件、执行命令，不需要任何凭据。设了密码后，经 Tailscale 进入的请求同样要过 Basic Auth。
- **隧道加密，密码不以明文经过网络。** Basic Auth 本身不加密，但整条连接在 WireGuard 内，抓包看不到密码。
- **不要用 `tailscale funnel`。** `serve` 只对 tailnet 开放，`funnel` 对整个公网开放。这里只需要 `serve`。
- **不要在路由器或云主机上放行 30141。** 本方案不需要端口转发，也不需要安全组放行。
- **tailnet 内仍按设备信任。** 任何加入 tailnet 的设备都能访问该入口，被入侵的设备同样可以。定期用 `tailscale status` 检查设备清单。

## 与局域网直连的关系

`bun run dev:lan` 把 ompdesk 绑到 `0.0.0.0`，手机在同一 WiFi 下直连。这条路径依赖防火墙放行，密码在 WiFi 上以明文传输，只在可信网络里使用。Tailscale 方案不需要放行端口，也不要求两端同网，在外网时用这条。
