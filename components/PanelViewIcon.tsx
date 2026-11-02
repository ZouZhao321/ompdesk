import type { PanelViewKind } from "@/lib/panel-tabs";

/** 右侧面板视图图标，标签栏与面板头部共用。 */
export function PanelViewIcon({ kind, size = 15 }: { kind: PanelViewKind; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (kind) {
    case "explorer":
      return (
        <svg {...common}>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      );
    case "comments":
      return (
        <svg {...common}>
          <path d="M4 5h8a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H8l-4 3z" />
          <path d="M17 8h2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-1v3l-3-3" />
        </svg>
      );
    case "subagents":
      return (
        <svg {...common}>
          <rect x="4" y="8" width="16" height="12" rx="3" />
          <path d="M12 8V4" />
          <circle cx="9" cy="14" r="1" />
          <circle cx="15" cy="14" r="1" />
        </svg>
      );
    case "git":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="6" cy="18" r="2.5" />
          <circle cx="18" cy="9" r="2.5" />
          <path d="M6 8.5v7" />
          <path d="M18 11.5c0 3-2.5 4-6 4h-1" />
        </svg>
      );
  }
}
