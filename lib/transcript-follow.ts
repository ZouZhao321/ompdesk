/**
 * 转写视图跟随开关的判定。
 *
 * 跟随开关只有两类来源：列表报告的滚动位置，以及用户或界面主动发起的位置改变。
 * 判定都收在这里，hook 与界面只负责把结论写回状态与滚动入口。
 */

/** 贴底阈值（px）：距列表底部不超过这么多像素就算仍停在底部。 */
export const FOLLOW_BOTTOM_THRESHOLD_PX = 72;

/** 改变跟随开关的事件。 */
export type FollowEvent =
  /** 提交提问或执行 shell 命令：要看到的就是末尾。 */
  | { type: "submit" }
  /** 点了「回到底部」。 */
  | { type: "resume" }
  /** 位置被有意改到别处，例如跳转到某一轮。 */
  | { type: "pause" }
  /** 列表报告了一次滚动位置。 */
  | {
    type: "scroll";
    /** 这次滚动是不是用户自己驱动的（滚轮/触摸/指针/方向键）。 */
    userDriven: boolean;
    /** 距列表底部的像素。 */
    distanceFromBottom: number;
  };

/** 一次事件的结论：写回的跟随状态，以及要执行的滚动。 */
export interface FollowOutcome {
  paused: boolean;
  /** 把视图带到末尾用的滚动方式；null 表示这次事件不碰滚动位置。 */
  scrollToEnd: "auto" | "smooth" | null;
}

/**
 * 事件对跟随开关的影响；这次事件不改状态时返回 null。
 *
 * 提交与「回到底部」都恢复跟随并把视图带到末尾；跳转停掉跟随，让「回到底部」
 * 按钮出现，跳转自己的定位不经过这里。
 *
 * 滚动观测里暂停与恢复分两条判据：暂停只认用户驱动的滚动——离开底部才停止跟随，
 * 内容增高、行重新测量引起的滚动说明不了用户意图，不改开关；恢复只看位置——回到
 * 贴底距离内就恢复，不看是谁带的、也不看离用户最后一次操作过了多久。触控惯性与
 * 拖滚动条到底可能远晚于用户意图窗口，按窗口判定会让视图一直停在暂停。
 *
 * 正因恢复不查驱动方，跳转自己的落点必须先被挡在判定之外，否则落在贴底距离内就会
 * 把刚停掉的跟随又打开，「回到底部」按钮不再出现。
 */
export function reduceFollow(event: FollowEvent): FollowOutcome | null {
  switch (event.type) {
    case "submit":
      return { paused: false, scrollToEnd: "auto" };
    case "resume":
      return { paused: false, scrollToEnd: "smooth" };
    case "pause":
      return { paused: true, scrollToEnd: null };
    case "scroll": {
      if (event.distanceFromBottom <= FOLLOW_BOTTOM_THRESHOLD_PX) {
        return { paused: false, scrollToEnd: null };
      }
      return event.userDriven ? { paused: true, scrollToEnd: null } : null;
    }
  }
}
