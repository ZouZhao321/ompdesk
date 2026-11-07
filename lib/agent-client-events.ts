import type { AgentEvent } from "./rpc-manager";

const OMITTED_EVENT_TYPES: Record<string, true> = {
	turn_start: true,
	turn_end: true,
	tool_execution_update: true,
};

/**
 * 把 SDK 事件收敛成浏览器消费的字段。`agent_end` 带整段正文与运行统计，只保留
 * 终态标记，客户端据此立即收尾，不必等兜底对账。
 */
export function toClientEvent(event: AgentEvent): AgentEvent | null {
	if (OMITTED_EVENT_TYPES[event.type]) return null;
	if (event.type === "message_update") {
		const clientEvent = { ...event };
		delete clientEvent.assistantMessageEvent;
		return clientEvent;
	}
	if (event.type === "agent_end") {
		return { type: "agent_end", isTerminal: event.isTerminal, yielded: event.yielded };
	}
	return event;
}
