"use client";

import { useState } from "react";
import { getFileIcon } from "./FileIcons";
import { PanelViewIcon } from "./PanelViewIcon";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MOBILE_HIT_TARGET_PX } from "@/lib/mobile-layout";
import { PANEL_VIEW_LABEL_KEYS, type Tab } from "@/lib/panel-tabs";

interface Props {
	tabs: Tab[];
	activeTabId: string | null;
	onSelectTab: (id: string) => void;
	onCloseTab: (id: string) => void;
}

function TabGlyph({ tab }: { tab: Tab }) {
	if (tab.kind === "file") return getFileIcon(tab.label, 13);
	return <PanelViewIcon kind={tab.kind} size={13} />;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: Props) {
	const { t } = useI18n();
	const isMobile = useIsMobile();
	const [hoveredClose, setHoveredClose] = useState<string | null>(null);
	// 手机档触屏命中区放大到 44px；桌面档保持 36px 页签与 24px 关闭按钮。
	const barHeight = isMobile ? MOBILE_HIT_TARGET_PX : 36;
	const closeSize = isMobile ? MOBILE_HIT_TARGET_PX : 24;

	return (
		<div
			className="panel-tab-bar"
			style={{
				display: "flex",
				alignItems: "flex-end",
				background: "var(--bg-panel)",
				overflowX: "auto",
				flexShrink: 0,
				height: barHeight,
			}}
		>
			{tabs.map((tab) => {
				const isActive = tab.id === activeTabId;
				const label = tab.kind === "file" ? tab.label : t(PANEL_VIEW_LABEL_KEYS[tab.kind]);
				return (
					<div
						key={tab.id}
						className="panel-tab"
						onClick={() => onSelectTab(tab.id)}
						onMouseDown={(e) => {
							if (e.button === 1) e.preventDefault();
						}}
						onAuxClick={(e) => {
							if (e.button !== 1) return;
							e.preventDefault();
							e.stopPropagation();
							onCloseTab(tab.id);
						}}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 6,
							height: barHeight,
							paddingLeft: 12,
							paddingRight: 6,
							borderRight: "1px solid var(--border)",
							background: isActive ? "var(--bg)" : "var(--bg-panel)",
							cursor: "pointer",
							fontSize: 12,
							color: isActive ? "var(--text)" : "var(--text-muted)",
							whiteSpace: "nowrap",
							maxWidth: 180,
							minWidth: 80,
							flexShrink: 0,
							userSelect: "none",
							transition: "background 0.1s, color 0.1s",
						}}
					>
						<span
							style={{
								flexShrink: 0,
								opacity: isActive ? 1 : 0.7,
								display: "flex",
								alignItems: "center",
							}}
						>
							<TabGlyph tab={tab} />
						</span>
						<span
							style={{
								overflow: "hidden",
								textOverflow: "ellipsis",
								flex: 1,
								fontWeight: isActive ? 500 : 400,
							}}
							title={tab.kind === "file" ? tab.filePath : label}
						>
							{label}
						</span>
						{tab.badge ? (
							<span
								aria-label={`${tab.badge}`}
								style={{
									flexShrink: 0,
									minWidth: 16,
									height: 16,
									padding: "0 5px",
									borderRadius: 8,
									background: "var(--bg-selected)",
									color: "var(--accent)",
									fontSize: 10,
									fontWeight: 600,
									lineHeight: "16px",
									textAlign: "center",
								}}
							>
								{tab.badge}
							</span>
						) : null}
						<button
							className="panel-tab-close"
							onClick={(e) => {
								e.stopPropagation();
								onCloseTab(tab.id);
							}}
							onMouseEnter={() => setHoveredClose(tab.id)}
							onMouseLeave={() => setHoveredClose(null)}
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								width: closeSize,
								height: closeSize,
								background: hoveredClose === tab.id ? "var(--bg-hover)" : "transparent",
								border: "none",
								borderRadius: 4,
								color: hoveredClose === tab.id ? "var(--text)" : "var(--text-dim)",
								cursor: "pointer",
								padding: 0,
								flexShrink: 0,
								transition: "background 0.1s, color 0.1s",
							}}
							title={t("i18n.close")}
							aria-label={`${t("i18n.close")} ${label}`}
						>
							<svg
								width="11"
								height="11"
								viewBox="0 0 10 10"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.8"
								strokeLinecap="round"
								aria-hidden="true"
							>
								<line x1="2" y1="2" x2="8" y2="8" />
								<line x1="8" y1="2" x2="2" y2="8" />
							</svg>
						</button>
					</div>
				);
			})}
		</div>
	);
}
