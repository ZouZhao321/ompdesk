# OTLP 遥测导出

ompdesk 把会话的 trace、log 与 metric 通过 OTLP 发往兼容后端（Phoenix、Jaeger、
OpenTelemetry Collector 等）。环境变量沿用 OpenTelemetry 与 omp SDK 的约定。

## 启用

- 至少配置一个端点：`OTEL_EXPORTER_OTLP_ENDPOINT`，或按信号分开的
  `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`、`OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`、
  `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`。一个端点都没有时不注册任何 provider，
  导出模块也不会加载。
- `telemetry.otlpExportEnabled` 是总开关，默认开启。它在**进程启动时**读取一次，
  改完重启才生效。
- 协议只支持 `http/protobuf`。`OTEL_EXPORTER_OTLP_PROTOCOL` 设成 `grpc`、
  `http/json` 或其他值时，该信号被拒绝并记录一条警告。
- `OTEL_SDK_DISABLED=true` 关闭全部导出；`OTEL_TRACES_EXPORTER=none`（log、
  metric 同理）按信号关闭。

## 示例

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:6006 \
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \
bun run dev
```

Phoenix 在 6006 端口接收 OTLP http/protobuf。

## 刷新时机

- 每轮对话结束（成功、失败与 goal continuation 都算）和会话关闭时立即 flush，
  新 trace 不必等 30 秒批处理窗口。
- 导出失败只写一条日志，不阻塞会话创建，也不影响对话本身。

## 消息内容

默认只导出调用结构与用量，不带 prompt 与回复文本。设
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=full`（`true`、`1`、`yes`
等价）导出完整内容；设成 `summary` 只导出有界摘要。

## 容器

`docker-compose.yml` 只透传 `environment` 里显式列出的变量。在容器里导出时，把
需要的 `OTEL_*` 变量加进该段，或用 `docker run -e OTEL_EXPORTER_OTLP_ENDPOINT=...`
启动；容器还要能访问到后端地址。
