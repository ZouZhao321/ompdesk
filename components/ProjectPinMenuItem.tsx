"use client";

import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { projectMenuRowStyle } from "./project-menu-row-style";

interface Props {
	/** 该项目当前是否已置顶，决定显示「置顶项目」还是「取消置顶」。 */
	isPinned: boolean;
	onToggle: () => void;
}

/**
 * 项目操作菜单里的置顶项：只消费置顶状态与切换回调，
 * 置顶序列与本地存储都由调用方持有。
 */
export function ProjectPinMenuItem({ isPinned, onToggle }: Props) {
	const { t } = useI18n();
	const isMobile = useIsMobile();
	const label = isPinned ? t("sidebar.unpinProject") : t("sidebar.pinProject");

	return (
		<button
			type="button"
			onClick={onToggle}
			title={label}
			style={{
				...projectMenuRowStyle(isMobile),
				border: "none",
				borderTop: "1px solid var(--border)",
				background: "transparent",
				color: "var(--text-muted)",
				cursor: "pointer",
				textAlign: "left",
			}}
			onMouseEnter={(event) => {
				event.currentTarget.style.background = "var(--bg-hover)";
			}}
			onMouseLeave={(event) => {
				event.currentTarget.style.background = "transparent";
			}}
		>
			<svg
				width="13"
				height="13"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.8"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				<path d="M12 17v5" />
				<path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
			</svg>
			{label}
		</button>
	);
}
