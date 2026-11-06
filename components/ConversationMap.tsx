"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import { CARD_HEIGHT, CARD_WIDTH, layoutTurnTree } from "@/lib/map-layout";
import type { MapTurnDetail, MapTurnNode, SessionMapPayload } from "@/lib/map-types";
import { useI18n } from "@/hooks/useI18n";

interface ConversationMapProps {
  sessionId: string;
  currentLeafId?: string | null;
  onClose: () => void;
  onSessionForked: (newSessionId: string) => void;
  onSwitchLeaf: (leafId: string) => void;
  onOpenSession: (sessionId: string) => Promise<boolean>;
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

interface PointerOrigin {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

interface CardDrag extends PointerOrigin {
  id: string;
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

function formatTime(timestamp: string | undefined, locale: string): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ConversationMap({
  sessionId,
  currentLeafId,
  onClose,
  onSessionForked,
  onSwitchLeaf,
  onOpenSession,
}: ConversationMapProps) {
  const { t, locale } = useI18n();
  const [payload, setPayload] = useState<SessionMapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MapTurnDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [forking, setForking] = useState(false);
  const [offsets, setOffsets] = useState<Record<string, Offset>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [camera, setCamera] = useState<Camera>({ x: 24, y: 24, scale: 1 });

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const panRef = useRef<PointerOrigin | null>(null);
  const dragRef = useRef<CardDrag | null>(null);
  const moveRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const offsetsRef = useRef<Record<string, Offset>>({});
  offsetsRef.current = offsets;
  const dragMovedRef = useRef(false);
  const fittedPayloadRef = useRef<SessionMapPayload | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/map`);
      const body = (await response.json().catch(() => ({}))) as SessionMapPayload & {
        error?: string;
      };
      if (response.status === 404) throw new Error(t("map.sessionMissing"));
      if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`);
      setPayload(body);
      setOffsets(readOffsets(sessionId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [sessionId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const nodesById = useMemo(() => {
    const map = new Map<string, MapTurnNode>();
    for (const node of payload?.nodes ?? []) map.set(node.id, node);
    return map;
  }, [payload]);

  const childrenById = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const node of payload?.nodes ?? []) {
      if (!node.parentId || !nodesById.has(node.parentId)) continue;
      const list = map.get(node.parentId) ?? [];
      list.push(node.id);
      map.set(node.parentId, list);
    }
    return map;
  }, [payload, nodesById]);

  const subtreeSizes = useMemo(() => {
    const sizes = new Map<string, number>();
    const count = (id: string, seen: Set<string>): number => {
      const memo = sizes.get(id);
      if (memo !== undefined) return memo;
      if (seen.has(id)) return 0;
      seen.add(id);
      let size = 1;
      for (const child of childrenById.get(id) ?? []) size += count(child, seen);
      sizes.set(id, size);
      return size;
    };
    for (const node of payload?.nodes ?? []) count(node.id, new Set());
    return sizes;
  }, [payload, childrenById]);

  // Fork entry points start collapsed so a fork reads as one stub, not a second trunk.
  useEffect(() => {
    if (!payload) return;
    const entries = payload.nodes
      .filter((node) => {
        if (node.sessionId === sessionId) return false;
        const parent = node.parentId ? nodesById.get(node.parentId) : undefined;
        return Boolean(parent && parent.sessionId !== node.sessionId);
      })
      .map((node) => node.id);
    setCollapsed(new Set(entries));
  }, [payload, sessionId, nodesById]);

  const hiddenIds = useMemo(() => {
    const hidden = new Set<string>();
    const hide = (id: string) => {
      for (const child of childrenById.get(id) ?? []) {
        if (hidden.has(child)) continue;
        hidden.add(child);
        hide(child);
      }
    };
    for (const id of collapsed) hide(id);
    return hidden;
  }, [collapsed, childrenById]);

  const visibleNodes = useMemo(
    () => (payload?.nodes ?? []).filter((node) => !hiddenIds.has(node.id)),
    [payload, hiddenIds],
  );

  const layout = useMemo(() => layoutTurnTree(visibleNodes), [visibleNodes]);

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
      Math.max(
        MIN_SCALE,
        Math.min(
          (viewport.clientWidth - margin * 2) / Math.max(1, layout.width),
          (viewport.clientHeight - margin * 2) / Math.max(1, layout.height),
          1,
        ),
      ),
    );
    setCamera({
      x: (viewport.clientWidth - layout.width * scale) / 2,
      y: margin,
      scale,
    });
  }, [layout]);

  useEffect(() => {
    if (!payload || fittedPayloadRef.current === payload) return;
    fittedPayloadRef.current = payload;
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
        const response = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}/map?turn=${encodeURIComponent(selectedId)}`,
        );
        const body = (await response.json().catch(() => ({}))) as MapTurnDetail & {
          error?: string;
        };
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
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMovedRef.current = true;
      const next = {
        id: drag.id,
        x: Math.round(drag.originX + dx),
        y: Math.round(drag.originY + dy),
      };
      moveRef.current = next;
      setOffsets((current) => ({ ...current, [next.id]: { x: next.x, y: next.y } }));
    }
  }, []);

  const endPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const pan = panRef.current;
      if (pan && pan.pointerId === event.pointerId) panRef.current = null;
      const drag = dragRef.current;
      if (drag && drag.pointerId === event.pointerId) {
        dragRef.current = null;
        const moved = moveRef.current;
        moveRef.current = null;
        if (moved) {
          const next = { ...offsetsRef.current, [moved.id]: { x: moved.x, y: moved.y } };
          setOffsets(next);
          writeOffsets(sessionId, next);
        }
      }
    },
    [sessionId],
  );

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

  const startCardDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, node: MapTurnNode) => {
      if (event.button !== 0) return;
      const position = positions.get(node.id);
      if (!position) return;
      event.stopPropagation();
      dragMovedRef.current = false;
      const offset = offsetsRef.current[node.id];
      dragRef.current = {
        id: node.id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        // Offsets are relative to the laid-out card, not to the rendered position.
        originX: offset?.x ?? 0,
        originY: offset?.y ?? 0,
      };
      viewportRef.current?.setPointerCapture(event.pointerId);
    },
    [positions],
  );

  const handleFork = useCallback(
    async (node: MapTurnNode) => {
      setActionError(null);
      setForking(true);
      try {
        const result = await sendAgentCommand<{ cancelled?: boolean; newSessionId?: string }>(
          node.sessionId,
          {
            type: "fork",
            entryId: node.forkEntryId,
            includeEntry: true,
          },
        );
        if (!result?.newSessionId) throw new Error(t("map.forkCancelled"));
        onSessionForked(result.newSessionId);
        onClose();
      } catch (cause) {
        setActionError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setForking(false);
      }
    },
    [onClose, onSessionForked, t],
  );

  const handleSwitch = useCallback(
    async (node: MapTurnNode) => {
      setActionError(null);
      const leafId = node.answerEntryId ?? node.id;
      if (node.sessionId === sessionId) {
        onSwitchLeaf(leafId);
        onClose();
        return;
      }
      try {
        await sendAgentCommand(node.sessionId, { type: "navigate_tree", targetId: leafId });
        const opened = await onOpenSession(node.sessionId);
        if (!opened) {
          setActionError(t("map.openFailed"));
          return;
        }
        onClose();
      } catch (cause) {
        setActionError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [onClose, onOpenSession, onSwitchLeaf, sessionId, t],
  );

  const selectNode = useCallback((id: string) => {
    setSelectedId(id);
    setActionError(null);
  }, []);

  const onCardKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>, node: MapTurnNode) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectNode(node.id);
    },
    [selectNode],
  );

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const sessionCount = useMemo(
    () => new Set((payload?.nodes ?? []).map((node) => node.sessionId)).size,
    [payload],
  );
  const sessionColors = useMemo(() => {
    const colors = new Map<string, string>();
    const palette = ["var(--accent)", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444", "#06b6d4"];
    for (const node of payload?.nodes ?? []) {
      if (colors.has(node.sessionId)) continue;
      colors.set(node.sessionId, palette[colors.size % palette.length]);
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
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
          {t("map.title")}
        </span>
        {payload && (
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {t("map.stats", { turns: payload.nodes.length, sessions: sessionCount })}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" style={toolbarButtonStyle} onClick={fit} title={t("map.fit")}>
          {t("map.fit")}
        </button>
        <button
          type="button"
          style={toolbarButtonStyle}
          onClick={() => setCamera({ x: 24, y: 24, scale: 1 })}
        >
          {t("map.resetZoom")}
        </button>
        <button type="button" style={toolbarButtonStyle} onClick={() => void load()}>
          {t("map.refresh")}
        </button>
        <button
          type="button"
          style={{ ...toolbarButtonStyle, color: "var(--text)" }}
          onClick={onClose}
        >
          {t("map.close")}
        </button>
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
            <svg
              width={layout.width}
              height={layout.height}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                overflow: "visible",
                pointerEvents: "none",
              }}
            >
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

            {visibleNodes.map((node) => {
              const position = positions.get(node.id);
              if (!position) return null;
              const selected = node.id === selectedId;
              const active =
                node.answerEntryId !== undefined && node.answerEntryId === currentLeafId;
              const childCount = childrenById.get(node.id)?.length ?? 0;
              const isCollapsed = collapsed.has(node.id);
              const hiddenCount = isCollapsed
                ? Math.max(0, (subtreeSizes.get(node.id) ?? 1) - 1)
                : 0;
              return (
                <div
                  key={node.id}
                  data-map-card
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  aria-label={t("map.turnLabel", {
                    index: node.turnIndex + 1,
                    preview: node.preview || "—",
                  })}
                  onPointerDown={(event) => startCardDrag(event, node)}
                  onClick={() => {
                    if (dragMovedRef.current) {
                      dragMovedRef.current = false;
                      return;
                    }
                    selectNode(node.id);
                  }}
                  onKeyDown={(event) => onCardKeyDown(event, node)}
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
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 10,
                      color: "var(--text-dim)",
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 999,
                        background: sessionColors.get(node.sessionId) ?? "var(--accent)",
                      }}
                    />
                    <span>#{node.turnIndex + 1}</span>
                    {node.toolCount > 0 && <span>{t("map.tools", { count: node.toolCount })}</span>}
                    <span style={{ marginLeft: "auto" }}>{formatTime(node.timestamp, locale)}</span>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text)",
                      lineHeight: 1.35,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {node.preview || "—"}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      lineHeight: 1.35,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {node.answerPreview || "—"}
                  </div>
                  {childCount > 0 && (childCount > 1 || isCollapsed) && (
                    <button
                      type="button"
                      data-map-toggle
                      aria-expanded={!isCollapsed}
                      aria-label={
                        isCollapsed
                          ? t("map.expandCount", { count: hiddenCount })
                          : t("map.collapseCount", {
                              count: Math.max(0, (subtreeSizes.get(node.id) ?? 1) - 1),
                            })
                      }
                      title={
                        isCollapsed
                          ? t("map.expandCount", { count: hiddenCount })
                          : t("map.collapseCount", {
                              count: Math.max(0, (subtreeSizes.get(node.id) ?? 1) - 1),
                            })
                      }
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleCollapsed(node.id);
                      }}
                      style={{
                        position: "absolute",
                        right: 6,
                        bottom: 4,
                        height: 18,
                        padding: "0 6px",
                        border: "1px solid var(--border)",
                        borderRadius: 4,
                        background: "var(--bg)",
                        color: "var(--text-dim)",
                        fontSize: 10,
                        cursor: "pointer",
                      }}
                    >
                      {isCollapsed ? t("map.expandCount", { count: hiddenCount }) : "−"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {payload?.truncated && (
            <div
              style={{
                position: "absolute",
                left: 12,
                bottom: 12,
                fontSize: 11,
                color: "var(--warning)",
              }}
            >
              {t("map.truncated")}
            </div>
          )}

          {loading && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                color: "var(--text-muted)",
              }}
            >
              {t("map.loading")}
            </div>
          )}

          {!loading && error && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                fontSize: 12,
                color: "var(--danger)",
              }}
            >
              <span>{error}</span>
              <button type="button" style={toolbarButtonStyle} onClick={() => void load()}>
                {t("map.retry")}
              </button>
            </div>
          )}

          {!loading && !error && payload && payload.nodes.length === 0 && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                fontSize: 12,
                color: "var(--text-muted)",
              }}
            >
              <span>{t("map.empty")}</span>
              <button type="button" style={toolbarButtonStyle} onClick={() => void load()}>
                {t("map.retry")}
              </button>
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
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderBottom: "1px solid var(--border)",
                fontSize: 11,
                color: "var(--text-dim)",
              }}
            >
              <span>#{selectedNode.turnIndex + 1}</span>
              {selectedNode.sessionTitle && (
                <span
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {selectedNode.sessionTitle}
                </span>
              )}
              <button
                type="button"
                aria-label={t("map.close")}
                title={t("map.close")}
                style={{ ...toolbarButtonStyle, marginLeft: "auto" }}
                onClick={() => setSelectedId(null)}
              >
                ×
              </button>
            </div>
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                padding: 10,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {detailLoading && (
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {t("map.loadingTurn")}
                </div>
              )}
              <div>
                <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>
                  {t("map.you")}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    lineHeight: 1.5,
                  }}
                >
                  {detail?.userText || selectedNode.preview || "—"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>
                  {t("map.assistant")}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-muted)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    lineHeight: 1.5,
                  }}
                >
                  {detail?.answerText || selectedNode.answerPreview || "—"}
                </div>
              </div>
              {detail?.truncated && (
                <div style={{ fontSize: 10, color: "var(--warning)" }}>
                  {t("map.truncatedDetail")}
                </div>
              )}
              {detail && detail.tools.length > 0 && (
                <div
                  style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}
                >
                  {t("map.toolsUsed")}: {detail.tools.join(", ")}
                </div>
              )}
            </div>
            {actionError && (
              <div
                style={{
                  padding: "6px 10px",
                  fontSize: 11,
                  color: "var(--danger)",
                  borderTop: "1px solid var(--border)",
                }}
              >
                {actionError}
              </div>
            )}
            <div
              style={{ display: "flex", gap: 8, padding: 10, borderTop: "1px solid var(--border)" }}
            >
              <button
                type="button"
                disabled={forking}
                onClick={() => void handleFork(selectedNode)}
                style={{
                  ...actionButtonStyle,
                  background: "var(--accent)",
                  borderColor: "var(--accent)",
                  color: "#fff",
                  opacity: forking ? 0.6 : 1,
                }}
              >
                {forking ? t("map.forking") : t("map.forkHere")}
              </button>
              <button
                type="button"
                style={actionButtonStyle}
                onClick={() => void handleSwitch(selectedNode)}
              >
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
