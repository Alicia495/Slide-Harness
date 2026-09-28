"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { SLIDE_H, SLIDE_W, type ChartElement, type Element, type Slide } from "@/lib/document";
import type { Operation } from "@/lib/document";

type Box = { x: number; y: number; w: number; h: number };
type Props = {
  slide: Slide;
  selectedId?: string | null;
  changedIds?: Set<string>;
  compact?: boolean;
  readOnly?: boolean;
  onSelect?: (id: string | null) => void;
  onCommit?: (operation: Operation) => void;
};

function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function round(value: number): number { return Math.round(value * 1000) / 1000; }

function ChartPreview({ element }: { element: ChartElement }) {
  const first = element.series[0];
  const values = first?.values ?? [];
  const labels = first?.labels ?? [];
  const max = Math.max(...values.map(Math.abs), 1);
  const plotH = 68;
  if (element.chartType === "pie") {
    const sum = values.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    let running = 0;
    const colors = ["#3156D3", "#65A9F0", "#85C8A5", "#F5B44E", "#9B8FE8"];
    const gradient = values.map((value, i) => { const start = running; running += Math.max(0, value) / sum * 100; return `${colors[i % colors.length]} ${start}% ${running}%`; }).join(", ");
    return <div className="chart-pie-wrap"><div className="chart-pie" style={{ background: `conic-gradient(${gradient})` }}/><div className="chart-legend">{labels.map((label, i) => <span key={i}><i style={{ background: colors[i % colors.length] }}/>{label}</span>)}</div></div>;
  }
  return <div className="chart-plot">
    <svg viewBox="0 0 100 82" preserveAspectRatio="none" aria-hidden="true">
      {[0, 1, 2, 3].map((n) => <line key={n} x1="3" x2="98" y1={8 + n * 20} y2={8 + n * 20} stroke="#E5EAF1" strokeWidth="0.5"/>)}
      {element.chartType === "bar" ? values.map((value, i) => {
        const group = 94 / Math.max(values.length, 1);
        const barH = Math.abs(value) / max * plotH;
        return <rect key={i} x={4 + i * group + group * 0.2} y={76 - barH} width={group * 0.6} height={barH} rx="1" fill={i % 2 ? "#65A9F0" : "#3156D3"}/>;
      }) : <polyline points={values.map((value, i) => `${5 + i * 92 / Math.max(values.length - 1, 1)},${76 - Math.abs(value) / max * plotH}`).join(" ")} fill="none" stroke="#3156D3" strokeWidth="1.8" strokeLinejoin="round"/>}
    </svg>
    <div className="chart-labels">{labels.map((label, i) => <span key={i}>{label}</span>)}</div>
  </div>;
}

function ElementBox({ element, canvasWidth, slideId, selected, changed, compact, readOnly, onSelect, onCommit }: {
  element: Element; canvasWidth: number; slideId: string; selected: boolean; changed: boolean; compact: boolean; readOnly: boolean;
  onSelect?: Props["onSelect"]; onCommit?: Props["onCommit"];
}) {
  const [draft, setDraft] = useState<Box | null>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const interaction = useRef<{ mode: "move" | "resize"; startX: number; startY: number; initial: Box; moved: boolean } | null>(null);
  const box = draft ?? element;
  const fontPx = element.kind === "text" ? Math.max(compact ? 3 : 8, element.fontSize * canvasWidth / 960) : 12;
  const style: React.CSSProperties = {
    left: `${box.x / SLIDE_W * 100}%`, top: `${box.y / SLIDE_H * 100}%`,
    width: `${box.w / SLIDE_W * 100}%`, height: `${box.h / SLIDE_H * 100}%`,
  };

  function down(event: PointerEvent<HTMLDivElement>) {
    if (readOnly || editing) return;
    event.stopPropagation();
    onSelect?.(element.id);
    const mode = (event.target as HTMLElement).closest("[data-resize]") ? "resize" : "move";
    interaction.current = { mode, startX: event.clientX, startY: event.clientY,
      initial: { x: element.x, y: element.y, w: element.w, h: element.h }, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const state = interaction.current;
    if (!state) return;
    const canvas = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!canvas) return;
    const dx = (event.clientX - state.startX) / canvas.width * SLIDE_W;
    const dy = (event.clientY - state.startY) / canvas.height * SLIDE_H;
    if (Math.abs(dx) + Math.abs(dy) < 0.015 && !state.moved) return;
    state.moved = true;
    if (state.mode === "move") setDraft({ ...state.initial, x: round(clamp(state.initial.x + dx, 0, SLIDE_W - state.initial.w)), y: round(clamp(state.initial.y + dy, 0, SLIDE_H - state.initial.h)) });
    else setDraft({ ...state.initial, w: round(clamp(state.initial.w + dx, 0.25, SLIDE_W - state.initial.x)), h: round(clamp(state.initial.h + dy, 0.2, SLIDE_H - state.initial.y)) });
  }
  function up() {
    const state = interaction.current;
    interaction.current = null;
    if (!state || !state.moved || !draft) { setDraft(null); return; }
    if (state.mode === "move") onCommit?.({ type: "moveElement", slideId, elementId: element.id, x: draft.x, y: draft.y });
    else onCommit?.({ type: "resizeElement", slideId, elementId: element.id, w: draft.w, h: draft.h });
    setDraft(null);
  }
  function finishText(save: boolean) {
    if (save && element.kind === "text" && editText !== element.text) onCommit?.({ type: "updateText", slideId, elementId: element.id, text: editText });
    setEditing(false);
  }
  return <div className={`canvas-element ${selected && !compact ? "is-selected" : ""} ${changed ? "is-changed" : ""} ${!readOnly ? "is-editable" : ""}`}
    style={style} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
    onClick={(event) => { event.stopPropagation(); onSelect?.(element.id); }}
    onDoubleClick={(event) => { if (element.kind === "text" && !readOnly) { event.stopPropagation(); setEditText(element.text); setEditing(true); onSelect?.(element.id); } }}>
    {element.kind === "text" && (editing ? <textarea autoFocus className="canvas-text-editor" style={{ fontSize: fontPx }} value={editText}
      onChange={(event) => setEditText(event.target.value)} onBlur={() => finishText(true)}
      onKeyDown={(event) => { if (event.key === "Escape") finishText(false); if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) finishText(true); }}/>
      : <div className="canvas-text" style={{ fontSize: fontPx, color: element.color, fontWeight: element.bold ? 700 : 400, textAlign: element.align,
        justifyContent: element.valign === "mid" ? "center" : element.valign === "bottom" ? "flex-end" : "flex-start" }}>{element.text || (compact ? "" : "テキストを入力")}</div>)}
    {element.kind === "shape" && <div className={`canvas-shape shape-${element.shape}`} style={{ background: element.shape === "line" ? "transparent" : element.fill, borderColor: element.stroke || element.fill }}/>}
    {element.kind === "image" && <img className="canvas-image" src={`/api/assets/${element.assetId}`} alt={element.alt || "画像"} draggable={false}/>}
    {element.kind === "table" && <table className="canvas-table" style={{ fontSize: Math.max(4, 14 * canvasWidth / 960) }}><tbody>{element.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c} className={r === 0 && element.header ? "table-head" : ""}>{cell}</td>)}</tr>)}</tbody></table>}
    {element.kind === "chart" && <ChartPreview element={element}/>}
    {selected && !compact && !readOnly && <span className="resize-handle" data-resize aria-hidden="true"/>}
  </div>;
}

export function SlideCanvas({ slide, selectedId, changedIds, compact = false, readOnly = false, onSelect, onCommit }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(compact ? 190 : 960);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setWidth(node.getBoundingClientRect().width));
    observer.observe(node);
    setWidth(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={`slide-canvas ${compact ? "slide-canvas-compact" : ""}`} style={{ background: slide.background, aspectRatio: `${SLIDE_W} / ${SLIDE_H}` }}
    onClick={() => onSelect?.(null)}>
    {slide.elements.map((element) => <ElementBox key={element.id} element={element} slideId={slide.id} canvasWidth={width} selected={selectedId === element.id}
      changed={changedIds?.has(element.id) ?? false} compact={compact} readOnly={readOnly || compact} onSelect={onSelect} onCommit={onCommit}/>)}
  </div>;
}
