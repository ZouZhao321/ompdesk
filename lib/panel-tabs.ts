/** 右侧面板的标签类型；`file` 展示文件，其余是固定视图。 */
export type PanelViewKind = "explorer" | "subagents";
export type TabKind = "file" | PanelViewKind;

export interface Tab {
  id: string;
  label: string;
  kind: TabKind;
  filePath?: string;
  sourceSessionId?: string | null;
  initialDisplayMode?: "source" | "preview" | "diff";
  /** 视图标签携带的计数，例如运行中的子代理数量。 */
  badge?: number;
}

export const PANEL_VIEW_TAB_IDS: Record<PanelViewKind, string> = {
  explorer: "view:explorer",
  subagents: "view:subagents",
};

/** 视图标签的文案键，标签栏与空页入口共用。 */
export const PANEL_VIEW_LABEL_KEYS: Record<PanelViewKind, string> = {
  explorer: "files.explorer",
  subagents: "subagents.title",
};

/** 空页入口的展示顺序。 */
export const PANEL_VIEW_KINDS: PanelViewKind[] = ["explorer", "subagents"];

export function panelViewTab(kind: PanelViewKind): Tab {
  return { id: PANEL_VIEW_TAB_IDS[kind], label: "", kind };
}
