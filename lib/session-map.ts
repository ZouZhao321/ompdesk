import { statSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { SessionInfo } from "./types";
import { getSessionEntries, listAllSessions, readSessionHeader, resolveSessionPath } from "./session-reader";
import { sessionPathKey } from "./session-path";
import type { MapTurnDetail, MapTurnNode, SessionMapPayload } from "./map-types";

const PREVIEW_CHARS = 240;
const DETAIL_CHARS = 20_000;
const MAX_SESSIONS = 64;
const MAX_NODES = 800;
const MAX_TOOL_NAMES = 40;
const CACHE_LIMIT = 64;

type JsonObject = Record<string, unknown>;

type RawEntry = {
	type?: string;
	id?: string;
	parentId?: string | null;
	timestamp?: string;
	message?: {
		role?: string;
		content?: unknown;
		toolCallId?: string;
	};
};

type ParsedTurn = {
	id: string;
	parentId: string | null;
	index: number;
	userText: string;
	userTruncated: boolean;
	answerText: string;
	answerTruncated: boolean;
	preview: string;
	answerPreview: string;
	toolCount: number;
	tools: string[];
	timestamp?: string;
	answerEntryId?: string;
	forkEntryId: string;
};

type ParsedFile = {
	turns: ParsedTurn[];
};

type CacheEntry = {
	mtimeMs: number;
	size: number;
	parsed: ParsedFile;
};

declare global {
	var __ompSessionMapCache: Map<string, CacheEntry> | undefined;
}

function asObject(value: unknown): JsonObject | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		const obj = asObject(block);
		if (!obj || obj.type !== "text") continue;
		if (typeof obj.text === "string") parts.push(obj.text);
	}
	return parts.join("\n");
}

function toolCallsOf(content: unknown): Array<{ id?: string; name: string }> {
	if (!Array.isArray(content)) return [];
	const calls: Array<{ id?: string; name: string }> = [];
	for (const block of content) {
		const obj = asObject(block);
		if (!obj || obj.type !== "toolCall") continue;
		calls.push({
			id: typeof obj.id === "string" ? obj.id : undefined,
			name: typeof obj.name === "string" ? obj.name : "tool",
		});
	}
	return calls;
}

function clip(text: string): string {
	return text.replace(/\s+/g, " ").trim().slice(0, PREVIEW_CHARS);
}

function cache(): Map<string, CacheEntry> {
	if (!globalThis.__ompSessionMapCache) globalThis.__ompSessionMapCache = new Map();
	return globalThis.__ompSessionMapCache;
}

/**
 * Groups session entries into user turns. A turn ends at the last entry that
 * leaves no unresolved tool call behind, so forking there never produces a
 * history with a dangling tool call.
 */
export function turnsFromEntries(entries: readonly RawEntry[]): ParsedTurn[] {
	const byId = new Map<string, RawEntry>();
	for (const entry of entries) {
		if (entry.id) byId.set(entry.id, entry);
	}

	const turns: ParsedTurn[] = [];
	let current: ParsedTurn | null = null;
	let pendingToolCalls = new Set<string>();

	const closeTurn = () => {
		if (!current) return;
		current.answerPreview = clip(current.answerText);
		turns.push(current);
	};

	for (const entry of entries) {
		if (!entry.id) continue;
		const role = entry.type === "message" ? entry.message?.role : undefined;

		if (role === "user") {
			closeTurn();
			const userText = textOf(entry.message?.content);
			current = {
				id: entry.id,
				parentId: null,
				index: turns.length,
				userText: userText.slice(0, DETAIL_CHARS),
				userTruncated: userText.length > DETAIL_CHARS,
				answerText: "",
				answerTruncated: false,
				preview: clip(userText),
				answerPreview: "",
				toolCount: 0,
				tools: [],
				timestamp: entry.timestamp,
				forkEntryId: entry.id,
			};
			pendingToolCalls = new Set();
			continue;
		}

		if (!current || entry.type !== "message") continue;

		if (role === "assistant") {
			const calls = toolCallsOf(entry.message?.content);
			for (const call of calls) {
				if (call.id) pendingToolCalls.add(call.id);
				current.toolCount += 1;
				if (current.tools.length < MAX_TOOL_NAMES) current.tools.push(call.name);
			}
			const text = textOf(entry.message?.content);
			if (text.trim()) {
				current.answerText = text.slice(0, DETAIL_CHARS);
				current.answerTruncated = text.length > DETAIL_CHARS;
				current.answerEntryId = entry.id;
				if (pendingToolCalls.size === 0) current.forkEntryId = entry.id;
			}
			continue;
		}

		if (role === "toolResult") {
			const callId = entry.message?.toolCallId;
			// Only a result for a call opened in this turn can close it. Orphan
			// results must not become the cut point of the turn.
			if (!callId || !pendingToolCalls.has(callId)) continue;
			pendingToolCalls.delete(callId);
			if (pendingToolCalls.size === 0) current.forkEntryId = entry.id;
		}
	}
	closeTurn();

	for (const turn of turns) {
		let parentId = byId.get(turn.id)?.parentId ?? null;
		const seenParents = new Set<string>();
		while (parentId && !seenParents.has(parentId)) {
			seenParents.add(parentId);
			const entry = byId.get(parentId);
			if (!entry) break;
			if (entry.type === "message" && entry.message?.role === "user") {
				if (entry.id) turn.parentId = entry.id;
				break;
			}
			parentId = entry.parentId ?? null;
		}
	}

	return turns;
}

async function parseSessionFile(filePath: string): Promise<ParsedFile> {
	const stat = statSync(filePath);
	const key = sessionPathKey(filePath);
	const cached = cache().get(key);
	if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
		return cached.parsed;
	}

	const entries = (await getSessionEntries(filePath)) as unknown as RawEntry[];
	const parsed: ParsedFile = { turns: turnsFromEntries(entries) };
	if (stat.size <= 8 * 1024 * 1024) {
		const store = cache();
		store.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, parsed });
		while (store.size > CACHE_LIMIT) {
			const oldest = store.keys().next().value;
			if (oldest === undefined) break;
			store.delete(oldest);
		}
	}
	return parsed;
}

function isSubagentFile(childPath: string, parentPath: string): boolean {
	const parentStem = basename(parentPath, ".jsonl");
	return basename(dirname(childPath)) === parentStem;
}

function buildChildren(sessions: SessionInfo[]): Map<string, SessionInfo[]> {
	const children = new Map<string, SessionInfo[]>();
	for (const session of sessions) {
		if (!session.parentSessionId) continue;
		const list = children.get(session.parentSessionId) ?? [];
		list.push(session);
		children.set(session.parentSessionId, list);
	}
	return children;
}

/** Target session plus every fork descendant, parent first. Subagent sessions are excluded. */
async function collectChain(target: SessionInfo): Promise<{ sessions: SessionInfo[]; truncated: boolean }> {
	const all = await listAllSessions();
	const children = buildChildren(all);
	const chain: SessionInfo[] = [];
	const seen = new Set<string>([sessionPathKey(target.path)]);
	const queue: SessionInfo[] = [target];
	let truncated = false;

	while (queue.length > 0) {
		if (chain.length >= MAX_SESSIONS) {
			truncated = true;
			break;
		}
		const info = queue.shift()!;
		chain.push(info);
		for (const child of children.get(info.id) ?? []) {
			if (isSubagentFile(child.path, info.path)) continue;
			const key = sessionPathKey(child.path);
			if (seen.has(key)) continue;
			seen.add(key);
			queue.push(child);
		}
	}
	return { sessions: chain, truncated };
}

async function parseChain(chain: SessionInfo[]): Promise<Array<{ info: SessionInfo; parsed: ParsedFile }>> {
	const results = await Promise.allSettled(chain.map((info) => parseSessionFile(info.path)));
	const root = results[0];
	// The root file is the map itself: a broken root must surface, not look empty.
	if (root?.status === "rejected") throw root.reason;
	const loaded: Array<{ info: SessionInfo; parsed: ParsedFile }> = [];
	results.forEach((result, index) => {
		if (result.status === "fulfilled") loaded.push({ info: chain[index], parsed: result.value });
	});
	return loaded;
}

async function resolveTarget(sessionId: string): Promise<{ info: SessionInfo; path: string } | null> {
	const path = await resolveSessionPath(sessionId);
	if (!path) return null;
	const key = sessionPathKey(path);
	const all = await listAllSessions();
	const info = all.find((session) => sessionPathKey(session.path) === key);
	if (info) return { info, path };

	const header = readSessionHeader(path);
	if (!header) return null;
	return {
		path,
		info: {
			id: header.id,
			path,
			cwd: header.cwd ?? "",
			created: header.timestamp,
			modified: statSync(path).mtime.toISOString(),
			messageCount: 0,
			firstMessage: "",
		},
	};
}

export async function buildSessionMap(sessionId: string): Promise<SessionMapPayload | null> {
	const target = await resolveTarget(sessionId);
	if (!target) return null;

	const chain = await collectChain(target.info);
	const loaded = await parseChain(chain.sessions);
	const byTurn = new Map<string, MapTurnNode>();
	const nodes: MapTurnNode[] = [];
	let truncated = chain.truncated;

	for (const { info, parsed } of loaded) {
		for (const turn of parsed.turns) {
			if (byTurn.has(turn.id)) continue;
			if (nodes.length >= MAX_NODES) {
				truncated = true;
				break;
			}
			const node: MapTurnNode = {
				id: turn.id,
				parentId: turn.parentId,
				sessionId: info.id,
				sessionTitle: info.name || undefined,
				turnIndex: turn.index,
				preview: turn.preview,
				answerPreview: turn.answerPreview,
				toolCount: turn.toolCount,
				timestamp: turn.timestamp,
				answerEntryId: turn.answerEntryId,
				forkEntryId: turn.forkEntryId,
			};
			byTurn.set(turn.id, node);
			nodes.push(node);
		}
	}

	return { nodes, truncated };
}

export async function readMapTurn(sessionId: string, turnId: string): Promise<MapTurnDetail | null> {
	const target = await resolveTarget(sessionId);
	if (!target) return null;
	const chain = await collectChain(target.info);
	const loaded = await parseChain(chain.sessions);
	for (const { parsed } of loaded) {
		const turn = parsed.turns.find((candidate) => candidate.id === turnId);
		if (!turn) continue;
		return {
			userText: turn.userText,
			answerText: turn.answerText,
			tools: turn.tools,
			truncated: turn.userTruncated || turn.answerTruncated,
		};
	}
	return null;
}
