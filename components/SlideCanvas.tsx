"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { SLIDE_H, SLIDE_W, type ChartElement, type Element, type ShapeElement, type Slide } from "@/lib/document";
import type { Operation } from "@/lib/document";
import { resolveIconComponent } from "@/lib/icons";

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

function ShapeSvg({ element }: { element: ShapeElement }) {
  const isLine = element.shape === "line";
  const fill = isLine ? "none" : element.fill;
  const stroke = element.stroke || (isLine ? element.fill : "none");
  const strokeWidth = element.stroke ? (isLine ? 3 : 1) : (isLine ? 3 : 0);

  switch (element.shape) {
    case "rect":
      return <svg className="canvas-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none"><rect x="0" y="0" width="100" height="100" fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" /></svg>;
    case "roundRect":
      return <svg className="canvas-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none"><rect x="1" y="1" width="98" height="98" rx={clamp((element.radius ?? 0.08) / element.w * 100, 0, 50)} ry={clamp((element.radius ?? 0.08) / element.h * 100, 0, 50)} fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" /></svg>;
    case "ellipse":
      return <svg className="canvas-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none"><ellipse cx="50" cy="50" rx="49" ry="49" fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" /></svg>;
    case "triangle":
      return <svg className="canvas-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="50,2 98,98 2,98" fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" /></svg>;
    case "rightArrow":
      return <svg className="canvas-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="0,30 65,30 65,8 100,50 65,92 65,70 0,70" fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" /></svg>;
    case "leftArrow":
      return <svg className="canvas-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="100,30 35,30 35,8 0,50 35,92 35,70 100,70" fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" /></svg>;
    case "upArrow":
      return <svg className="canvas-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="30,100 30,35 8,35 50,0 92,35 70,35 70,100" fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" /></svg>;
    case "downArrow":
      return <svg className="canvas-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="30,0 30,65 8,65 50,100 92,65 70,65 70,0" fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" /></svg>;
    case "leftRightArrow":
      return <svg className="canvas-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="30,10 0,50 30,90 30,68 70,68 70,90 100,50 70,10 70,32 30,32" fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" /></svg>;
    case "upDownArrow":
      return <svg className="canvas-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="10,30 50,0 90,30 68,30 68,70 90,70 50,100 10,70 32,70 32,30" fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" /></svg>;
    case "chevron":
      return <svg className="canvas-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="0,0 75,0 100,50 75,100 0,100 25,50" fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" /></svg>;
    case "callout":
      return <svg className="canvas-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M 6,4 Q 2,4 2,8 L 2,66 Q 2,70 6,70 L 25,70 L 20,96 L 44,70 L 94,70 Q 98,70 98,66 L 98,8 Q 98,4 94,4 Z" fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" /></svg>;
    case "line": {
      const hasEnd = element.arrowHead === "end" || element.arrowHead === "both";
      const hasStart = element.arrowHead === "start" || element.arrowHead === "both";
      return (
        <svg className="canvas-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line x1={hasStart ? "12" : "0"} y1="50" x2={hasEnd ? "88" : "100"} y2="50" stroke={stroke || fill} strokeWidth="6" />
          {hasStart && <polygon points="0,50 14,35 14,65" fill={stroke || fill} />}
          {hasEnd && <polygon points="100,50 86,35 86,65" fill={stroke || fill} />}
        </svg>
      );
    }
  }
}

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
  const draftRef = useRef<Box | null>(null);
  const editingRef = useRef(false);
  const box = draft ?? element;
  const fontPx = element.kind === "text" ? Math.max(compact ? 3 : 8, element.fontSize * canvasWidth / 960) : 12;
  const style: React.CSSProperties = {
    left: `${box.x / SLIDE_W * 100}%`, top: `${box.y / SLIDE_H * 100}%`,
    width: `${box.w / SLIDE_W * 100}%`, height: `${box.h / SLIDE_H * 100}%`,
    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
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

    if (state.mode === "move") {
      const next = {
        ...state.initial,
        x: round(clamp(state.initial.x + dx, 0, SLIDE_W - state.initial.w)),
        y: round(clamp(state.initial.y + dy, 0, SLIDE_H - state.initial.h)),
      };
      draftRef.current = next;
      setDraft(next);
    } else {
      let nextW = round(clamp(state.initial.w + dx, 0.25, SLIDE_W - state.initial.x));
      let nextH = round(clamp(state.initial.h + dy, 0.2, SLIDE_H - state.initial.y));
      if (event.shiftKey || element.kind === "icon") {
        const ratio = state.initial.w / state.initial.h;
        if (Math.abs(dx) >= Math.abs(dy)) {
          nextH = round(clamp(nextW / ratio, 0.2, SLIDE_H - state.initial.y));
        } else {
          nextW = round(clamp(nextH * ratio, 0.25, SLIDE_W - state.initial.x));
        }
      }
      const next = { ...state.initial, w: nextW, h: nextH };
      draftRef.current = next;
      setDraft(next);
    }
  }
  function up() {
    const state = interaction.current;
    interaction.current = null;
    const finalDraft = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (!state || !state.moved || !finalDraft) return;
    if (state.mode === "move") onCommit?.({ type: "moveElement", slideId, elementId: element.id, x: finalDraft.x, y: finalDraft.y });
    else onCommit?.({ type: "resizeElement", slideId, elementId: element.id, w: finalDraft.w, h: finalDraft.h });
  }
  function cancel() { interaction.current = null; draftRef.current = null; setDraft(null); }
  function finishText(save: boolean) {
    if (!editingRef.current) return;
    editingRef.current = false;
    if (save && element.kind === "text" && editText !== element.text) onCommit?.({ type: "updateText", slideId, elementId: element.id, text: editText });
    setEditing(false);
  }
  return <div className={`canvas-element ${selected && !compact ? "is-selected" : ""} ${changed ? "is-changed" : ""} ${!readOnly ? "is-editable" : ""}`}
    style={style} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}
    onClick={(event) => { event.stopPropagation(); onSelect?.(element.id); }}
    onDoubleClick={(event) => { if (element.kind === "text" && !readOnly) { event.stopPropagation(); setEditText(element.text); editingRef.current = true; setEditing(true); onSelect?.(element.id); } }}>
    {element.kind === "text" && (editing ? <textarea autoFocus className="canvas-text-editor" style={{ fontSize: fontPx }} value={editText}
      onChange={(event) => setEditText(event.target.value)} onBlur={() => finishText(true)}
      onKeyDown={(event) => { if (event.key === "Escape") finishText(false); if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) finishText(true); }}/>
      : <div className="canvas-text" style={{ fontSize: fontPx, color: element.color, fontWeight: element.bold ? 700 : 400, textAlign: element.align,
        justifyContent: element.valign === "mid" ? "center" : element.valign === "bottom" ? "flex-end" : "flex-start" }}>{element.text || (compact ? "" : "テキストを入力")}</div>)}
    {element.kind === "shape" && <ShapeSvg element={element} />}
    {element.kind === "icon" && (() => {
      const IconComp = resolveIconComponent(element.name);
      return (
        <div className="canvas-icon-wrap" style={{ color: element.color }}>
          <IconComp size="100%" color={element.color} strokeWidth={2} />
        </div>
      );
    })()}
    {element.kind === "image" && (
      <img
        className="canvas-image"
        src={`/api/assets/${element.assetId}`}
        alt={element.alt || "画像"}
        draggable={false}
        style={{
          objectFit: element.objectFit || "contain",
          borderRadius: element.borderRadius ? `${Math.round(element.borderRadius * 32)}px` : undefined,
          border: element.stroke ? `2px solid ${element.stroke}` : undefined,
        }}
      />
    )}
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
