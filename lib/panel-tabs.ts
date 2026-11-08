/** 右侧面板的固定视图；`file` 之外的四种视图共用同一套入口。 */
export type PanelViewKind = "explorer" | "git" | "subagents" | "comments";

interface TabBase {
  id: string;
  sourceSessionId?: string | null;
  /** 视图标签携带的计数，例如运行中的子代理数量。 */
  badge?: number;
}

export interface FileTab extends TabBase {
  kind: "file";
  label: string;
  filePath: string;
  initialDisplayMode?: DisplayMode;
  /**
   * 每次打开请求的序号。同一个文件被再次打开、且要求切到指定显示模式时，
   * 序号变化会让面板正文重新应用该模式；只改文件路径无法表达这种重复请求。
   */
  openSeq?: number;
}

/** 打开文件标签的显示模式。 */
export type DisplayMode = "source" | "preview" | "diff";

/**
 * 打开文件入口的可选参数，标签栏、文件树、Git 面板与会话区的改动文件卡片共用。
 * `modeHint` 只在明确要求切换显示模式时给出，省略表示沿用标签当前状态。
 */
export interface OpenFileOptions {
  sourceSessionId?: string | null;
  modeHint?: DisplayMode;
}

export interface ViewTab extends TabBase {
  kind: PanelViewKind;
}

export type Tab = FileTab | ViewTab;
export type TabKind = Tab["kind"];

export const PANEL_VIEW_TAB_IDS: Record<PanelViewKind, string> = {
  explorer: "view:explorer",
  git: "view:git",
  subagents: "view:subagents",
  comments: "view:comments",
};

/** 视图标签的文案键，标签栏与空页入口共用。 */
export const PANEL_VIEW_LABEL_KEYS: Record<PanelViewKind, string> = {
  explorer: "files.explorer",
  git: "git.title",
  subagents: "subagents.title",
  comments: "comments.title",
};

/** 空页入口的展示顺序。 */
export const PANEL_VIEW_KINDS: PanelViewKind[] = ["explorer", "git", "subagents", "comments"];

export function panelViewTab(kind: PanelViewKind): ViewTab {
  return { id: PANEL_VIEW_TAB_IDS[kind], kind };
}
