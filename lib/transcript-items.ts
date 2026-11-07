import type { AgentMessage, AssistantContentBlock, AssistantMessage, CustomMessage, ToolResultMessage } from "./types";
import {
	countToolCallBlocks,
	getAssistantErrorMessage,
	getDisplayableAssistantBlocks,
	splitFinalAssistantBlocks,
	type DisplayOptions,
} from "./message-display";
import { extractTurnWrittenFiles, type WrittenFile } from "./turn-written-files";

/** 构建条目时界面持有的输入。 */
export interface TranscriptItemsOptions {
	/** 折叠设置（hideThinking 等）。分组必须与 MessageView 的可见性判定一致。 */
	displayOptions?: DisplayOptions;
	/** 是否正在接收流式输出。 */
	isStreaming?: boolean;
	/** 会话是否忙碌（agent 或 shell 在跑）。 */
	busy?: boolean;
	/** toolCallId → 工具结果，用于判定本轮写了哪些文件。 */
	toolResults?: Map<string, ToolResultMessage>;
	/** 解析写入文件路径用的工作目录。 */
	cwd?: string;
}

/**
 * 界面上的一个渲染条目：一轮转写，或一条不属于任何分组的独立消息。
 *
 * 分组字段（`visibleProcessIndices`、`finalAssistantIndex` 等）对每一轮都会填写，
 * 包括按独立消息渲染的那几类（非锚点消息、没有正式回答的一轮、运行中的最后
 * 一轮）；`isStandalone` 只决定界面是否折叠过程组。
 */
export interface TranscriptItem {
	/** 稳定键：本轮锚点的 entryId。 */
	key: string;
	/** 本轮锚点的消息下标。 */
	anchorIndex: number;
	/** 锚点消息本身是否构成一轮（用户消息或 Compaction 摘要）。 */
	isAnchor: boolean;
	/** 锚点之后、正式回答之前的过程消息里，界面真正会显示的那几条下标。 */
	visibleProcessIndices: number[];
	/** 正式回答的消息下标，本轮没有正式回答则为 -1。 */
	finalAssistantIndex: number;
	/** 过程块单独渲染时覆盖用的消息；没有过程块则为 null。 */
	finalProcessMessage: AssistantMessage | null;
	/** 回答块单独渲染时覆盖用的消息；没有回答则为 null。 */
	finalAnswerMessage: AssistantMessage | null;
	/** 过程组的消息条数：可见过程消息 + 正式回答拆出的过程块。 */
	processMessageCount: number;
	/**
	 * 过程组里是否有 provider 错误。最新一轮带着它时界面默认展开这一组：折叠起来只剩
	 * 一个计数，轮中部的错误横幅会被藏掉。
	 */
	hasProcessError: boolean;
	/** 是否是最后一轮。只有最新一轮的过程组会因 provider 错误默认展开。 */
	isLastTurn: boolean;
	/** 过程组的工具调用数。 */
	toolCallCount: number;
	/** 本轮写入的文件；只在有正式回答时收集。 */
	writtenFiles: WrittenFile[];
	/** 正式回答之后、下一个锚点之前的消息下标。 */
	tailIndices: number[];
	/** 是否是运行中的最后一轮。 */
	isLiveTail: boolean;
	/** true 表示按消息逐条渲染，不折叠过程组。 */
	isStandalone: boolean;
	/** 独立渲染时按顺序渲染的消息下标（含锚点与尾部）。 */
	messageIndices: number[];
}

/**
 * 一轮的锚点：用户消息，或 Compaction 摘要。
 *
 * 用户消息通常锚定一轮（提问 → 过程 → 正式回答），中间的过程消息折叠进
 * ProcessDetailsGroup。中途触发 compaction 时 omp 会丢掉原来的提问，用一条
 * role "custom"、customType "compaction" 的摘要顶替它，随后 agent 继续产出
 * 工具调用与正式回答，此时已没有用户消息可锚定；不把摘要当锚点，压缩之后的
 * 消息就只能逐条平铺，永远不折叠。
 */
export function isGroupAnchor(message: AgentMessage): boolean {
	if (message.role === "user") return true;
	return message.role === "custom" && (message as CustomMessage).customType === "compaction";
}

function hasFinalAssistantAnswer(message: AgentMessage, options: DisplayOptions): boolean {
	if (message.role !== "assistant") return false;
	return splitFinalAssistantBlocks(message as AssistantMessage, options).answerBlocks.some(
		(block) => block.type === "image" || (block.type === "text" && block.text.trim().length > 0),
	);
}

function findFinalAssistantIndex(
	messages: AgentMessage[],
	anchorIndex: number,
	endIndex: number,
	options: DisplayOptions,
): number {
	for (let candidateIdx = endIndex - 1; candidateIdx > anchorIndex; candidateIdx--) {
		if (hasFinalAssistantAnswer(messages[candidateIdx], options)) return candidateIdx;
	}
	for (let candidateIdx = endIndex - 1; candidateIdx > anchorIndex; candidateIdx--) {
		if (messages[candidateIdx]?.role === "assistant") return candidateIdx;
	}
	return -1;
}

function countToolCalls(messages: AgentMessage[], indices: number[], options: DisplayOptions): number {
	let count = 0;
	for (const idx of indices) {
		const msg = messages[idx];
		if (msg?.role !== "assistant") continue;
		count += countToolCallBlocks(getDisplayableAssistantBlocks(msg as AssistantMessage, options));
	}
	return count;
}

function hasDisplayableProcessMessage(message: AgentMessage, options: DisplayOptions): boolean {
	if (message.role === "assistant") {
		const assistant = message as AssistantMessage;
		// 内容块为空时 MessageView 仍会渲染 provider 错误横幅：只看内容块的话，
		// 夹在轮中部的错误消息既不算过程项也不算正式回答，整条消失。
		return (
			getDisplayableAssistantBlocks(assistant, options).length > 0 ||
			getAssistantErrorMessage(assistant, options) !== null
		);
	}
	// 自定义消息与 shell 执行都在过程区间里渲染：前者承载 compaction 之外的说明，
	// 后者是用户自己敲下的命令与输出，折叠时漏掉它们等于把这段过程删掉。
	return message.role === "custom" || message.role === "bashExecution";
}

/** 这些过程消息里有没有 provider 错误：横幅只在展开的组里才看得见。 */
function hasProviderError(messages: AgentMessage[], indices: readonly number[], options: DisplayOptions): boolean {
	return indices.some((index) => {
		const message = messages[index];
		return message?.role === "assistant" && getAssistantErrorMessage(message as AssistantMessage, options) !== null;
	});
}

function withAssistantBlocks(
	message: AssistantMessage,
	content: AssistantContentBlock[],
	options: { omitUsage?: boolean } = {},
): AssistantMessage {
	const next = { ...message, content };
	if (options.omitUsage) next.usage = undefined;
	return next;
}

function sequence(from: number, to: number): number[] {
	const indices: number[] = [];
	for (let i = from; i < to; i += 1) indices.push(i);
	return indices;
}

/** entryId 是每条消息唯一的来源；旧会话缺 id 时退回下标。 */
function itemKey(entryIds: readonly string[], index: number): string {
	return entryIds[index] ?? `index-${index}`;
}

function buildStandaloneMessageItem(entryIds: readonly string[], index: number): TranscriptItem {
	return {
		key: itemKey(entryIds, index),
		anchorIndex: index,
		isAnchor: false,
		visibleProcessIndices: [],
		finalAssistantIndex: -1,
		finalProcessMessage: null,
		finalAnswerMessage: null,
		processMessageCount: 0,
		hasProcessError: false,
		isLastTurn: false,
		toolCallCount: 0,
		writtenFiles: [],
		tailIndices: [],
		isLiveTail: false,
		isStandalone: true,
		messageIndices: [index],
	};
}

function buildTurn(
	messages: AgentMessage[],
	entryIds: readonly string[],
	anchorIndex: number,
	endIndex: number,
	lastAnchorIndex: number,
	options: TranscriptItemsOptions,
	displayOptions: DisplayOptions,
): TranscriptItem {
	const finalAssistantIndex = findFinalAssistantIndex(messages, anchorIndex, endIndex, displayOptions);
	// 运行中的最后一轮不折叠：用户要看到过程消息一条条冒出来。
	const isLiveTail =
		Boolean(options.busy || options.isStreaming) && anchorIndex === lastAnchorIndex && endIndex === messages.length;
	const isLastTurn = anchorIndex === lastAnchorIndex;

	const processIndices = sequence(anchorIndex + 1, finalAssistantIndex === -1 ? endIndex : finalAssistantIndex);
	const visibleProcessIndices = processIndices.filter((processIdx) =>
		hasDisplayableProcessMessage(messages[processIdx], displayOptions),
	);

	if (finalAssistantIndex === -1) {
		return {
			key: itemKey(entryIds, anchorIndex),
			anchorIndex,
			isAnchor: true,
			visibleProcessIndices,
			finalAssistantIndex: -1,
			finalProcessMessage: null,
			finalAnswerMessage: null,
			processMessageCount: visibleProcessIndices.length,
			hasProcessError: hasProviderError(messages, visibleProcessIndices, displayOptions),
			isLastTurn,
			toolCallCount: countToolCalls(messages, visibleProcessIndices, displayOptions),
			writtenFiles: [],
			tailIndices: [],
			isLiveTail,
			isStandalone: true,
			messageIndices: sequence(anchorIndex, endIndex),
		};
	}

	const finalAssistant = messages[finalAssistantIndex] as AssistantMessage;
	const finalSplit = splitFinalAssistantBlocks(finalAssistant, displayOptions);
	const finalProcessMessage =
		finalSplit.processBlocks.length > 0
			? withAssistantBlocks(finalAssistant, finalSplit.processBlocks, { omitUsage: true })
			: null;
	const finalAnswerMessage =
		finalSplit.answerBlocks.length > 0 || getAssistantErrorMessage(finalAssistant, displayOptions)
			? withAssistantBlocks(finalAssistant, finalSplit.answerBlocks)
			: null;

	const isStandalone = isLiveTail;
	const writtenFiles = finalAnswerMessage
		? collectTurnWrittenFiles(messages, anchorIndex, finalAssistantIndex, options)
		: [];

	return {
		key: itemKey(entryIds, anchorIndex),
		anchorIndex,
		isAnchor: true,
		visibleProcessIndices,
		finalAssistantIndex,
		finalProcessMessage,
		finalAnswerMessage,
		processMessageCount: visibleProcessIndices.length + (finalProcessMessage ? 1 : 0),
		hasProcessError: hasProviderError(messages, visibleProcessIndices, displayOptions),
		isLastTurn,
		toolCallCount:
			countToolCalls(messages, visibleProcessIndices, displayOptions) +
			countToolCallBlocks(finalSplit.processBlocks),
		writtenFiles,
		tailIndices: sequence(finalAssistantIndex + 1, endIndex),
		isLiveTail,
		isStandalone,
		messageIndices: isStandalone ? sequence(anchorIndex, endIndex) : [],
	};
}

/**
 * 收集本轮写入的文件。
 *
 * 每个工具调用各存一条 assistant 记录，正式回答本身不记录这一轮写了什么，
 * 所以要把锚点之后到正式回答为止的 assistant 块全部收集起来，再挑出其中真正
 * 落盘的 write/edit 调用。
 */
function collectTurnWrittenFiles(
	messages: AgentMessage[],
	anchorIndex: number,
	finalAssistantIndex: number,
	options: TranscriptItemsOptions,
): WrittenFile[] {
	const turnContent: AssistantContentBlock[] = [];
	for (let i = anchorIndex + 1; i <= finalAssistantIndex; i++) {
		const message = messages[i];
		if (message?.role === "assistant") {
			for (const block of (message as AssistantMessage).content ?? []) turnContent.push(block);
		}
	}
	return extractTurnWrittenFiles(turnContent, options.toolResults, options.cwd);
}

/**
 * 把消息数组切成“一轮一项”的扁平条目数组。
 *
 * 每个条目覆盖一段连续的消息区间：锚点消息自成一项，过程消息归入本轮的过程
 * 组，正式回答单独一项，正式回答之后到下一个锚点之前的消息算作尾部。不属于
 * 任何锚点的消息、没有正式回答的一轮、运行中的最后一轮都按消息逐条渲染。
 */
export function buildTranscriptItems(
	messages: AgentMessage[],
	entryIds: readonly string[],
	options: TranscriptItemsOptions = {},
): TranscriptItem[] {
	const displayOptions = options.displayOptions ?? {};
	let lastAnchorIndex = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (isGroupAnchor(messages[i])) {
			lastAnchorIndex = i;
			break;
		}
	}

	const items: TranscriptItem[] = [];
	for (let index = 0; index < messages.length; ) {
		if (!isGroupAnchor(messages[index])) {
			items.push(buildStandaloneMessageItem(entryIds, index));
			index += 1;
			continue;
		}

		const anchorIndex = index;
		let endIndex = anchorIndex + 1;
		while (endIndex < messages.length && !isGroupAnchor(messages[endIndex])) endIndex += 1;
		items.push(buildTurn(messages, entryIds, anchorIndex, endIndex, lastAnchorIndex, options, displayOptions));
		index = endIndex;
	}
	return items;
}
