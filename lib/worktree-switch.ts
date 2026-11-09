export interface WorktreeSwitchRequest {
  /** 目标 checkout 上的分支；游离 HEAD 为 null */
  branch: string | null;
  /** 目标 checkout 的绝对路径 */
  path: string;
  /** checkout 所属仓库的项目根，供侧栏保持项目归属 */
  projectRoot: string;
}

type Listener = (request: WorktreeSwitchRequest) => void;

const listeners = new Set<Listener>();

/**
 * 请求把当前工作目录移到某个 checkout。侧栏持有目录解析与项目归属，
 * 因此由它订阅并执行，右侧 Git 面板只负责发起。
 */
export function requestWorktreeSwitch(request: WorktreeSwitchRequest): void {
  for (const listener of listeners) listener(request);
}

/** 订阅切换请求，返回取消订阅函数。 */
export function subscribeWorktreeSwitch(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
