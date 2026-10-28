"use client";

import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[role="button"][tabindex="0"]';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  labelledBy: string;
  className?: string;
  children: ReactNode;
};

/** 共通ダイアログ: dialog 意味論・Escape 閉じ・初期フォーカス・閉じた後の復元・Tab フォーカストラップ。背景クリックで閉じる。 */
export function Modal({ isOpen, onClose, labelledBy, className, children }: Props) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const section = sectionRef.current;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = (): HTMLElement[] => (section ? [...section.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute("disabled")) : []);
    (focusables()[0] ?? section)?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCloseRef.current(); return; }
      if (event.key !== "Tab" || !section) return;
      const items = focusables();
      if (!items.length) { event.preventDefault(); section.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!section.contains(active)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (restoreRef.current?.isConnected) restoreRef.current.focus();
      restoreRef.current = null;
    };
  }, [isOpen]);

  if (!isOpen) return null;
  return <div className="modal-backdrop" onMouseDown={() => onCloseRef.current()}>
    <section ref={sectionRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={labelledBy} className={className} style={{ outline: "none" }} onMouseDown={(event) => event.stopPropagation()}>
      {children}
    </section>
  </div>;
}
