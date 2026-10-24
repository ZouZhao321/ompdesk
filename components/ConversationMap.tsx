"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import { CARD_HEIGHT, CARD_WIDTH, layoutTurnTree } from "@/lib/map-layout";
import type { MapTurnDetail, MapTurnNode, SessionMapPayload } from "@/lib/map-types";
import { useI18n } from "@/hooks/useI18n";

interface ConversationMapProps {
  sessionId: string;
  runtimeId?: string;
  currentLeafId?: string | null;
  onClose: () => void;
  onSessionForked: (newSessionId: string) => void;
  onSwitchLeaf: (leafId: string) => void;
}

interface Camera {
  x: number;
  y: number;
  scale: number;
}

interface Offset {
  x: number;
  y: number;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 2;
const POSITION_STORAGE_PREFIX = "omp-map-positions:v1:";

function readOffsets(sessionId: string): Record<string, Offset> {
  try {
    const raw = localStorage.getItem(`${POSITION_STORAGE_PREFIX}${sessionId}`);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const offsets: Record<string, Offset> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      if (!("x" in value) || !("y" in value)) continue;
      const x = value.x;
      const y = value.y;
      if (typeof x !== "number" || typeof y !== "number") continue;
      offsets[key] = { x, y };
    }
    return offsets;
  } catch {
    return {};
  }
}

function writeOffsets(sessionId: string, offsets: Record<string, Offset>): void {
  try {
    localStorage.setItem(`${POSITION_STORAGE_PREFIX}${sessionId}`, JSON.stringify(offsets));
  } catch {
    // Private browsing may reject storage; the map still works without it.
  }
}

function formatTime(timestamp?: string): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function ConversationMap({ sessionId, runtimeId, currentLeafId, onClose, onSessionForked, onSwitchLeaf }: ConversationMapProps) {
  const { t } = useI18n();
  const agentTargetId = runtimeId ?? sessionId;
  const [payload, setPayload] = useState<SessionMapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MapTurnDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [forking, setForking] = useState(false);
  const [offsets, setOffsets] = useState<Record<string, Offset>>({});
  const [camera, setCamera] = useState<Camera>({ x: 24, y: 24, scale: 1 });

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const dragRef = useRef<{ id: string; pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const moveRef = useRef<{ id: string; x: number; y: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/map`);
      const body = (await response.json().catch(() => ({}))) as SessionMapPayload & { error?: string };
      if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`);
      setPayload(body);
      setOffsets(readOffsets(sessionId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const layout = useMemo(() => layoutTurnTree(payload?.nodes ?? []), [payload]);

  const nodesById = useMemo(() => {
    const map = new Map<string, MapTurnNode>();
    for (const node of payload?.nodes ?? []) map.set(node.id, node);
    return map;
  }, [payload]);

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const card of layout.cards) {
      const offset = offsets[card.id];
      map.set(card.id, { x: card.x + (offset?.x ?? 0), y: card.y + (offset?.y ?? 0) });
    }
    return map;
  }, [layout, offsets]);

  const fit = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || layout.cards.length === 0) return;
    const margin = 32;
    const scale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, Math.min(
        (viewport.clientWidth - margin * 2) / Math.max(1, layout.width),
        (viewport.clientHeight - margin * 2) / Math.max(1, layout.height),
        1,
      )),
    );
    setCamera({
      x: (viewport.clientWidth - layout.width * scale) / 2,
      y: margin,
      scale,
    });
  }, [layout]);

  useEffect(() => {
    if (!payload) return;
    fit();
  }, [payload, fit]);

  const selectedNode = selectedId ? nodesById.get(selectedId) : undefined;

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetail(null);
    void (async () => {
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/map?turn=${encodeURIComponent(selectedId)}`);
        const body = (await response.json().catch(() => ({}))) as MapTurnDetail & { error?: string };
        if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`);
        if (!cancelled) setDetail(body);
      } catch {
        if (!cancelled) setDetail(null);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, sessionId]);

  const onPointerDownBackground = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-map-card]") || target.closest("[data-map-panel]")) return;
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: cameraRef.current.x,
      originY: cameraRef.current.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMoveBackground = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (pan && pan.pointerId === event.pointerId) {
      setCamera((current) => ({
        ...current,
        x: pan.originX + (event.clientX - pan.startX),
        y: pan.originY + (event.clientY - pan.startY),
      }));
      return;
    }
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      const dx = (event.clientX - drag.startX) / cameraRef.current.scale;
      const dy = (event.clientY - drag.startY) / cameraRef.current.scale;
      const next = { id: drag.id, x: Math.round(drag.originX + dx), y: Math.round(drag.originY + dy) };
      moveRef.current = next;
      setOffsets((current) => ({ ...current, [next.id]: { x: next.x, y: next.y } }));
    }
  }, []);

  const endPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (pan && pan.pointerId === event.pointerId) panRef.current = null;
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      dragRef.current = null;
      const moved = moveRef.current;
      moveRef.current = null;
      if (moved) {
        setOffsets((current) => {
          const next = { ...current, [moved.id]: { x: moved.x, y: moved.y } };
          writeOffsets(sessionId, next);
          return next;
        });
      }
    }
  }, [sessionId]);

  const onWheel = useCallback((event: WheelEvent) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    setCamera((current) => {
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor));
      const worldX = (px - current.x) / current.scale;
      const worldY = (py - current.y) / current.scale;
      return { x: px - worldX * scale, y: py - worldY * scale, scale };
    });
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // React registers wheel handlers as passive listeners, where preventDefault()
    // is ignored. Bind natively so zooming never scrolls the page behind it.
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  const startCardDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>, node: MapTurnNode) => {
    if (event.button !== 0) return;
    const position = positions.get(node.id);
    if (!position) return;
    event.stopPropagation();
    dragRef.current = {
      id: node.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    };
  }, [positions]);

  const handleFork = useCallback(async (node: MapTurnNode) => {
    setActionError(null);
    setForking(true);
    try {
      const result = await sendAgentCommand<{ cancelled?: boolean; newSessionId?: string }>(agentTargetId, {
        type: "fork",
        entryId: node.forkEntryId,
        includeEntry: true,
      });
      if (!result?.newSessionId) throw new Error(t("map.forkCancelled"));
      onSessionForked(result.newSessionId);
      onClose();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setForking(false);
    }
  }, [agentTargetId, onClose, onSessionForked, t]);

  const handleSwitch = useCallback((node: MapTurnNode) => {
    onSwitchLeaf(node.answerEntryId ?? node.id);
    onClose();
  }, [onClose, onSwitchLeaf]);

  const sessionColors = useMemo(() => {
    const colors = new Map<string, string>();
    const palette = ["var(--accent)", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444", "#06b6d4"];
    for (const session of payload?.sessions ?? []) {
      colors.set(session.id, palette[colors.size % palette.length]);
    }
    return colors;
  }, [payload]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 80,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 40,
          flexShrink: 0,
          padding: "0 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{t("map.title")}</span>
        {payload && (
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {t("map.stats", { turns: String(payload.nodes.length), sessions: String(payload.sessions.length) })}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" style={toolbarButtonStyle} onClick={fit} title={t("map.fit")}>{t("map.fit")}</button>
        <button type="button" style={toolbarButtonStyle} onClick={() => setCamera({ x: 24, y: 24, scale: 1 })}>{t("map.resetZoom")}</button>
        <button type="button" style={toolbarButtonStyle} onClick={() => void load()}>{t("map.refresh")}</button>
        <button type="button" style={{ ...toolbarButtonStyle, color: "var(--text)" }} onClick={onClose}>{t("map.close")}</button>
      </div>

      <div style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div
          ref={viewportRef}
          onPointerDown={onPointerDownBackground}
          onPointerMove={onPointerMoveBackground}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          style={{
            position: "absolute",
            inset: 0,
            overflow: "hidden",
            cursor: panRef.current ? "grabbing" : "grab",
            backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
            touchAction: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: layout.width,
              height: layout.height,
              transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
              transformOrigin: "0 0",
            }}
          >
            <svg width={layout.width} height={layout.height} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}>
              {layout.edges.map((edge) => {
                const from = positions.get(edge.from);
                const to = positions.get(edge.to);
                if (!from || !to) return null;
                const x1 = from.x + CARD_WIDTH / 2;
                const y1 = from.y + CARD_HEIGHT;
                const x2 = to.x + CARD_WIDTH / 2;
                const y2 = to.y;
                const bend = Math.max(24, Math.abs(y2 - y1) * 0.35);
                return (
                  <path
                    key={`${edge.from}-${edge.to}`}
                    d={`M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`}
                    fill="none"
                    stroke="var(--border)"
                    strokeWidth={1.5}
                  />
                );
              })}
            </svg>

            {payload?.nodes.map((node) => {
              const position = positions.get(node.id);
              if (!position) return null;
              const selected = node.id === selectedId;
              const active = node.answerEntryId !== undefined && node.answerEntryId === currentLeafId;
              return (
                <div
                  key={node.id}
                  data-map-card
                  onPointerDown={(event) => startCardDrag(event, node)}
                  onClick={() => setSelectedId(node.id)}
                  style={{
                    position: "absolute",
                    left: position.x,
                    top: position.y,
                    width: CARD_WIDTH,
                    height: CARD_HEIGHT,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: `1px solid ${selected ? "var(--accent)" : active ? "var(--text-muted)" : "var(--border)"}`,
                    background: selected ? "var(--bg-selected)" : "var(--bg-panel)",
                    boxShadow: selected ? "0 0 0 1px var(--accent)" : "0 1px 2px rgba(0,0,0,0.18)",
                    cursor: "grab",
                    overflow: "hidden",
                    userSelect: "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: sessionColors.get(node.sessionId) ?? "var(--accent)" }} />
                    <span>#{node.turnIndex + 1}</span>
                    {node.toolCount > 0 && <span>{t("map.tools", { count: String(node.toolCount) })}</span>}
                    <span style={{ marginLeft: "auto" }}>{formatTime(node.timestamp)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {node.preview || "—"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {node.answerPreview || "—"}
                  </div>
                </div>
              );
            })}
          </div>

          {payload?.truncated && (
            <div style={{ position: "absolute", left: 12, bottom: 12, fontSize: 11, color: "var(--warning)" }}>
              {t("map.truncated")}
            </div>
          )}

          {loading && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--text-muted)" }}>
              {t("map.loading")}
            </div>
          )}

          {!loading && error && (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 12, color: "var(--danger)" }}>
              <span>{error}</span>
              <button type="button" style={toolbarButtonStyle} onClick={() => void load()}>{t("map.retry")}</button>
            </div>
          )}

          {!loading && !error && payload && payload.nodes.length === 0 && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--text-muted)" }}>
              {t("map.empty")}
            </div>
          )}
        </div>

        {selectedNode && (
          <div
            data-map-panel
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              bottom: 12,
              width: "min(380px, calc(100% - 24px))",
              display: "flex",
              flexDirection: "column",
              border: "1px solid var(--border)",
              borderRadius: 10,
              background: "var(--bg-panel)",
              boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid var(--border)", fontSize: 11, color: "var(--text-dim)" }}>
              <span>#{selectedNode.turnIndex + 1}</span>
              {selectedNode.sessionTitle && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedNode.sessionTitle}</span>}
              <button type="button" style={{ ...toolbarButtonStyle, marginLeft: "auto" }} onClick={() => setSelectedId(null)}>×</button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
              {detailLoading && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("map.loadingTurn")}</div>}
              <div>
                <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>{t("map.you")}</div>
                <div style={{ fontSize: 12, color: "var(--text)", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 }}>
                  {detail?.userText || selectedNode.preview || "—"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>{t("map.assistant")}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 }}>
                  {detail?.answerText || selectedNode.answerPreview || "—"}
                </div>
              </div>
              {detail && detail.tools.length > 0 && (
                <div style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                  {t("map.toolsUsed")}: {detail.tools.join(", ")}
                </div>
              )}
            </div>
            {actionError && (
              <div style={{ padding: "6px 10px", fontSize: 11, color: "var(--danger)", borderTop: "1px solid var(--border)" }}>
                {actionError}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, padding: 10, borderTop: "1px solid var(--border)" }}>
              <button
                type="button"
                disabled={forking}
                onClick={() => void handleFork(selectedNode)}
                style={{ ...actionButtonStyle, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff", opacity: forking ? 0.6 : 1 }}
              >
                {forking ? t("map.forking") : t("map.forkHere")}
              </button>
              <button type="button" style={actionButtonStyle} onClick={() => handleSwitch(selectedNode)}>
                {t("map.switchHere")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const toolbarButtonStyle: CSSProperties = {
  height: 24,
  padding: "0 10px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "transparent",
  color: "var(--text-muted)",
  fontSize: 11,
  cursor: "pointer",
};

const actionButtonStyle: CSSProperties = {
  flex: 1,
  height: 30,
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "transparent",
  color: "var(--text)",
  fontSize: 12,
  cursor: "pointer",
};
