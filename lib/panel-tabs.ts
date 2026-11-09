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
 * `modeHint` 只在明确要求切到差异视图时给出，省略表示沿用标签当前状态；
 * 查看器目前只兑现差异这一种提示，类型不放开到其余显示模式。
 */
export interface OpenFileOptions {
  sourceSessionId?: string | null;
  modeHint?: "diff";
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

/**
 * 一个打开文件请求。
 *
 * `openSeq` 是「这是第几次打开这个文件」的序号：带上显示模式提示时由调用方递增，
 * 让同一个文件再开一次成为新请求；省略表示沿用标签现状。
 */
export type OpenFileRequest = {
  filePath: string;
  label: string;
  sourceSessionId?: string | null;
} & ({ modeHint?: undefined; openSeq?: undefined } | { modeHint: "diff"; openSeq: number });

/**
 * 把一次打开请求并入标签列表。
 *
 * - 未见过的文件追加一个文件标签。
 * - 无显示模式提示：沿用标签现状，不动列表，避免普通打开反复重建标签对象。
 * - 带提示：每次都算新请求，就地改写显示模式与打开序号，不新增第二个标签。
 */
export function mergeOpenFileTab(tabs: Tab[], request: OpenFileRequest): Tab[] {
  const tabId = `file:${request.filePath}`;
  const existing = tabs.find((tab) => tab.id === tabId);
  if (!existing) {
    return [
      ...tabs,
      {
        id: tabId,
        kind: "file",
        label: request.label,
        filePath: request.filePath,
        sourceSessionId: request.sourceSessionId,
        initialDisplayMode: request.modeHint,
        openSeq: request.openSeq,
      } satisfies FileTab,
    ];
  }
  if (existing.kind !== "file") return tabs;
  // undefined 表示调用方没有意见；null 是显式清空（当前没有选中会话），
  // 两者不能混为一谈，否则会话被删后标签会一直留着旧 sessionId。
  const sourceSpecified = request.sourceSessionId !== undefined;
  const sourceUnchanged = !sourceSpecified || existing.sourceSessionId === request.sourceSessionId;
  if (!request.modeHint) {
    // 无提示的打开沿用标签现状：只有来源会话变了才改写，其余一律不动列表。
    if (sourceUnchanged) return tabs;
    return tabs.map((tab) =>
      tab.id === tabId && tab.kind === "file" ? { ...tab, sourceSessionId: request.sourceSessionId } : tab,
    );
  }
  const modeUnchanged = existing.initialDisplayMode === request.modeHint;
  // 走到这里 request 已收窄为带 modeHint 的一支，openSeq 必为数字。
  if (sourceUnchanged && modeUnchanged && request.openSeq === existing.openSeq) return tabs;
  return tabs.map((tab) =>
    tab.id === tabId && tab.kind === "file"
      ? {
          ...tab,
          ...(sourceUnchanged ? {} : { sourceSessionId: request.sourceSessionId }),
          initialDisplayMode: request.modeHint,
          openSeq: request.openSeq,
        }
      : tab,
  );
}
