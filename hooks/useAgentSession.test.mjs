import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
const chatWindowSource = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");

test("keeps the session event stream open through the idle grace window", () => {
  const finishSource = source.slice(
    source.indexOf("const finishPromptWithoutStream"),
    source.indexOf("const waitForPromptSettlement"),
  );
  const graceSource = source.slice(
    source.indexOf("const scheduleEventStreamClose"),
    source.indexOf("const finishPromptWithoutStream"),
  );
  const agentEndSource = source.slice(
    source.indexOf('case "agent_end"'),
    source.indexOf('case "agent_settled"'),
  );
  const agentStartSource = source.slice(
    source.indexOf('case "agent_start"'),
    source.indexOf('case "agent_end"'),
  );
  const agentSettledSource = source.slice(
    source.indexOf('case "agent_settled"'),
    source.indexOf('case "prompt_done"'),
  );
  const promptDoneSource = source.slice(
    source.indexOf('case "prompt_done"'),
    source.indexOf('case "prompt_error"'),
  );
  const sendSource = source.slice(
    source.indexOf("  const handleSend = useCallback"),
    source.indexOf("  const executeBash = useCallback"),
  );

  assert.match(source, /const EVENT_STREAM_IDLE_GRACE_MS = 30_000/);
  assert.match(graceSource, /setTimeout\(\(\) => void checkServerIdle\(\), EVENT_STREAM_IDLE_GRACE_MS\)/);
  assert.match(graceSource, /fetch\(`\/api\/agent\/\$\{encodeURIComponent\(requestedRuntimeId \?\? sid\)\}`\)/);
  assert.match(graceSource, /closeEvents\(\)/);
  assert.match(finishSource, /scheduleEventStreamClose\(sid\)/);
  assert.doesNotMatch(finishSource, /closeEvents\(\)/);
  assert.doesNotMatch(agentEndSource, /closeEvents\(\)/);
  assert.match(agentStartSource, /cancelEventStreamGrace\(\)/);
  assert.match(agentSettledSource, /scheduleEventStreamClose\(sid\)/);
  assert.match(agentSettledSource, /onAgentEnd\?\.\(sessionIdRef\.current \?\? undefined\)/);
  assert.match(promptDoneSource, /notifyPromptStage\(runId\)/);
  assert.match(promptDoneSource, /scheduleEventStreamClose\(sid\)/);
  assert.match(sendSource, /const definitivelyRejected = !promptRequestStarted \|\| isPromptRejectedError\(e\)/);
  assert.match(sendSource, /if \(!definitivelyRejected && sentSessionId\) \{[\s\S]*?waitForPromptSettlement/);
  assert.match(sendSource, /if \(!definitivelyRejected && sentSessionId\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?closeEvents\(\)/);
});

test("reuses an open event stream and hides an empty agent phase", () => {
  const ensureSource = source.slice(
    source.indexOf("const ensureEventsConnected"),
    source.indexOf("const respondToExtensionUi"),
  );

  assert.match(ensureSource, /eventSourceSessionIdRef\.current === sid/);
  assert.match(ensureSource, /current\.readyState === EventSource\.OPEN/);
  assert.match(ensureSource, /attempt\?\.source === current && attempt\.pending/);
  assert.match(chatWindowSource, /agentRunning && !streamState\.streamingMessage && agentPhase/);
  assert.match(chatWindowSource, /return null;/);
});

test("plays the enabled sound once for each extension dialog", () => {
  assert.match(chatWindowSource, /soundedExtensionDialogIdRef = useRef<string \| null>\(null\)/);
  assert.match(
    chatWindowSource,
    /soundedExtensionDialogIdRef\.current === extensionDialog\.id/,
  );
  assert.match(chatWindowSource, /soundedExtensionDialogIdRef\.current = extensionDialog\.id/);
  assert.match(chatWindowSource, /playDoneSoundRef\.current\(\)/);
});

test("keeps completed subagents in the session history", () => {
  assert.match(source, /function mergeSubagentSnapshots/);
  assert.match(source, /const finished: SubagentSnapshot/);
  assert.match(source, /progress: previous\?\.progress \? \{ \.\.\.previous\.progress, status: terminalStatus \}/);
  assert.doesNotMatch(source, /payload\.status !== "started"\) \{\s*setSubagents\(\(previous\) => previous\.filter/);
});

test("routes blocking extension requests through deduplicated browser attention notifications", () => {
  const completionSource = appShellSource.slice(
    appShellSource.indexOf("  const handleAgentEnd = useCallback"),
    appShellSource.indexOf("  const handleAttentionNeeded = useCallback"),
  );
  const extensionRequestSource = source.slice(
    source.indexOf("  const handleExtensionUiRequest = useCallback"),
    source.indexOf("  const settleUiStage = useCallback"),
  );
  const attentionSource = appShellSource.slice(
    appShellSource.indexOf("  const handleAttentionNeeded = useCallback"),
    appShellSource.indexOf("  const handleAutoName = useCallback"),
  );

  assert.match(
    extensionRequestSource,
    /isBlockingExtensionUiRequest\(request\)[\s\S]*?onAttentionNeeded\?\.\(request\)/,
  );
  assert.match(chatWindowSource, /onAttentionNeeded, onSessionCreated/);
  assert.match(completionSource, /if \(!shouldShowBrowserNotification\(\)\) return/);
  assert.match(attentionSource, /shouldShowBrowserNotification\(\)/);
  assert.match(attentionSource, /claimExtensionAttentionNotification\(request, notifiedAttentionRequestIdsRef\.current\)/);
  assert.match(attentionSource, /tag: `pi-extension-ui:\$\{request\.id\}`/);
  assert.match(appShellSource, /onAttentionNeeded=\{handleAttentionNeeded\}/);
});


test("/fork is consumed locally and surfaces server resolution errors", () => {
  const forkCaseSource = source.slice(
    source.indexOf('case "fork":'),
    source.indexOf('case "goal":', source.indexOf('case "fork":')),
  );

  assert.match(source, /case "fork": \{/);
  assert.match(forkCaseSource, /const result = await handleFork\(\);/);
  assert.doesNotMatch(forkCaseSource, /messages|entryIds|newestUserEntryId/);
  assert.match(forkCaseSource, /complete\(\{ handled: true, error: result\.error \?\? "Fork failed" \}\)/);
  assert.match(forkCaseSource, /complete\(\{ handled: true, message: "Forked a new session" \}\)/);
  // Every branch returns handled, so /fork never reaches the SDK fallback that
  // forwards the message as an LLM prompt — the case ends in a handled return
  // and yields to the next explicit case, not the default bridge.
  assert.doesNotMatch(forkCaseSource, /execute_slash_command/);
  assert.doesNotMatch(forkCaseSource, /type: "prompt"/);
  assert.match(source, /case "fork":[\s\S]*?return complete\(\{ handled: true, message: "Forked a new session" \}\);\s*\}\s*case "goal": \{/);
});

test("fork navigation selects the new session id from the RPC result", () => {
  const forkSource = source.slice(
    source.indexOf("const handleFork = useCallback"),
    source.indexOf("const handleNavigate = useCallback"),
  );

  assert.match(forkSource, /const handleFork = useCallback\(async \([\s\S]*?entryId\?: string,[\s\S]*?Promise<\{ forked: boolean; error\?: string \}>/);
  assert.match(forkSource, /type: "fork"/);
  assert.match(forkSource, /\.\.\.\(entryId \? \{ entryId \} : \{\}\)/);
  assert.match(forkSource, /const \{ cancelled, newSessionId \} = result \?\? \{\};/);
  assert.match(forkSource, /if \(!cancelled && newSessionId\) \{/);
  assert.match(forkSource, /onSessionForked\?\.\(newSessionId\);\s*\n\s*return \{ forked: true \};/);
  assert.match(forkSource, /error: e instanceof Error \? e\.message : String\(e\)/);
  assert.match(forkSource, /setForkingEntryId\(null\)/);
});

test("/handoff forwards the focus text verbatim and keeps the UI busy", () => {
  const handoffCaseSource = source.slice(
    source.indexOf('case "handoff":'),
    source.indexOf("default: {", source.indexOf('case "handoff":')),
  );

  assert.match(source, /case "handoff": \{/);
  // The text after /handoff is forwarded exactly as the handoff focus.
  assert.match(handoffCaseSource, /type: "handoff"/);
  assert.match(handoffCaseSource, /\.\.\.\(args \? \{ customInstructions: args \} : \{\}\)/);
  // The long oneshot generation keeps the composer busy through existing
  // agent-running state, with no new state machine.
  assert.match(handoffCaseSource, /if \(agentRunningRef\.current \|\| bashRunningRef\.current\)/);
  assert.match(handoffCaseSource, /Cannot hand off while the session is busy/);
  assert.match(handoffCaseSource, /agentRunningRef\.current = true/);
  assert.match(handoffCaseSource, /setAgentRunning\(true\)/);
  assert.match(handoffCaseSource, /agentRunningRef\.current = false/);
  assert.match(handoffCaseSource, /setAgentRunning\(false\)/);
  // Cancellation resolves locally as an error; /handoff never falls through to
  // the SDK command bridge or an LLM prompt.
  assert.match(handoffCaseSource, /if \(!result \|\| result\.cancelled\)/);
  assert.match(handoffCaseSource, /complete\(\{ handled: true, error: "Handoff cancelled" \}\)/);
  assert.doesNotMatch(handoffCaseSource, /execute_slash_command/);
  assert.doesNotMatch(handoffCaseSource, /type: "prompt"/);
  const connectIndex = handoffCaseSource.indexOf("await ensureEventsConnected(sessionIdRef.current ?? sid)");
  const dispatchIndex = handoffCaseSource.indexOf('type: "handoff"');
  assert.ok(connectIndex >= 0);
  assert.ok(dispatchIndex > connectIndex);
  assert.match(handoffCaseSource, /scheduleEventStreamClose\(finalSid\)/);
});

test("/handoff reloads the same session after an in-place compaction", () => {
  const handoffCaseSource = source.slice(
    source.indexOf('case "handoff":'),
    source.indexOf("default: {", source.indexOf('case "handoff":')),
  );

  assert.match(
    handoffCaseSource,
    /sendAgentCommand<\{ cancelled\?: boolean \}>[\s\S]*?type: "handoff"/,
  );
  // omp 18 hands off in place: the session id never changes, so success
  // reloads this transcript instead of navigating to a replacement session.
  assert.doesNotMatch(handoffCaseSource, /newSessionId/);
  assert.doesNotMatch(handoffCaseSource, /onSessionForked/);
  assert.match(handoffCaseSource, /loadSession\(sessionIdRef\.current \?\? currentSid, true\)/);
  // Every branch returns handled so the command never reaches the SDK
  // fallback — the busy state is torn down in a finally block and the case
  // yields to the default bridge with a return.
  assert.match(handoffCaseSource, /complete\(\{ handled: true, message: "Context handed off and compacted in place" \}\)/);
  assert.match(source, /case "handoff":[\s\S]*?return complete\(\{ handled: true, message: "Context handed off and compacted in place" \}\);\s*\}\s*finally \{[\s\S]*?\}\s*\}\s*default: \{/);
});

test("rehydrates handoff as busy without misreporting compaction", () => {
  assert.match(source, /isHandoffRunning\?: boolean/);
  assert.match(
    source,
    /state\.isStreaming \|\| state\.isPromptRunning \|\| state\.isCompacting \|\| state\.isHandoffRunning/,
  );
  assert.match(
    source,
    /agentState\.state\?\.isStreaming[\s\S]*?agentState\.state\?\.isPromptRunning[\s\S]*?agentState\.state\?\.isHandoffRunning/,
  );
});

test("feeds the scroll position into the follow reducer", () => {
  const scrollHandlerSource = source.slice(
    source.indexOf("const handleScrollPositionChange"),
    source.indexOf("  // Load session on mount"),
  );

  // 「上滚停止跟随、程序化滚动不算数」的判定在 lib/transcript-follow.ts，由它的
  // 逻辑测试覆盖；这里只钉住接线：滚动位置按三个字段交给判定。
  assert.match(scrollHandlerSource, /type: "scroll"/);
  assert.match(scrollHandlerSource, /userDriven: Date\.now\(\) <= userScrollIntentUntilRef\.current/);
  assert.match(scrollHandlerSource, /programmaticWindow: Date\.now\(\) < ignoreProgrammaticScrollUntilRef\.current/);
  assert.match(scrollHandlerSource, /distanceFromBottom: container\.scrollHeight - container\.scrollTop - container\.clientHeight/);
});

test("restores follow and brings the view to the end when a prompt is submitted", () => {
  const sendSource = source.slice(
    source.indexOf("  const handleSend = useCallback"),
    source.indexOf("  const executeBash = useCallback"),
  );
  const bashSource = source.slice(
    source.indexOf("  const executeBash = useCallback"),
    source.indexOf("  const handleAbort = useCallback"),
  );

  // 发送提问与执行 shell 命令都走同一条提交处置，判定在 lib/transcript-follow.ts。
  assert.match(sendSource, /applyFollowRef\.current\(\{ type: "submit" \}\)/);
  assert.match(bashSource, /applyFollowRef\.current\(\{ type: "submit" \}\)/);
  // 结论落到状态与滚动入口：恢复跟随打开列表的 followOutput，回底走列表定位。
  // 意图窗口的清理也在回底之前，由 useAgentSession.follow.test.mjs 的行为测试覆盖。
  assert.match(
    source,
    /const applyFollow = useCallback\(\(event: FollowEvent\) => \{\s*const outcome = reduceFollow\(event\);\s*if \(!outcome\) return;[\s\S]*?setAutoFollow\(!outcome\.paused\);\s*if \(outcome\.scrollToEnd\) scrollToBottom\(outcome\.scrollToEnd\);\s*\}, \[scrollToBottom, setAutoFollow\]\);/,
  );
  assert.match(chatWindowSource, /virtuosoRef\.current\?\.scrollToIndex\(\{\s*index: "LAST",\s*align: "end",/);
});

test("exposes a paused-follow flag and a jump-to-bottom action", () => {
  // 单一写入点：跟随开关只由 setAutoFollow 写，状态不会和判定漂移。
  assert.match(source, /const setAutoFollow = useCallback\(\(following: boolean\) => \{\s*setAutoFollowPaused\(/);
  assert.match(source, /const resumeAutoFollow = useCallback\(\(\) => \{\s*applyFollow\(\{ type: "resume" \}\);\s*\}, \[applyFollow\]\);/);
  // 意图窗口的清理只在 applyFollow 里做，提交与「回到底部」共用同一条前置清理。
  assert.equal(source.match(/userScrollIntentUntilRef\.current = 0/g)?.length, 1);
  assert.match(source, /autoFollowPaused, resumeAutoFollow, pauseAutoFollow,/);
  // Scrolling is the list's job: the hook hands the jump to the list handle
  // instead of touching the scroll element itself. 入口是必填的：漏接在 typecheck 暴露，
  // 不会出现状态写着「跟随中」却没有落点。
  assert.match(source, /scrollTranscriptToEnd: \(behavior: ScrollBehavior\) => void;/);
  assert.match(source, /const scrollToBottom = useCallback\(\(behavior: ScrollBehavior = "smooth"\) => \{\s*ignoreProgrammaticScrollUntilRef\.current = Date\.now\(\) \+ PROGRAMMATIC_SCROLL_IGNORE_MS;\s*scrollTranscriptToEndRef\.current\(behavior\);/);
  assert.doesNotMatch(source, /scrollTranscriptToEndRef\.current\?\./);
  assert.doesNotMatch(source, /scrollIntoView/);
  assert.doesNotMatch(source, /container\.scrollTo\(/);

  assert.match(chatWindowSource, /autoFollowPaused, resumeAutoFollow, pauseAutoFollow,/);
  assert.match(chatWindowSource, /\{sessionBusy && autoFollowPaused && \(/);
  assert.match(chatWindowSource, /onClick=\{resumeAutoFollow\}/);
});

test("renders the transcript with omp's hideThinkingBlock setting", () => {
  const messageViewSource = readFileSync(new URL("../components/MessageView.tsx", import.meta.url), "utf8");
  assert.match(messageViewSource, /const \{ hideThinkingBlock \} = useDisplaySettings\(\)/);
  assert.match(messageViewSource, /isHiddenAssistantBlock\(block, \{ isStreaming, hideThinking: hideThinkingBlock \}\)/);

  assert.match(chatWindowSource, /useSyncedDisplaySettings\(/);
  assert.match(chatWindowSource, /displayOptions = useMemo<DisplayOptions>\(\(\) => \(\{ hideThinking: hideThinkingBlock \}\)/);
  // Turn grouping has to agree with what MessageView renders, or a message
  // made only of thinking blocks leaves an empty row behind. The judgment
  // lives in lib/transcript-items.ts; the transcript only consumes its items
  // and hands its own display options to the builder.
  const transcriptItemsSource = readFileSync(new URL("../lib/transcript-items.ts", import.meta.url), "utf8");
  assert.match(chatWindowSource, /buildTranscriptItems\(messages, entryIds, \{\s*displayOptions,/);
  assert.match(transcriptItemsSource, /hasDisplayableProcessMessage\(messages\[processIdx\], displayOptions\)/);
  assert.match(transcriptItemsSource, /splitFinalAssistantBlocks\(finalAssistant, displayOptions\)/);
  assert.match(transcriptItemsSource, /findFinalAssistantIndex\(messages, anchorIndex, endIndex, displayOptions\)/);
});

test("/branch and /rewind reach the rewind plan through a normalized command name", () => {
  const dispatchSource = source.slice(
    source.indexOf("const handleBuiltinSlashCommand = useCallback"),
    source.indexOf("const handleSteer = useCallback"),
  );

  assert.match(source, /import \{[^}]*\bplanRewindCommand\b[^}]*\} from "@\/lib\/rewind"/);
  assert.match(source, /import \{[^}]*\bnormalizeRewindCommand\b[^}]*\} from "@\/lib\/rewind"/);

  // `/branch` is an alias of `/rewind`; without normalization it fell through
  // to `execute_slash_command`, which forwarded it to the model.
  const switchMatch = dispatchSource.match(/switch \(([\s\S]*?)\) \{/);
  assert.ok(switchMatch, "the builtin handler must switch on a command name");
  const switchSubject = switchMatch[1].trim();

  const normalizeIndex = dispatchSource.search(/normalizeRewindCommand\(/);
  assert.ok(normalizeIndex >= 0, "the dispatch must call normalizeRewindCommand");
  assert.ok(
    normalizeIndex < switchMatch.index,
    "the command name must be normalized before the switch",
  );

  const assignedName = dispatchSource.match(
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*normalizeRewindCommand\(commandName\)/,
  );
  const routesNormalizedName =
    /normalizeRewindCommand\(commandName\)/.test(switchSubject)
    || (assignedName !== null
      && switchSubject === assignedName[1]
      && assignedName.index < switchMatch.index);
  assert.ok(
    routesNormalizedName,
    `the switch must dispatch on the normalized name, got: ${switchSubject}`,
  );

  const rewindIndex = dispatchSource.indexOf('case "rewind":');
  assert.ok(rewindIndex >= 0, "/rewind must have a dispatch case");

  const nextCase = dispatchSource.indexOf('case "', rewindIndex + 'case "rewind":'.length);
  const defaultCase = dispatchSource.indexOf("default:", rewindIndex);
  const regionEnd = [nextCase, defaultCase]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0] ?? dispatchSource.length;
  const rewindRegion = dispatchSource.slice(rewindIndex, regionEnd);

  assert.match(rewindRegion, /planRewindCommand\(\{/);
  assert.match(rewindRegion, /agentRunning:\s*agentRunningRef\.current/);
  assert.match(rewindRegion, /bashRunning:\s*bashRunningRef\.current/);
  assert.match(
    rewindRegion,
    /return\s+(?:complete\()?[A-Za-z_$][\w$]*(?:\))?\s*;/,
    "the dispatch must return the plan result unchanged",
  );

  // Every other command keeps its own case and is never rewritten by the alias.
  const caseLabels = [...dispatchSource.matchAll(/case "([^"]+)":/g)].map((match) => match[1]);
  assert.deepEqual(caseLabels, [
    "compact",
    "reload",
    "name",
    "session",
    "copy",
    "fork",
    "goal",
    "rewind",
    "handoff",
  ]);
  assert.doesNotMatch(dispatchSource, /case "branch":/);
  assert.doesNotMatch(dispatchSource, /Cannot rewind while the session is busy/);
});
