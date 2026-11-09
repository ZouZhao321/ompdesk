/**
 * 真实模型协议冒烟（issue #44，第 5 层）。
 *
 * 默认跳过。只在显式开关下发出一次真实请求，验证协议连通性，不读取也不比较
 * 回答内容：
 * - 一次纯文本往返：文本增量到达（流式分片被正确解析）、用量字段被记录且非零。
 * - 一次工具调用往返：工具调用参数被解析、工具真实执行、工具结果回填到下一轮
 *   上下文，会话结束后不再运行。
 *
 * 运行（默认使用配置中 `default` 角色的模型）：
 *   OMPDESK_LIVE_SMOKE=1 bun test lib/live-model-smoke.test.mjs
 *
 * 指定模型（omp 选择器语法，provider/modelId 或 modelId，可带 :thinkingLevel）：
 *   OMPDESK_LIVE_SMOKE=1 OMPDESK_LIVE_MODEL=anthropic/claude-sonnet-4-5 bun test lib/live-model-smoke.test.mjs
 *
 * 失败信息会带上实际使用的 provider 与 model id，便于定位上游接口变化。
 * 需要真实凭据：模型解析复用 ompdesk 的运行时（lib/omp-runtime.ts、
 * lib/model-roles.ts、lib/model-scope.ts），凭据来自 omp 自己的 AuthStorage。
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const ENABLE_ENV = "OMPDESK_LIVE_SMOKE";
const MODEL_ENV = "OMPDESK_LIVE_MODEL";
const TURN_TIMEOUT_MS = 90_000;
// 两轮各自可能用满单轮预算，再加 SDK/运行时初始化与清理，总预算必须更大。
const TIMEOUT_MS = 2 * TURN_TIMEOUT_MS + 60_000;
const TOOL_NAME = "ompdesk_live_smoke_ping";
const SKIP_REASON = `set ${ENABLE_ENV}=1 to call a real provider (one text roundtrip + one tool-call roundtrip)`;

/** 会话最终落在临时目录，不写用户的 ~/.omp/agent/sessions。 */
function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), "ompdesk-live-smoke-"));
  const cwd = join(root, "project");
  const sessionDir = join(root, "sessions");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  return { root, cwd, sessionDir };
}

function toolCallsOf(message) {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return [];
  return message.content.filter((block) => block && block.type === "toolCall");
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

test(
  "live model smoke: real provider text and tool-call roundtrips",
  {
    skip: process.env[ENABLE_ENV] === "1" ? false : SKIP_REASON,
    timeout: TIMEOUT_MS,
  },
  async (t) => {
    // 未启用时整段不执行：不加载 SDK、不构建运行时、不发请求。
    const [{ createAgentSession, SessionManager }, { Type }, { textOf }, { createJiti }] = await Promise.all([
      import("@oh-my-pi/pi-coding-agent"),
      import("@oh-my-pi/pi-coding-agent/extensibility/legacy-typebox"),
      import("./testing/mock-session-harness.mjs"),
      import("jiti"),
    ]);
    const { parseModelPattern, getModelMatchPreferences } = await import(
      "@oh-my-pi/pi-coding-agent/config/model-resolver"
    );
    const jiti = createJiti(import.meta.url, { interopDefault: true });
    const [{ getOmpRuntime, getSettingsForCwd }, { readDefaultModelRole }, scopeModule, { getSetting }] =
      await Promise.all([
        jiti.import("./omp-runtime.ts"),
        jiti.import("./model-roles.ts"),
        jiti.import("./model-scope.ts"),
        jiti.import("./omp-settings.ts"),
      ]);
    const { resolveVisibleModels, selectInitialModelScope } = scopeModule;

    const sandbox = makeSandbox();
    let session;
    let unsubscribe;
    t.after(async () => {
      unsubscribe?.();
      try {
        await session?.dispose?.();
      } catch (error) {
        console.warn(`[live-smoke] session dispose failed: ${messageOf(error)}`);
      }
      try {
        rmSync(sandbox.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch (error) {
        // Windows 上 SDK 仍持有临时目录内的句柄时不要翻转测试结果。
        console.warn(`[live-smoke] left behind ${sandbox.root} (${error.code})`);
      }
    });

    const runtime = await getOmpRuntime();
    const settings = await getSettingsForCwd(sandbox.cwd);
    const scope = await resolveVisibleModels(runtime.modelRegistry, getSetting(settings, "enabledModels"), settings);

    // 选择器复用 omp 的解析器（与 enabledModels 相同的语法与模糊匹配），未知模式
    // 直接失败，不退回猜测出来的模型。
    const override = process.env[MODEL_ENV]?.trim();
    let requestedModel;
    let requestedThinkingLevel;
    if (override) {
      const parsed = parseModelPattern(override, [...scope.visible], getModelMatchPreferences(settings));
      if (!parsed.model) {
        throw new Error(
          `[live-smoke] ${MODEL_ENV}="${override}" matched no model in the enabled scope` +
            `${parsed.warning ? ` (${parsed.warning})` : ""}`,
        );
      }
      requestedModel = { provider: parsed.model.provider, modelId: parsed.model.id };
      requestedThinkingLevel = parsed.thinkingLevel;
    }

    const defaultRole = readDefaultModelRole(settings);
    const selection = selectInitialModelScope(scope, {
      ...(requestedModel ? { requestedModel } : {}),
      ...(defaultRole ? { defaultModel: defaultRole } : {}),
      ...(requestedThinkingLevel ? { thinkingLevel: requestedThinkingLevel } : {}),
    });
    const model = selection.model;
    if (!model) {
      throw new Error(
        `[live-smoke] no model resolved to smoke-test: ${MODEL_ENV}=${override ?? "(unset)"}, ` +
          `default role model=${defaultRole ? `${defaultRole.provider}/${defaultRole.modelId}` : "(unset)"}, ` +
          `visible models=${scope.visible.length}`,
      );
    }
    const label = `[live-smoke ${model.provider}/${model.id}]`;

    assert.notEqual(
      model.supportsTools,
      false,
      `${label} does not support tool calls; point ${MODEL_ENV} at a tool-capable model`,
    );

    const toolInvocations = [];
    const customTool = {
      name: TOOL_NAME,
      label: "Live smoke ping",
      description: "Echoes the requested nonce back to the caller.",
      parameters: Type.Object({
        nonce: Type.String({ description: "Opaque nonce the tool must echo back." }),
      }),
      async execute(toolCallId, params) {
        toolInvocations.push({ toolCallId, nonce: params.nonce });
        return {
          content: [{ type: "text", text: `nonce=${params.nonce}` }],
          details: { nonce: params.nonce },
        };
      },
    };

    const sessionManager = SessionManager.create(sandbox.cwd, sandbox.sessionDir);
    const created = await createAgentSession({
      cwd: sandbox.cwd,
      // 隔离刻意只做一半：真实模型需要真实凭据，所以 agentDir 指向用户的
      // ~/.omp/agent；只有会话文件落在临时目录。mock 层连 agentDir 一起隔离。
      agentDir: runtime.agentDir,
      authStorage: runtime.authStorage,
      modelRegistry: runtime.modelRegistry,
      settings,
      sessionManager,
      model,
      ...(selection.thinkingLevel ? { thinkingLevel: selection.thinkingLevel } : {}),
      ...(selection.scopedModels.length > 0 ? { scopedModels: selection.scopedModels } : {}),
      // 只保留一个自定义工具：模型没有别的工具可挑，工具调用往返因此可控。
      customTools: [customTool],
      toolNames: [TOOL_NAME],
      restrictToolNames: true,
      allowRestrictedCustomTools: true,
      autoApprove: true,
      hasUI: false,
      disableExtensionDiscovery: true,
      enableMCP: false,
      enableIrc: false,
      enableLsp: false,
      cacheWarming: false,
      systemPrompt: "You are a connectivity smoke-test client. Follow the instruction about tools exactly.",
      skills: [],
      rules: [],
      contextFiles: [],
      promptTemplates: [],
      slashCommands: [],
    });
    session = created.session;
    // 真实 provider 的 429/5xx 会触发 SDK 退避重试，把失败拖成“超时”并掩盖真实原因。
    session.setAutoRetryEnabled(false);
    // 收窄到唯一自定义工具，并断言隔离真的生效：选项名或语义失效时不能让
    // 真实请求带着内置工具（bash、写文件等）运行。
    await session.setActiveToolsByName([TOOL_NAME]);
    assert.deepEqual(
      [...session.getActiveToolNames()].sort(),
      [TOOL_NAME],
      `${label} session is not isolated to ${TOOL_NAME}; ` +
        `active tools = ${JSON.stringify(session.getActiveToolNames())}`,
    );

    const events = [];
    unsubscribe = session.subscribe((event) => {
      events.push(event);
    });

    /** 等待一轮 prompt 完全 settle；超时信息同样带 provider 与 model id。 */
    async function runTurn(step, prompt) {
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`no completion within ${TURN_TIMEOUT_MS} ms; the provider never settled the turn`)),
          TURN_TIMEOUT_MS,
        );
      });
      try {
        await Promise.race([
          (async () => {
            const dispatched = await session.prompt(prompt);
            if (dispatched !== true) {
              throw new Error("the session handled the prompt locally instead of dispatching it to the provider");
            }
            await session.waitForIdle();
          })(),
          deadline,
        ]);
      } catch (error) {
        // 超时/失败时中止仍在飞行的请求，避免 dispose 被挂起的 provider 调用拖到外层超时。
        try {
          await session.abort?.();
        } catch {
          // 已经在失败路径上，取消失败不覆盖原始错误。
        }
        const lastAssistant = session.messages.filter((message) => message.role === "assistant").at(-1);
        const providerState = lastAssistant?.stopReason
          ? `; last assistant stopReason=${lastAssistant.stopReason}` +
            `${lastAssistant.errorMessage ? ` errorMessage=${lastAssistant.errorMessage}` : ""}`
          : "";
        throw new Error(`${label} ${step} failed: ${messageOf(error)}${providerState}`, { cause: error });
      } finally {
        clearTimeout(timer);
      }
    }

    function assertProviderOk(message, step) {
      assert.notEqual(
        message.stopReason,
        "error",
        `${label} ${step}: provider returned an error: ${message.errorMessage ?? "(no errorMessage)"}`,
      );
    }

    function assertUsage(usage, step) {
      // 部分网关把输入全部记为 cacheRead，按总量断言才能覆盖「输入 tokens 非零」。
      const inputTokens = (usage?.input ?? 0) + (usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0);
      assert.ok(
        inputTokens > 0,
        `${label} ${step}: usage reported no input tokens ` +
          `(input=${usage?.input ?? 0}, cacheRead=${usage?.cacheRead ?? 0}, cacheWrite=${usage?.cacheWrite ?? 0})`,
      );
      assert.ok(
        (usage?.output ?? 0) > 0,
        `${label} ${step}: usage reported no output tokens (output=${usage?.output ?? 0})`,
      );
    }

    // 第一轮：纯文本往返。不比较回答内容，只要求文本块存在且流式增量被解析。
    const textEventsStart = events.length;
    await runTurn("text roundtrip", "Reply with one short sentence about connectivity. Do not use any tools.");
    const textAssistant = session.messages.filter((message) => message.role === "assistant").at(-1);
    assert.ok(textAssistant, `${label} text roundtrip: no assistant message was recorded`);
    assertProviderOk(textAssistant, "text roundtrip");
    assertUsage(textAssistant.usage, "text roundtrip");
    assert.ok(
      textOf(textAssistant).trim().length > 0,
      `${label} text roundtrip: the assistant message carried no text blocks`,
    );
    const textDeltas = events
      .slice(textEventsStart)
      .filter(
        (event) =>
          event.type === "message_update" &&
          event.assistantMessageEvent?.type === "text_delta" &&
          (event.assistantMessageEvent.delta ?? "").length > 0,
      );
    assert.ok(
      textDeltas.length > 0,
      `${label} text roundtrip: no non-empty text_delta events, so streaming chunks were not parsed`,
    );

    // 第二轮：工具调用往返。nonce 让「参数被解析」与「结果被回填」都可观察。
    const nonce = `smoke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const toolEventsStart = events.length;
    await runTurn(
      "tool-call roundtrip",
      `Call the ${TOOL_NAME} tool exactly once with nonce "${nonce}". Do not write a prose answer.`,
    );
    assert.ok(
      toolInvocations.length > 0,
      `${label} tool-call roundtrip: ${TOOL_NAME} never executed, so the model returned no usable tool call`,
    );
    assert.equal(
      toolInvocations[0].nonce,
      nonce,
      `${label} tool-call roundtrip: ${TOOL_NAME} received nonce ${JSON.stringify(toolInvocations[0].nonce)} ` +
        `instead of ${JSON.stringify(nonce)} across ${toolInvocations.length} execution(s)`,
    );

    const messages = session.messages;
    const toolTurnStart = messages.findIndex((message) => message.role === "user" && textOf(message).includes(nonce));
    assert.ok(toolTurnStart >= 0, `${label} tool-call roundtrip: the tool prompt was not recorded in the transcript`);
    const lastToolTurnAssistant = messages
      .slice(toolTurnStart)
      .filter((message) => message.role === "assistant")
      .at(-1);
    if (lastToolTurnAssistant) assertProviderOk(lastToolTurnAssistant, "tool-call roundtrip");

    const toolCallIndex = messages.findIndex(
      (message, index) =>
        index > toolTurnStart &&
        message.role === "assistant" &&
        toolCallsOf(message).some((block) => block.name === TOOL_NAME),
    );
    assert.ok(
      toolCallIndex >= 0,
      `${label} tool-call roundtrip: no assistant message carried a ${TOOL_NAME} tool call`,
    );
    const toolCallMessage = messages[toolCallIndex];
    const toolCall = toolCallsOf(toolCallMessage).find((block) => block.name === TOOL_NAME);
    assertProviderOk(toolCallMessage, "tool-call turn");
    assertUsage(toolCallMessage.usage, "tool-call turn");
    assert.equal(
      toolCall.arguments?.nonce,
      nonce,
      `${label} tool-call roundtrip: the streamed tool-call arguments did not carry the requested nonce ` +
        `(arguments=${JSON.stringify(toolCall.arguments)})`,
    );

    const resultIndex = messages.findIndex(
      (message, index) => index > toolCallIndex && message.role === "toolResult" && message.toolCallId === toolCall.id,
    );
    assert.ok(
      resultIndex > toolCallIndex,
      `${label} tool-call roundtrip: no toolResult was appended for toolCallId ${toolCall.id}`,
    );
    const toolResult = messages[resultIndex];
    assert.equal(
      toolResult.isError,
      false,
      `${label} tool-call roundtrip: the tool returned an error result: ${JSON.stringify(textOf(toolResult))}`,
    );
    assert.ok(
      textOf(toolResult).includes(nonce),
      `${label} tool-call roundtrip: the toolResult did not carry the tool's output`,
    );

    // 只有把 toolResult 回填进上下文，模型才会产生后续 assistant 轮次。
    const followUpIndex = messages.findIndex((message, index) => index > resultIndex && message.role === "assistant");
    assert.ok(
      followUpIndex > resultIndex,
      `${label} tool-call roundtrip: the tool result was not followed by another assistant turn, ` +
        "so it never reached the provider",
    );
    assertProviderOk(messages[followUpIndex], "tool-result follow-up turn");
    assertUsage(messages[followUpIndex].usage, "tool-result follow-up turn");

    assert.ok(
      events
        .slice(toolEventsStart)
        .some((event) => event.type === "tool_execution_end" && event.toolName === TOOL_NAME && event.isError !== true),
      `${label} tool-call roundtrip: no successful tool_execution_end event for ${TOOL_NAME}`,
    );
    assert.equal(session.isStreaming, false, `${label}: the session still reports streaming after both roundtrips`);
  },
);
