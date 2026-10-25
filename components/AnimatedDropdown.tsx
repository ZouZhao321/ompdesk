"use client";

import { useEffect, useState, type AriaRole, type CSSProperties, type ReactNode } from "react";

const DROPDOWN_ANIMATION_MS = 140;

/** 弹层容器的进场/退场动画：关闭后保留挂载直到动画结束，避免布局跳动。 */
export function AnimatedDropdown({ open, children, style, role }: {
  open: boolean;
  children: ReactNode;
  style: CSSProperties;
  /** 菜单类弹层传入 `menu`，让菜单项有可访问的容器。 */
  role?: AriaRole;
}) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    let frame: number | undefined;
    let timeout: number | undefined;

    if (open) {
      setMounted(true);
      setVisible(false);
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      timeout = window.setTimeout(() => setMounted(false), DROPDOWN_ANIMATION_MS);
    }

    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      clearTimeout(timeout);
    };
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      role={role}
      style={{
        ...style,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0) scale(1)" : "translateY(-8px) scale(0.96)",
        transformOrigin: "top center",
        transition: `opacity ${DROPDOWN_ANIMATION_MS}ms ease, transform ${DROPDOWN_ANIMATION_MS}ms ease`,
        pointerEvents: open ? "auto" : "none",
      }}
    >
      {children}
    </div>
  );
}
