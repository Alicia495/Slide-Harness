"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { SLIDE_H, SLIDE_W, type ChartElement, type Element, type ShapeElement, type ShapeType, type Slide } from "@/lib/document";
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

export function ShapePreview({ shape, color, arrowHead }: { shape: ShapeType; color?: string; arrowHead?: "none" | "start" | "end" | "both" }) {
  return <ShapeSvg element={{ kind: "shape", id: "preview", x: 0, y: 0, w: 1, h: 1, rotation: 0, shape, fill: color || "currentColor", arrowHead }} />;
}

function ShapeSvg({ element }: { element: ShapeElement }) {
  const isLine = element.shape === "line";
  const fill = isLine ? "none" : element.fill;
  const stroke = element.stroke || (isLine ? element.fill : "none");
  const strokeWidth = element.stroke ? (isLine ? 3 : 1) : (isLine ? 3 : 0);
  const detail = element.stroke || element.fill;
  const svg = (children: React.ReactNode, aspect = "none") => <svg className="canvas-shape-svg" viewBox="0 0 100 100" preserveAspectRatio={aspect}>{children}</svg>;
  const poly = (points: string) => <polygon points={points} fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />;
  const path = (d: string, evenodd = false) => <path d={d} fill={fill} fillRule={evenodd ? "evenodd" : "nonzero"} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />;
  const detailPath = (d: string, width = 4) => <g fill="none"><path d={d} stroke="#FFFFFF" strokeOpacity="0.7" strokeWidth={width + 4} vectorEffect="non-scaling-stroke" /><path d={d} stroke={detail} strokeWidth={width} vectorEffect="non-scaling-stroke" /></g>;

  switch (element.shape) {
    case "rect":
      return svg(<rect x="0" y="0" width="100" height="100" fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />);
    case "roundRect":
      return svg(<rect x="1" y="1" width="98" height="98" rx={clamp((element.radius ?? 0.08) / element.w * 100, 0, 50)} ry={clamp((element.radius ?? 0.08) / element.h * 100, 0, 50)} fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />);
    case "ellipse":
      return svg(<ellipse cx="50" cy="50" rx="49" ry="49" fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />);
    case "triangle":
      return svg(poly("50,2 98,98 2,98"));
    case "rightArrow":
      return svg(poly("0,30 65,30 65,8 100,50 65,92 65,70 0,70"));
    case "leftArrow":
      return svg(poly("100,30 35,30 35,8 0,50 35,92 35,70 100,70"));
    case "upArrow":
      return svg(poly("30,100 30,35 8,35 50,0 92,35 70,35 70,100"));
    case "downArrow":
      return svg(poly("30,0 30,65 8,65 50,100 92,65 70,65 70,0"));
    case "leftRightArrow":
      return svg(poly("30,10 0,50 30,90 30,68 70,68 70,90 100,50 70,10 70,32 30,32"));
    case "upDownArrow":
      return svg(poly("10,30 50,0 90,30 68,30 68,70 90,70 50,100 10,70 32,70 32,30"));
    case "chevron":
      return svg(poly("0,0 75,0 100,50 75,100 0,100 25,50"));
    case "callout":
      return svg(path("M 6,4 Q 2,4 2,8 L 2,66 Q 2,70 6,70 L 25,70 L 20,96 L 44,70 L 94,70 Q 98,70 98,66 L 98,8 Q 98,4 94,4 Z"));
    case "line": {
      const hasEnd = element.arrowHead === "end" || element.arrowHead === "both";
      const hasStart = element.arrowHead === "start" || element.arrowHead === "both";
      return svg(<>
        <line x1={hasStart ? "12" : "0"} y1="50" x2={hasEnd ? "88" : "100"} y2="50" stroke={stroke || fill} strokeWidth="6" />
        {hasStart && <polygon points="0,50 14,35 14,65" fill={stroke || fill} />}
        {hasEnd && <polygon points="100,50 86,35 86,65" fill={stroke || fill} />}
      </>);
    }
    case "diamond":
      return svg(poly("50,2 98,50 50,98 2,50"));
    case "hexagon":
      return svg(poly("25,2 75,2 98,50 75,98 25,98 2,50"));
    case "pentagon":
      return svg(poly("50,2 98,40 79,97 21,97 2,40"));
    case "octagon":
      return svg(poly("32,2 68,2 98,32 98,68 68,98 32,98 2,68 2,32"));
    case "parallelogram":
      return svg(poly("26,2 98,2 74,98 2,98"));
    case "trapezoid":
      return svg(poly("22,2 78,2 98,98 2,98"));
    case "star4":
      return svg(poly("50,2 61,39 98,50 61,61 50,98 39,61 2,50 39,39"));
    case "star5":
      return svg(poly("50,2 61.8,35 98,36 69,58.5 79.4,95 50,73.5 20.6,95 31,58.5 2,36 38.2,35"));
    case "star6":
      return svg(poly("50,2 69,25 98,25 79,50 98,75 69,75 50,98 31,75 2,75 21,50 2,25 31,25"));
    case "plus":
      return svg(poly("38,2 62,2 62,38 98,38 98,62 62,62 62,98 38,98 38,62 2,62 2,38 38,38"));
    case "donut":
      return svg(path("M50,2 a48,48 0 1 0 0.1,0 Z M50,26 a24,24 0 1 0 0.1,0 Z", true));
    case "heart":
      return svg(path("M50,94 C18,66 2,46 2,26 C2,11 13,2 27,2 C38,2 46,9 50,17 C54,9 62,2 73,2 C87,2 98,11 98,26 C98,46 82,66 50,94 Z"));
    case "sun":
      return svg(poly(Array.from({ length: 24 }, (_, i) => {
        const r = i % 2 ? 30 : 48;
        const a = (i * 15 - 90) * Math.PI / 180;
        return `${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`;
      }).join(" ")));
    case "frame":
      return svg(path("M4,4 H96 V96 H4 Z M18,18 H82 V82 H18 Z", true));
    case "plaque":
      return svg(<>
        {path("M2,8 Q2,2 8,2 H92 Q98,2 98,8 V92 Q98,98 92,98 H8 Q2,98 2,92 Z")}
        {detailPath("M12,12 H88 V88 H12 Z")}
      </>);
    case "corner":
      return svg(poly("2,2 98,98 2,98"));
    case "bentArrow":
      return svg(poly("2,2 70,2 70,58 84,58 56,98 28,58 42,58 42,22 2,22"));
    case "bentUpArrow":
      return svg(poly("2,98 70,98 70,42 84,42 56,2 28,42 42,42 42,78 2,78"));
    case "curvedRightArrow":
      return svg(<>
        {path("M2,98 V48 A48,48 0 0 1 50,0 H70 V20 H50 A30,30 0 0 0 22,48 V98 Z")}
        <polygon points="64,-4 100,11 64,26" fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
      </>);
    case "curvedLeftArrow":
      return svg(<>
        {path("M98,98 V48 A48,48 0 0 0 50,0 H30 V20 H50 A30,30 0 0 1 78,48 V98 Z")}
        <polygon points="36,-4 0,11 36,26" fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
      </>);
    case "quadArrow":
      return svg(<>
        {poly("42,16 58,16 58,42 84,42 84,58 58,58 58,84 42,84 42,58 16,58 16,42 42,42")}
        {poly("50,0 64,18 36,18")}
        {poly("50,100 36,82 64,82")}
        {poly("100,50 82,36 82,64")}
        {poly("0,50 18,36 18,64")}
      </>);
    case "circularArrow":
      return svg(<>
        <path d="M50,10 A40,40 0 1 1 10,50" fill="none" stroke={detail} strokeWidth={13} strokeLinecap="butt" />
        <polygon points="-2,60 22,60 10,24" fill={detail} />
      </>);
    case "cloudCallout":
      return svg(<>
        {path("M14,62 C2,62 0,44 12,40 C8,24 26,14 40,22 C46,8 66,8 74,22 C90,16 102,30 94,44 C104,50 100,64 88,62 Z")}
        <polygon points="32,60 26,92 50,64" fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
      </>);
    case "wedgeRectCallout":
      return svg(path("M2,2 H98 V70 H44 L26,98 L36,70 H2 Z"));
    case "leftArrowCallout":
      return svg(poly("36,2 98,2 98,98 36,98 36,72 0,50 36,28"));
    case "rightArrowCallout":
      return svg(poly("2,2 64,2 64,28 100,50 64,72 64,98 2,98"));
    case "flowChartTerminator":
      return svg(<rect x="2" y="2" width="96" height="96" rx="48" ry="48" fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />);
    case "flowChartProcess":
      return svg(poly("2,2 98,2 98,98 2,98"));
    case "flowChartDecision":
      return svg(poly("50,2 98,50 50,98 2,50"));
    case "flowChartInputOutput":
      return svg(poly("26,2 98,2 74,98 2,98"));
    case "flowChartPredefinedProcess":
      return svg(<>
        {poly("2,2 98,2 98,98 2,98")}
        {detailPath("M14,2 V98 M86,2 V98")}
      </>);
    case "flowChartDocument":
      return svg(path("M2,2 H98 V78 C82,96 66,74 50,82 C34,90 18,94 2,82 Z"));
    case "flowChartMultidocument":
      return svg(<>
        {path("M18,0 H100 V70 C86,84 72,64 58,70 C44,76 30,80 18,70 Z")}
        {path("M0,16 H82 V88 C68,102 54,82 40,88 C26,94 12,98 0,88 Z")}
      </>);
    case "flowChartInternalStorage":
      return svg(<>
        {poly("2,2 98,2 98,98 2,98")}
        {detailPath("M2,16 H98 M2,84 H98 M20,16 C4,30 4,70 20,84")}
      </>);
    case "flowChartConnector":
      return svg(<ellipse cx="50" cy="50" rx="48" ry="48" fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />);
    case "flowChartOffpageConnector":
      return svg(poly("2,2 98,2 98,60 50,98 2,60"));
    case "flowChartManualInput":
      return svg(poly("16,2 98,2 98,98 2,98"));
    case "flowChartPreparation":
      return svg(poly("2,24 24,2 76,2 98,24 98,76 76,98 24,98 2,76"));
    case "flowChartDelay":
      return svg(path("M2,2 H50 A48,48 0 0 1 50,98 H2 Z"));
    case "flowChartMerge":
      return svg(poly("2,2 98,2 66,98 34,98"));
    case "flowChartCollate":
      return svg(poly("2,2 62,2 98,50 62,98 2,98"));
    case "flowChartSort":
      return svg(<>
        {poly("2,2 98,2 98,98 2,98")}
        {detailPath("M2,2 L98,98 M2,98 L98,2")}
      </>);
    case "flowChartSummingJunction":
      return svg(<>
        <ellipse cx="50" cy="50" rx="48" ry="48" fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
        {detailPath("M50,26 a24,24 0 1 0 0.1,0 Z")}
      </>);
    case "flowChartOr":
      return svg(<>
        <ellipse cx="50" cy="50" rx="48" ry="48" fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
        {detailPath("M14,14 L86,86 M14,86 L86,14")}
      </>);
    case "flowChartExtract":
      return svg(<>
        {poly("50,2 98,50 50,98 2,50")}
        {detailPath("M50,26 L74,50 L50,74 L26,50 Z")}
      </>);
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
