"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDown, ArrowDownToLine, ArrowLeft, ArrowUp, ArrowUpToLine, Check, ChevronDown, CircleAlert, CircleCheck, Download, Eye, FilePlus2, History, ImagePlus, Layers3, LayoutTemplate, ListChecks, Loader2, MessageSquare, Plus, RotateCcw, RotateCw, Send, Settings2, Shapes, Smile, Sparkles, Trash2, X } from "lucide-react";
import { slideTitle, type Deck, type Element, type Operation, type ShapeType, type Slide, type Theme } from "@/lib/document";
import type { ModelProfile } from "@/lib/ai";
import type { ChatMessage, ProjectRecord, Proposal } from "@/lib/projects";
import { SlideCanvas, ShapePreview } from "./SlideCanvas";
import { IconPickerModal } from "./IconPickerModal";
import { Modal } from "./Modal";

type HistoryItem = { version: number; source: string; summary: string; createdAt: string };
type ProjectPayload = { project: ProjectRecord; history: HistoryItem[]; messages: ChatMessage[]; proposal: Proposal | null };
type SaveState = "saved" | "saving" | "error";

type ShapePickerItem = { shape: ShapeType; label: string; arrowHead?: "none" | "start" | "end" | "both" };
const SHAPE_GROUPS: { label: string; items: ShapePickerItem[] }[] = [
  { label: "基本図形", items: [
    { shape: "rect", label: "四角" },
    { shape: "roundRect", label: "角丸" },
    { shape: "ellipse", label: "円" },
    { shape: "triangle", label: "三角" },
    { shape: "diamond", label: "ひし形" },
    { shape: "hexagon", label: "六角形" },
    { shape: "pentagon", label: "五角形" },
    { shape: "octagon", label: "八角形" },
    { shape: "parallelogram", label: "平行四辺形" },
    { shape: "trapezoid", label: "台形" },
    { shape: "star4", label: "星(4)" },
    { shape: "star5", label: "星" },
    { shape: "star6", label: "星(6)" },
    { shape: "plus", label: "十字" },
    { shape: "donut", label: "ドンナト" },
    { shape: "heart", label: "ハート" },
    { shape: "sun", label: "太陽" },
    { shape: "frame", label: "額枠" },
    { shape: "plaque", label: "額縁" },
    { shape: "corner", label: "コーナー" },
  ] },
  { label: "線・矢印", items: [
    { shape: "line", label: "直線" },
    { shape: "line", label: "矢印線", arrowHead: "end" },
    { shape: "line", label: "双方向線", arrowHead: "both" },
    { shape: "rightArrow", label: "右矢印" },
    { shape: "leftArrow", label: "左矢印" },
    { shape: "upArrow", label: "上矢印" },
    { shape: "downArrow", label: "下矢印" },
    { shape: "leftRightArrow", label: "左右両矢印" },
    { shape: "upDownArrow", label: "上下両矢印" },
    { shape: "chevron", label: "シェブロン" },
    { shape: "bentArrow", label: "折れ矢印(下)" },
    { shape: "bentUpArrow", label: "折れ矢印(上)" },
    { shape: "curvedRightArrow", label: "カーブ矢印(右)" },
    { shape: "curvedLeftArrow", label: "カーブ矢印(左)" },
    { shape: "quadArrow", label: "十字矢印" },
    { shape: "circularArrow", label: "循環矢印" },
  ] },
  { label: "吹き出し", items: [
    { shape: "callout", label: "吹き出し" },
    { shape: "wedgeRectCallout", label: "角吹き出し" },
    { shape: "cloudCallout", label: "雲吹き出し" },
    { shape: "leftArrowCallout", label: "左矢印吹き出し" },
    { shape: "rightArrowCallout", label: "右矢印吹き出し" },
  ] },
  { label: "フローチャート", items: [
    { shape: "flowChartTerminator", label: "開始/終了" },
    { shape: "flowChartProcess", label: "処理" },
    { shape: "flowChartDecision", label: "判断" },
    { shape: "flowChartInputOutput", label: "入出力" },
    { shape: "flowChartPredefinedProcess", label: "事前定義処理" },
    { shape: "flowChartDocument", label: "文書" },
    { shape: "flowChartMultidocument", label: "複数文書" },
    { shape: "flowChartInternalStorage", label: "内部ストレージ" },
    { shape: "flowChartConnector", label: "結合子" },
    { shape: "flowChartOffpageConnector", label: "オフページ" },
    { shape: "flowChartManualInput", label: "手入力" },
    { shape: "flowChartPreparation", label: "準備" },
    { shape: "flowChartDelay", label: "遅延" },
    { shape: "flowChartMerge", label: "マージ" },
    { shape: "flowChartCollate", label: "照合" },
    { shape: "flowChartSort", label: "ソート" },
    { shape: "flowChartSummingJunction", label: "合流点" },
    { shape: "flowChartOr", label: "OR" },
    { shape: "flowChartExtract", label: "抽出" },
  ] },
];

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error || "通信に失敗しました。", response.status);
  return data as T;
}
const post = <T,>(url: string, body: unknown) => jsonRequest<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function relativeTime(value: string) {
  return new Date(value).toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

type ChatStatus = { phase: string; attempt?: number; tool?: string; status?: string };

// ツールループの tool phase を、ツール名から簡潔な日本語の進行文へ変換する。
function toolPhaseLabel(tool?: string): string {
  if (!tool) return "資料を操作しています…";
  if (tool.startsWith("get_")) return "スライドを読み込んでいます…";
  if (tool.startsWith("read_")) return "スライドを読み込んでいます…";
  if (tool.startsWith("edit_")) return "要素を編集しています…";
  if (tool.startsWith("write_")) return "スライドを書き換えています…";
  if (tool.startsWith("render_")) return "スライドを描画しています…";
  if (tool.startsWith("inspect_")) return "レイアウトと見た目を確認しています…";
  if (tool.startsWith("reflow_")) return "レイアウトを整えています…";
  if (tool.startsWith("commit_")) return "変更を適用しています…";
  return "資料を操作しています…";
}

function phaseLabel(status: ChatStatus | null, mode: "plan" | "build"): string {
  switch (status?.phase) {
    case "context": return "会話の記憶を整理しています…";
    case "generating": return mode === "plan" ? "構成案を作成しています…" : (status && status.attempt && status.attempt > 1 ? "AI の応答を組み直しています…" : "スライドの内容を生成しています…");
    case "repair": return mode === "plan" ? "構成案を再検証しています…" : "生成結果を再検証しています…";
    case "vision": return `AI が画像で意図一致を自己チェックしています…${status && status.attempt && status.attempt > 1 ? `(${status.attempt - 1} 回目以降の再確認)` : ""}`;
    case "rendering": return "出力プレビューを描画しています…";
    case "tool": return toolPhaseLabel(status?.tool);
    default: return "考えています…";
  }
}

// ツールループの実行中に飛来する activity イベントを、実行中フィードの行へ変換する。
type ChatActivityItem =
  | { key: string; kind: "step"; step: number }
  | { key: string; kind: "reasoning" | "text"; text: string }
  | { key: string; kind: "tool"; tool: string; status: "start" | "result" | "error"; args?: string; summary?: string };

function applyChatActivity(items: ChatActivityItem[], evt: Record<string, unknown>): ChatActivityItem[] {
  const kind = String(evt.kind ?? "");
  if (kind === "step") return [...items, { key: `step-${String(evt.step)}`, kind: "step", step: Number(evt.step) }];
  if (kind === "tool") {
    const callId = String(evt.callId ?? "");
    const status = String(evt.status ?? "start");
    const summary = typeof evt.summary === "string" ? evt.summary : undefined;
    for (let index = items.length - 1; index >= 0; index--) {
      const item = items[index];
      if (item.kind === "tool" && item.key === callId && item.status === "start") {
        const next = [...items];
        next[index] = { ...item, status: status === "error" ? "error" : "result", summary };
        return next;
      }
    }
    return [...items, { key: callId, kind: "tool", tool: String(evt.tool ?? ""), status: "start", args: typeof evt.args === "string" ? evt.args : undefined }];
  }
  if (kind === "reasoning" || kind === "text") {
    const chunk = String(evt.text ?? "");
    const last = items[items.length - 1];
    if (last && (last.kind === "reasoning" || last.kind === "text") && last.kind === kind) {
      return [...items.slice(0, -1), { key: last.key, kind: last.kind, text: last.text + chunk }];
    }
    return [...items, { key: `${kind}-${String(items.length)}`, kind, text: chunk }];
  }
  return items;
}

function elementColor(el: Element): string | undefined {
  if (el.kind === "shape") return el.fill;
  if (el.kind === "text" || el.kind === "icon") return el.color;
  return undefined;
}

export function Editor({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [models, setModels] = useState<ModelProfile[]>([]);
  const [modelId, setModelId] = useState("");
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [previewProposal, setPreviewProposal] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showTheme, setShowTheme] = useState(false);
  const [showShapes, setShowShapes] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [renderedSlides, setRenderedSlides] = useState<string[]>([]);
  const [renderPage, setRenderPage] = useState(0);
  const [showOutputPreview, setShowOutputPreview] = useState(false);
  const [undoTargets, setUndoTargets] = useState<number[]>([]);
  const [redoTargets, setRedoTargets] = useState<number[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMode, setChatMode] = useState<"plan" | "build">("build");
  const [templates, setTemplates] = useState<{ id: string; name: string; theme: Theme }[]>([]);
  const [showPlan, setShowPlan] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const chatActivityEnd = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragSlide = useRef<string | null>(null);
  const commitInFlight = useRef(false);
  const chatAbort = useRef<AbortController | null>(null);
  const [retryOps, setRetryOps] = useState<Operation[] | null>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  const [chatStatus, setChatStatus] = useState<ChatStatus | null>(null);
  const [chatActivity, setChatActivity] = useState<ChatActivityItem[]>([]);
  const [chatElapsed, setChatElapsed] = useState(0);
  const [proposalPreview, setProposalPreview] = useState<{ id: string; slides: string[] } | null>(null);
  const [chatWidth, setChatWidth] = useState(348);
  const chatWidthRef = useRef(348);

  const load = useCallback(async (initial = false) => {
    const data = await jsonRequest<ProjectPayload>(`/api/projects/${projectId}`);
    setProject(data.project); setHistory(data.history); setMessages(data.messages); setProposal(data.proposal);
    setSelectedSlideId((old) => old && data.project.deck.slides.some((s) => s.id === old) ? old : data.project.deck.slides[0]?.id ?? null);
    setSelectedElementId((old) => old && data.project.deck.slides.some((s) => s.elements.some((e) => e.id === old)) ? old : null);
    if (initial) setLoading(false);
    return data;
  }, [projectId]);

  useEffect(() => {
    const modelStorageKey = `slide-harness:model:${projectId}`;
    Promise.all([
      load(true),
      jsonRequest<{ models: ModelProfile[] }>("/api/models").then((data) => {
        setModels(data.models);
        let stored = "";
        try { stored = window.localStorage.getItem(modelStorageKey) ?? ""; } catch { stored = ""; }
        setModelId((old) => old || (data.models.some((model) => model.id === stored) ? stored : "") || data.models[0]?.id || "");
      }),
    ]).catch((reason) => { setError(reason.message); setLoading(false); });
    jsonRequest<{ templates: { id: string; name: string; theme: Theme }[] }>("/api/templates")
      .then((data) => setTemplates(data.templates.map((template) => ({ id: template.id, name: template.name, theme: template.theme }))))
      .catch(() => undefined);
  }, [load, projectId]);
  useEffect(() => {
    if (!modelId) return;
    try { window.localStorage.setItem(`slide-harness:model:${projectId}`, modelId); } catch { /* プライベートモード等では無視 */ }
  }, [modelId, projectId]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);
  useEffect(() => { chatActivityEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [chatActivity]);
  useEffect(() => {
    if (!busy) return;
    setChatElapsed(0);
    const timer = window.setInterval(() => setChatElapsed((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 960px)");
    const sync = (event: MediaQueryListEvent) => setIsNarrow(event.matches);
    setIsNarrow(query.matches);
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem("slide-harness:chatWidth"));
      if (Number.isFinite(saved) && saved >= 280 && saved <= 640) { chatWidthRef.current = saved; setChatWidth(saved); }
    } catch { /* プライベートモード等では無視 */ }
  }, []);

  function startChatResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = chatWidthRef.current;
    const onMove = (moveEvent: PointerEvent) => {
      const width = Math.min(640, Math.max(280, startWidth - (moveEvent.clientX - startX)));
      chatWidthRef.current = width;
      setChatWidth(width);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("chat-resizing");
      try { window.localStorage.setItem("slide-harness:chatWidth", String(chatWidthRef.current)); } catch { /* 無視 */ }
    };
    document.body.classList.add("chat-resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  async function clearChat() {
    if (!project || busy) return;
    if (!window.confirm("チャット履歴をすべて削除します。よろしいですか？")) return;
    setBusy(true); setError("");
    try {
      await post(`/api/projects/${projectId}/chat/clear`, {});
      setNotice("チャット履歴をクリアしました。");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "チャット履歴をクリアできませんでした。"); }
    finally { setBusy(false); }
  }

  const displayDeck: Deck | null = proposal && previewProposal ? proposal.proposedDeck : project?.deck ?? null;
  const selectedSlide: Slide | undefined = displayDeck?.slides.find((s) => s.id === selectedSlideId) ?? displayDeck?.slides[0];
  const currentSlide = project?.deck.slides.find((s) => s.id === selectedSlideId);
  const selectedElement: Element | undefined = currentSlide?.elements.find((e) => e.id === selectedElementId);
  const selectedIndex = displayDeck && selectedSlide ? displayDeck.slides.findIndex((s) => s.id === selectedSlide.id) : -1;
  const targetLabel = selectedElement ? `${selectedIndex + 1}枚目 · ${selectedElement.kind === "text" ? selectedElement.text.slice(0, 18) || "テキスト" : selectedElement.kind}` : currentSlide ? `${project!.deck.slides.findIndex((s) => s.id === currentSlide.id) + 1}枚目 · スライド全体` : "資料全体";
  const changedIds = useMemo(() => new Set(proposal?.operations.flatMap((op) => "elementId" in op ? [op.elementId] : []) ?? []), [proposal]);

  async function commit(operations: Operation[]) {
    if (!project || busy || proposal || commitInFlight.current) return;
    commitInFlight.current = true;
    const previousVersion = project.version;
    setSaveState("saving"); setError("");
    try {
      const result = await post<{ project: ProjectRecord }>(`/api/projects/${projectId}/operations`, { baseVersion: previousVersion, operations });
      setProject(result.project); setUndoTargets((items) => [...items, previousVersion]); setRedoTargets([]);
      setSaveState("saved"); setRetryOps(null);
      const refreshed = await load();
      return refreshed.project;
    } catch (reason) {
      setSaveState("error"); setError(reason instanceof Error ? reason.message : "保存に失敗しました。");
      setRetryOps(operations);
      if (reason instanceof ApiError && reason.status === 409) {
        // 競合時は最新状態を再取得し、編集を継続できる状態に戻す。
        setNotice("他の変更が先に保存されたため、最新の状態を読み込みました。再試行は現在の版に基づいて行われます。");
        await load().catch(() => undefined);
      }
    }
    finally { commitInFlight.current = false; }
  }

  async function sendChat(event?: FormEvent) {
    event?.preventDefault();
    if (!project || !prompt.trim() || !modelId || busy || proposal || commitInFlight.current) return;
    const message = prompt.trim();
    const previousVersion = project.version;
    // 非 secure origin(http の IP アクセス)でも動くよう crypto.randomUUID は使わない。
    const pendingId = `pending-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    // 送信内容をサーバー完了を待たず即座にチャット欄へ表示する(楽観表示)。
    setMessages((prev) => [...prev, { id: pendingId, role: "user" as const, content: message, metadata: { pending: true }, createdAt: new Date().toISOString() }]);
    setBusy(true); setChatStatus({ phase: "sending" }); setChatActivity([]); setError(""); setNotice(""); setPrompt("");
    const controller = new AbortController();
    chatAbort.current = controller;
    const removePending = () => setMessages((prev) => prev.filter((item) => item.id !== pendingId));
    try {
      const response = await fetch(`/api/projects/${projectId}/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({
          baseVersion: previousVersion, prompt: message, modelId, mode: chatMode,
          target: chatMode === "build" && currentSlide ? { slideId: currentSlide.id, elementId: selectedElement?.id } : undefined,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new ApiError((data as { error?: string }).error || "通信に失敗しました。", response.status);
      }
      if (!response.body) throw new ApiError("応答を取得できませんでした。", 502);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: Record<string, unknown> | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line) as Record<string, unknown>;
          if (evt.type === "phase") setChatStatus({ phase: String(evt.phase), attempt: typeof evt.attempt === "number" ? evt.attempt : undefined, tool: typeof evt.tool === "string" ? evt.tool : undefined, status: typeof evt.status === "string" ? evt.status : undefined });
          else if (evt.type === "activity") setChatActivity((items) => applyChatActivity(items, evt));
          else if (evt.type === "result") result = evt;
          else if (evt.type === "error") throw new ApiError(String(evt.error || "AI 処理に失敗しました。"), Number(evt.status || 500));
        }
      }
      if (!result) throw new ApiError("AI 応答が途中で終了しました。時間をおいて再試行してください。", 502);
      const mode = result.mode as "applied" | "proposal" | "plan" | "chat";
      if (mode === "applied") {
        setUndoTargets((items) => [...items, previousVersion]); setRedoTargets([]);
        setNotice(result.compacted ? "会話の記憶を整理し、AI の修正を反映しました。" : "AI の修正を反映しました。元に戻すこともできます。");
      } else if (mode === "proposal") {
        const slides = Array.isArray(result.previewSlides) ? result.previewSlides as string[] : [];
        setProposalPreview({ id: (result.proposal as Proposal).id, slides });
        setPreviewProposal(true);
        setNotice(slides.length ? "変更案を作成しました。出力プレビュー画像で意図どおりかを確認してから適用してください。" : "変更案を確認してください。");
      }
      else if (mode === "plan") { setChatOpen(true); setNotice(Array.isArray(result.questions) && (result.questions as string[]).length ? "AI から資料について確認の質問が届きました。入力欄に回答してください。" : "構成案を作成しました。内容を確認して「計画として採用」を押してください。"); }
      else setNotice(Array.isArray(result.questions) && (result.questions as string[]).length ? "AI から質問・提案が届きました。入力欄に回答するとそのまま作成を進めます。" : "AI が回答しました。");
      await load();
    } catch (reason) {
      removePending();
      if (controller.signal.aborted) {
        // キャンセルは通常のエラーとして扱わない。
        setPrompt(message);
        setNotice("AI へのリクエストをキャンセルしました。入力はそのまま残っています。");
      } else {
        setPrompt(message);
        setError(reason instanceof Error ? reason.message : "AI 処理に失敗しました。");
        if (reason instanceof ApiError && reason.status === 409) setNotice("他の変更が先に保存されたため、最新の状態を読み込みました。");
        await load().catch(() => undefined);
      }
    } finally { setBusy(false); setChatStatus(null); setChatActivity([]); chatAbort.current = null; }
  }

  function cancelChat() {
    chatAbort.current?.abort();
  }

  async function decide(accept: boolean) {
    if (!proposal || busy || !project) return;
    setBusy(true); setError("");
    try {
      await post(`/api/projects/${projectId}/proposals/${proposal.id}`, { accept });
      if (accept) { setUndoTargets((items) => [...items, project.version]); setRedoTargets([]); setNotice("変更案を適用しました。"); }
      else setNotice("変更案を破棄しました。");
      setPreviewProposal(false);
      setProposalPreview(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "変更案を処理できませんでした。");
      if (reason instanceof ApiError && reason.status === 409) await load().catch(() => undefined);
    }
    finally { setBusy(false); }
  }

  async function restore(targetVersion: number, kind: "undo" | "redo" | "history") {
    if (!project || busy || proposal || commitInFlight.current) return;
    const currentVersion = project.version;
    setBusy(true); setError("");
    try {
      await post(`/api/projects/${projectId}/restore`, { baseVersion: currentVersion, restoreVersion: targetVersion });
      if (kind === "undo") { setUndoTargets((items) => items.slice(0, -1)); setRedoTargets((items) => [...items, currentVersion]); }
      if (kind === "redo") { setRedoTargets((items) => items.slice(0, -1)); setUndoTargets((items) => [...items, currentVersion]); }
      if (kind === "history") { setUndoTargets((items) => [...items, currentVersion]); setRedoTargets([]); setShowHistory(false); }
      setNotice(`版 ${targetVersion} の内容に復元しました。`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "復元できませんでした。");
      if (reason instanceof ApiError && reason.status === 409) await load().catch(() => undefined);
    }
    finally { setBusy(false); }
  }

  async function download() {
    if (!project || exporting) return;
    setExporting(true); setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/export`);
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || "PPTX を出力できませんでした。"); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = `${project.title.replace(/[\\/:*?"<>|]/g, "_")}.pptx`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setNotice("PPTX を出力しました。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "PPTX を出力できませんでした。"); }
    finally { setExporting(false); }
  }

  async function previewOutput() {
    if (!project || rendering || !project.deck.slides.length) return;
    setRendering(true); setError("");
    try {
      const result = await post<{ slides: string[] }>(`/api/projects/${projectId}/render`, {});
      setRenderedSlides(result.slides); setRenderPage(0); setShowOutputPreview(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "出力プレビューを生成できませんでした。"); }
    finally { setRendering(false); }
  }

  async function renderProposalPreview() {
    if (!proposal || rendering) return;
    setRendering(true); setError("");
    try {
      const result = await post<{ slides: string[] }>(`/api/projects/${projectId}/proposals/${proposal.id}/render`, {});
      setProposalPreview({ id: proposal.id, slides: result.slides });
      setRenderedSlides(result.slides); setRenderPage(0); setShowOutputPreview(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "変更案のプレビューを生成できませんでした。"); }
    finally { setRendering(false); }
  }

  function openProposalPreview(slides: string[], page: number) {
    setRenderedSlides(slides); setRenderPage(page); setShowOutputPreview(true);
  }

  async function upload(file: File) {
    if (!project || !currentSlide) { setError("先にスライドを作成してください。"); return; }
    if (busy || proposal || commitInFlight.current) return;
    setSaveState("saving"); setError("");
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch(`/api/projects/${projectId}/assets`, { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "画像を追加できませんでした。");
      await commit([{ type: "addImage", slideId: currentSlide.id, assetId: data.asset.id, x: 2, y: 2, w: 4.5, h: 3.2, alt: file.name }]);
    } catch (reason) { setSaveState("error"); setError(reason instanceof Error ? reason.message : "画像を追加できませんでした。"); }
  }

  function addShape(shape: ShapeType, extra: { arrowHead?: "none" | "start" | "end" | "both" } = {}) {
    if (!currentSlide || !project || busy || proposal || commitInFlight.current) return;
    const isLine = shape === "line";
    const isArrow = shape.includes("Arrow") || shape === "chevron";
    const isRound = ["ellipse", "donut", "sun", "heart", "star4", "star5", "star6", "plus", "circularArrow", "flowChartConnector", "flowChartSummingJunction", "flowChartOr"].includes(shape);
    const w = isLine ? 3.5 : isRound ? 2.2 : isArrow ? 2.0 : 2.5;
    const h = isLine ? 0.4 : isRound ? 2.2 : isArrow ? 0.8 : 2.0;
    void commit([{
      type: "addShape",
      slideId: currentSlide.id,
      shape,
      x: 5.4,
      y: 2.8,
      w,
      h,
      fill: isArrow ? project.deck.theme.accent : project.deck.theme.primary,
      arrowHead: extra.arrowHead,
      rotation: 0,
    }]);
  }

  function addIcon(name: string) {
    if (!currentSlide || !project || busy || proposal || commitInFlight.current) return;
    void commit([{
      type: "addIcon",
      slideId: currentSlide.id,
      name,
      x: 6.2,
      y: 3.2,
      w: 0.9,
      h: 0.9,
      color: project.deck.theme.primary,
      rotation: 0,
    }]);
  }

  function reorderSelected(action: "bringToFront" | "sendToBack" | "bringForward" | "sendBackward") {
    if (!currentSlide || !selectedElement || busy || proposal || commitInFlight.current) return;
    void commit([{
      type: "reorderElement",
      slideId: currentSlide.id,
      elementId: selectedElement.id,
      action,
    }]);
  }

  function rotateSelected(delta: number) {
    if (!currentSlide || !selectedElement || !["text", "shape", "icon"].includes(selectedElement.kind) || busy || proposal || commitInFlight.current) return;
    const rotation = (selectedElement.rotation + delta + 360) % 360;
    void commit([{ type: "updateStyle", slideId: currentSlide.id, elementId: selectedElement.id, rotation }]);
  }

  function deleteSelected() {
    if (!currentSlide || !selectedElement || busy || proposal || commitInFlight.current) return;
    const id = selectedElement.id;
    setSelectedElementId(null);
    void commit([{
      type: "deleteElement",
      slideId: currentSlide.id,
      elementId: id,
    }]);
  }

  function updateSelectedColor(color: string) {
    if (!currentSlide || !selectedElement || busy || proposal || commitInFlight.current) return;
    if (selectedElement.kind === "text") {
      void commit([{ type: "updateStyle", slideId: currentSlide.id, elementId: selectedElement.id, color }]);
    } else if (selectedElement.kind === "shape") {
      void commit([{ type: "updateStyle", slideId: currentSlide.id, elementId: selectedElement.id, fill: color }]);
    } else if (selectedElement.kind === "icon") {
      void commit([{ type: "updateStyle", slideId: currentSlide.id, elementId: selectedElement.id, color }]);
    }
  }

  function updateImageProperties(properties: { objectFit?: "contain" | "cover" | "fill"; borderRadius?: number; stroke?: string | null }) {
    if (!currentSlide || !selectedElement || selectedElement.kind !== "image" || busy || proposal || commitInFlight.current) return;
    void commit([{
      type: "updateImageProps",
      slideId: currentSlide.id,
      elementId: selectedElement.id,
      ...properties,
    }]);
  }

  async function testConnection() {
    if (!modelId) return;
    setNotice("AI への接続を確認しています…");
    try {
      await post(`/api/models/test`, { modelId });
      setNotice("AI に接続できました。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "AI に接続できませんでした。"); }
  }

  async function adoptPlan(plan: string) {
    if (busy || !project) return;
    setBusy(true); setError("");
    try {
      await post(`/api/projects/${projectId}/plan`, { plan, baseVersion: project.version });
      setChatMode("build");
      setNotice("構成計画を資料に保存しました。作成モードでの生成にこの構成が使われます。");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "構成計画を保存できませんでした。");
      if (reason instanceof ApiError && reason.status === 409) {
        setNotice("他の変更が先に保存されたため、最新の状態を読み込みました。再度操作してください。");
        await load().catch(() => undefined);
      }
    }
    finally { setBusy(false); }
  }

  async function clearPlan() {
    if (busy || !project) return;
    setBusy(true); setError("");
    try {
      await post(`/api/projects/${projectId}/plan`, { plan: null, baseVersion: project.version });
      setNotice("構成計画を解除しました。");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "構成計画を解除できませんでした。");
      if (reason instanceof ApiError && reason.status === 409) {
        setNotice("他の変更が先に保存されたため、最新の状態を読み込みました。再度操作してください。");
        await load().catch(() => undefined);
      }
    }
    finally { setBusy(false); }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      // 入力欄・セレクト・ボタン等の操作コントロールで発生したキーは無視する(Backspace/Delete の誤削除防止)。
      if (target.closest('input, textarea, select, button, a[href], [role="button"], [contenteditable=true]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) { const target = redoTargets.at(-1); if (target !== undefined) void restore(target, "redo"); } else { const target = undoTargets.at(-1); if (target !== undefined) void restore(target, "undo"); } }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); const target = redoTargets.at(-1); if (target !== undefined) void restore(target, "redo"); }
      if (event.key === "Escape") {
        if (document.querySelector(".modal-backdrop")) return;
        if (sidebarOpen || chatOpen) { setSidebarOpen(false); setChatOpen(false); return; }
        setSelectedElementId(null);
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedElementId) {
        if (document.querySelector(".modal-backdrop")) return;
        event.preventDefault();
        deleteSelected();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (loading) return <div className="app-loading"><span className="brand-mark"><Layers3 size={22}/></span><Loader2 className="spin" size={24}/><span>資料を開いています…</span></div>;
  if (!project) return <div className="app-loading"><CircleAlert size={24}/><span>{error || "資料を読み込めませんでした。"}</span><Link href="/">一覧へ戻る</Link></div>;

  return <div className="editor-shell">
    <header className="editor-header">
      <div className="header-left">
        <Link href="/" className="icon-button" title="一覧へ戻る"><ArrowLeft size={18}/></Link>
        <span className="header-divider"/>
        <span className="brand-mark small"><Layers3 size={17}/></span>
        <div className="project-name"><strong>{project.title}</strong><span>{project.deck.slides.length}枚のスライド</span></div>
      </div>
      <div className="header-center">
        <span className={`save-indicator ${saveState === "error" ? "has-error" : ""}`}>{saveState === "saving" ? <Loader2 size={14} className="spin"/> : saveState === "error" ? <CircleAlert size={14}/> : <CircleCheck size={14}/>} {saveState === "saving" ? "保存中" : saveState === "error" ? "保存失敗" : "保存済み"}</span>
        <button className="icon-button" title="元に戻す (Ctrl+Z)" disabled={!undoTargets.length || busy || !!proposal || saveState === "saving"} onClick={() => void restore(undoTargets.at(-1)!, "undo")}><RotateCcw size={17}/></button>
        <button className="icon-button" title="やり直す (Ctrl+Y)" disabled={!redoTargets.length || busy || !!proposal || saveState === "saving"} onClick={() => void restore(redoTargets.at(-1)!, "redo")}><RotateCw size={17}/></button>
        <button className="icon-button" title="版の履歴" onClick={() => setShowHistory(true)}><History size={18}/></button>
      </div>
      <div className="header-right">
        <button className="icon-button responsive-toggle" title="スライド一覧" aria-label="スライド一覧" aria-expanded={sidebarOpen} aria-controls="slide-sidebar" onClick={() => { setChatOpen(false); setSidebarOpen(!sidebarOpen); }}><Layers3 size={18}/></button>
        <button className="icon-button responsive-toggle" title="AI チャット" aria-label="AI チャット" aria-expanded={chatOpen} aria-controls="chat-panel" onClick={() => { setSidebarOpen(false); setChatOpen(!chatOpen); }}><MessageSquare size={18}/></button>
        <button className="button button-primary export-button" aria-label="PPTX 出力" onClick={download} disabled={exporting || saveState === "saving" || !project.deck.slides.length}>{exporting ? <Loader2 className="spin" size={17}/> : <Download size={17}/>} <span>{exporting ? "出力中" : "PPTX 出力"}</span></button>
      </div>
    </header>

    <div className="editor-body" style={{ "--chat-w": `${chatWidth}px` } as CSSProperties}>
      <aside id="slide-sidebar" className={`slide-sidebar ${sidebarOpen ? "mobile-open" : ""}`} inert={isNarrow && !sidebarOpen}>
        <div className="panel-heading"><span>スライド</span><button className="icon-button compact" title="スライドを追加" aria-label="スライドを追加" disabled={!!proposal || busy || saveState === "saving"} onClick={() => void commit([{ type: "addSlide", slide: { layout: "bullets", title: "新しいスライド", bullets: ["ここに内容を追加"] } }])}><Plus size={17}/></button></div>
        <div className="slide-list">
          {displayDeck?.slides.map((slide, index) => <button key={slide.id} draggable={!proposal && !busy && saveState !== "saving"} onDragStart={() => { dragSlide.current = slide.id; }} onDragOver={(event) => event.preventDefault()}
            onDrop={() => { const source = dragSlide.current; dragSlide.current = null; if (source && source !== slide.id && !proposal) void commit([{ type: "reorderSlide", slideId: source, toIndex: index }]); }}
            className={`slide-thumb ${selectedSlide?.id === slide.id ? "active" : ""}`} onClick={() => { setSelectedSlideId(slide.id); setSelectedElementId(null); setSidebarOpen(false); }}>
            <span className="thumb-number">{String(index + 1).padStart(2, "0")}</span>
            <div className="thumb-frame"><SlideCanvas slide={slide} compact readOnly/></div>
            <span className="thumb-title">{slideTitle(slide)}</span>
          </button>)}
          {!displayDeck?.slides.length && <div className="slide-list-empty">チャットから最初のスライドを作成しましょう。</div>}
        </div>
        <div className="sidebar-bottom"><button className="text-button" aria-expanded={showTheme} aria-controls="theme-menu" onClick={() => setShowTheme(!showTheme)}>テーマ <ChevronDown size={14}/></button>{showTheme && <div id="theme-menu" className="theme-menu">
          {[{ label: "クリーン", theme: { name: "クリーン", primary: "#3156D3", accent: "#65A9F0", background: "#FFFFFF", text: "#182230", fontFace: "Aptos" } }, { label: "フォレスト", theme: { name: "フォレスト", primary: "#176B5B", accent: "#7CBF9F", background: "#FFFFFF", text: "#16352C", fontFace: "Aptos" } }, { label: "チャコール", theme: { name: "チャコール", primary: "#29344B", accent: "#C28A52", background: "#F7F5F0", text: "#182230", fontFace: "Aptos" } }].map((preset) => <button key={preset.label} disabled={!!proposal || busy || saveState === "saving"} onClick={() => { void commit([{ type: "setTheme", ...preset.theme }]); setShowTheme(false); }}><i style={{ background: preset.theme.primary }}/><i style={{ background: preset.theme.accent }}/>{preset.label}</button>)}
          {!!templates.length && <div className="theme-menu-divider">登録テンプレート</div>}
          {templates.map((template) => <button key={template.id} disabled={!!proposal || busy || saveState === "saving"} title={`${template.theme.fontFace} · ${template.theme.primary}`} onClick={() => { void commit([{ type: "setTheme", primary: template.theme.primary, accent: template.theme.accent, background: template.theme.background, text: template.theme.text, fontFace: template.theme.fontFace }]); setShowTheme(false); }}><i style={{ background: template.theme.primary }}/><i style={{ background: template.theme.accent }}/>{template.name}</button>)}
        </div>}</div>
      </aside>

      <main className="canvas-area">
        <div className="canvas-toolbar">
          <div className="canvas-breadcrumb">
            <span>{selectedSlide ? `スライド ${selectedIndex + 1}` : "キャンバス"}</span>
            {selectedElement && (
              <>
                <span className="crumb-separator">/</span>
                <strong>{selectedElement.kind === "text" ? selectedElement.role : selectedElement.kind}</strong>
                <div className="element-actions-bar">
                   <button className="icon-button compact" title="最前面へ移動" onClick={() => reorderSelected("bringToFront")}><ArrowUpToLine size={14}/></button>
                   <button className="icon-button compact" title="1つ前面へ移動" onClick={() => reorderSelected("bringForward")}><ArrowUp size={14}/></button>
                   <button className="icon-button compact" title="1つ背面へ移動" onClick={() => reorderSelected("sendBackward")}><ArrowDown size={14}/></button>
                   <button className="icon-button compact" title="最背面へ移動" onClick={() => reorderSelected("sendToBack")}><ArrowDownToLine size={14}/></button>
                   {["text", "shape", "icon"].includes(selectedElement.kind) && <>
                     <button className="icon-button compact" title="左へ15度回転" onClick={() => rotateSelected(-15)}><RotateCcw size={14}/></button>
                     <button className="icon-button compact" title="右へ15度回転" onClick={() => rotateSelected(15)}><RotateCw size={14}/></button>
                   </>}
                    {selectedElement.kind === "image" && (
                      <div className="image-actions-bar">
                        <select aria-label="画像の配置" value={selectedElement.objectFit} onChange={(event) => updateImageProperties({ objectFit: event.target.value as "contain" | "cover" | "fill" })}>
                          <option value="contain">全体表示</option><option value="cover">枠を埋める</option><option value="fill">引き伸ばす</option>
                        </select>
                        <button className="toolbar-button" onClick={() => updateImageProperties({ borderRadius: selectedElement.borderRadius ? 0 : 0.2 })} title="画像の角丸を切り替え" aria-label="画像の角丸を切り替え">{selectedElement.borderRadius ? "角丸なし" : "角丸"}</button>
                        {[null, project.deck.theme.primary, project.deck.theme.accent, "#182230"].map((stroke) => <button key={stroke ?? "none"} type="button" className="image-stroke-button" onClick={() => updateImageProperties({ stroke })} aria-label={stroke ? `枠線 ${stroke}` : "枠線なし"} aria-pressed={selectedElement.stroke === stroke} title={stroke ? `枠線 ${stroke}` : "枠線なし"} style={{ borderColor: stroke ?? "transparent" }}>{stroke ? "" : "×"}</button>)}
                      </div>
                    )}
                   {["shape", "icon", "text"].includes(selectedElement.kind) && (
                     <div style={{ display: "flex", gap: "3px", alignItems: "center", marginLeft: "4px" }}>
                       {[project.deck.theme.primary, project.deck.theme.accent, "#182230", "#667085", "#D24646"].map((c) => (
                         <button
                           key={c}
                           type="button"
                           onClick={() => updateSelectedColor(c)}
                           aria-label={`色を変更 (${c})`}
                           aria-pressed={elementColor(selectedElement) === c}
                           style={{ width: "24px", height: "24px", borderRadius: "50%", background: c, border: "1px solid #CBD5E1", padding: 0 }}
                           title={`色を変更 (${c})`}
                         />
                       ))}
                     </div>
                   )}
                  <button className="icon-button compact danger" title="選択中の要素を削除 (Delete)" onClick={deleteSelected} style={{ marginLeft: "4px" }}>
                    <Trash2 size={13} color="var(--red)" />
                  </button>
                </div>
              </>
            )}
          </div>
          <div className="canvas-actions">
            <input ref={fileInput} type="file" accept="image/png,image/jpeg" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }}/>
            <div className="toolbar-dropdown">
              <button className="toolbar-button" disabled={!currentSlide || !!proposal || busy || saveState === "saving"} aria-expanded={showShapes} aria-haspopup="menu" onClick={() => setShowShapes(!showShapes)}>
                <Shapes size={16}/>図形 <ChevronDown size={12}/>
              </button>
              {showShapes && (
                <div className="popover-menu" style={{ width: "340px", maxHeight: "420px", overflowY: "auto" }}>
                  {SHAPE_GROUPS.map((group) => (
                    <div key={group.label}>
                      <div className="popover-group-label">{group.label}</div>
                      <div className="popover-grid popover-grid-shapes">
                        {group.items.map((item) => (
                          <button key={`${item.shape}-${item.arrowHead ?? ""}`} className="popover-grid-btn" onClick={() => { addShape(item.shape, item.arrowHead ? { arrowHead: item.arrowHead } : {}); setShowShapes(false); }} title={item.label}>
                            <ShapePreview shape={item.shape} arrowHead={item.arrowHead} />
                            <span>{item.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button className="toolbar-button" disabled={!currentSlide || !!proposal || busy || saveState === "saving"} aria-label="アイコンを追加" onClick={() => setShowIconPicker(true)}>
              <Smile size={16}/>アイコン
            </button>
            <button className="toolbar-button" disabled={!currentSlide || !!proposal || busy || saveState === "saving"} aria-label="画像を追加" onClick={() => fileInput.current?.click()}><ImagePlus size={16}/>画像</button>
            <button className="toolbar-button" disabled={!project.deck.slides.length || rendering || saveState === "saving"} aria-label="出力プレビュー" onClick={previewOutput}>{rendering ? <Loader2 className="spin" size={16}/> : <Eye size={16}/>}出力プレビュー</button>
            <button className="toolbar-button" disabled={!currentSlide || !!proposal || busy || saveState === "saving"} aria-label="この後にスライドを追加" onClick={() => void commit([{ type: "addSlide", slide: { layout: "bullets", title: "新しいスライド", bullets: ["ここに内容を追加"] }, index: (project.deck.slides.findIndex((s) => s.id === currentSlide?.id) + 1) }])}><FilePlus2 size={16}/>追加</button>
            <button className="toolbar-button danger" disabled={!currentSlide || !!proposal || busy || saveState === "saving"} aria-label="このスライドを削除" onClick={() => { if (currentSlide && window.confirm("このスライドを削除しますか？")) void commit([{ type: "deleteSlide", slideId: currentSlide.id }]); }}><Trash2 size={16}/>削除</button>
          </div>
        </div>
        {proposal && <div className="proposal-bar"><div><Sparkles size={17}/><strong>AI の変更案</strong><span>{proposal.summary}</span></div><div className="segmented" role="group" aria-label="表示の切り替え"><button className={!previewProposal ? "active" : ""} aria-pressed={!previewProposal} onClick={() => setPreviewProposal(false)}>現在</button><button className={previewProposal ? "active" : ""} aria-pressed={previewProposal} onClick={() => setPreviewProposal(true)}>変更後</button></div></div>}
        <div className="canvas-stage">
          {selectedSlide ? <div className="canvas-frame"><SlideCanvas slide={selectedSlide} selectedId={proposal ? null : selectedElementId} changedIds={proposal && previewProposal ? changedIds : undefined}
            readOnly={!!proposal || busy || saveState === "saving"} onSelect={(id) => setSelectedElementId(id)} onCommit={(op) => void commit([op])}/></div> :
            <div className="blank-stage"><span className="blank-illustration"><Layers3 size={40}/></span><h2>ここから始めましょう</h2><p>右のチャットに作りたい資料を伝えると、スライドの構成案が表示されます。</p><span className="blank-hint">例：新サービスの提案資料を5枚で作成して</span></div>}
          {!!selectedSlide && <div className="canvas-help">要素を選択して移動 · 角をドラッグしてサイズ変更 · ダブルクリックで文字編集</div>}
        </div>
        {proposal && <div className="proposal-footer">
          <div className="proposal-footer-info"><strong>変更案を確認</strong><p>{proposal.operations.length} 件の変更が含まれます。出力プレビュー画像で意図どおりかを確認してから適用してください。</p>
            <div className="proposal-preview">
              {proposalPreview && proposalPreview.id === proposal.id && proposalPreview.slides.length > 0 ? <>
                {proposalPreview.slides.map((src, index) => <button key={src} type="button" className="proposal-thumb" title={`${index + 1}枚目を拡大表示`} onClick={() => openProposalPreview(proposalPreview.slides, index)}><img src={src} alt={`変更案プレビュー ${index + 1}枚目`}/><span>{index + 1}</span></button>)}
                <button type="button" className="text-button proposal-preview-refresh" disabled={rendering} onClick={() => void renderProposalPreview()}>{rendering ? <Loader2 className="spin" size={13}/> : <Eye size={13}/>}再生成</button>
              </> : <button type="button" className="button button-ghost proposal-preview-generate" disabled={rendering || !proposal.proposedDeck.slides.length} onClick={() => void renderProposalPreview()}>{rendering ? <Loader2 className="spin" size={15}/> : <Eye size={15}/>}出力プレビューを作成</button>}
            </div>
          </div>
          <div><button className="button button-ghost" disabled={busy} onClick={() => void decide(false)}>破棄</button><button className="button button-primary" disabled={busy} onClick={() => void decide(true)}><Check size={17}/>適用する</button></div>
        </div>}
      </main>

      <aside id="chat-panel" className={`chat-panel ${chatOpen ? "mobile-open" : ""}`} aria-label="AI アシスタント" inert={isNarrow && !chatOpen}>
        <div className="chat-resizer" role="separator" aria-orientation="vertical" aria-label="チャット幅をドラッグで変更" title="ドラッグで幅を変更" onPointerDown={startChatResize}/>
        <div className="chat-header"><div><span className="chat-icon"><Sparkles size={17}/></span><div><strong>AI アシスタント</strong><small>{chatMode === "plan" ? "構成の相談" : "資料づくりをサポート"}</small></div></div><div className="chat-header-actions"><button className="icon-button compact" title="チャット履歴をクリア" aria-label="チャット履歴をクリア" disabled={busy || !messages.length} onClick={() => void clearChat()}><Trash2 size={16}/></button><button className="icon-button compact responsive-toggle" aria-label="チャットを閉じる" title="チャットを閉じる" onClick={() => setChatOpen(false)}><X size={17}/></button></div></div>
        <div className="chat-mode-row"><div className="segmented chat-mode-segmented" role="group" aria-label="AI のモード"><button className={chatMode === "plan" ? "active" : ""} aria-pressed={chatMode === "plan"} onClick={() => setChatMode("plan")}><ListChecks size={13}/>計画</button><button className={chatMode === "build" ? "active" : ""} aria-pressed={chatMode === "build"} onClick={() => setChatMode("build")}><Sparkles size={13}/>作成</button></div>{project.plan ? <div className="plan-chip"><LayoutTemplate size={13}/><span>計画採用済み</span><button type="button" title="構成計画を表示" aria-label="構成計画を表示" onClick={() => setShowPlan(true)}>表示</button><button type="button" title="構成計画を解除" aria-label="構成計画を解除" onClick={() => void clearPlan()}><X size={13}/></button></div> : null}</div>
        <div className="model-row"><select aria-label="AI モデル" value={modelId} onChange={(event) => setModelId(event.target.value)}>{models.length ? models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>) : <option value="">AI が未設定です</option>}</select><button title="接続を確認" className="icon-button compact" disabled={!modelId || busy} onClick={testConnection}><CircleCheck size={16}/></button><Link href="/settings/ai" title="AI 設定" className="icon-button compact"><Settings2 size={16}/></Link></div>
        <div className="chat-messages" role="log" aria-live="polite" aria-label="AI との会話">
          {!messages.length && <div className="chat-welcome"><span className="welcome-sparkle"><Sparkles size={24}/></span><h3>どんな資料を作りますか？</h3><p>目的や対象読者を伝えると、スライドの構成から一緒に考えます。</p><div className="prompt-suggestions">{["営業提案を5枚で作成", "企画の概要を分かりやすく整理", "社内報告のスライドを作成"].map((suggestion) => <button key={suggestion} onClick={() => setPrompt(suggestion)}>{suggestion}<span>↗</span></button>)}</div></div>}
          {messages.map((message) => <div key={message.id} className={`chat-message ${message.role === "user" ? "from-user" : "from-assistant"}${message.metadata.pending ? " is-pending" : ""}`}>
            {message.role === "assistant" && <span className="message-avatar">{message.metadata.mode === "plan" ? <ListChecks size={13}/> : <Sparkles size={13}/>}</span>}
            <div className="message-body"><div className="message-text">{message.content}</div>{message.role === "assistant" && !!message.metadata.plan && typeof message.metadata.plan === "string" && <pre className="plan-block">{message.metadata.plan}</pre>}{message.role === "assistant" && Array.isArray(message.metadata.questions) && (message.metadata.questions as string[]).length > 0 && <div className="question-list">{(message.metadata.questions as string[]).map((question, index) => <button key={index} type="button" className="question-chip" title="クリックすると回答の下書きを入力" onClick={() => setPrompt((old) => old.trim() ? old : `${question}\n`)}>{question}<span>↩</span></button>)}</div>}{message.role === "assistant" && message.metadata.mode === "plan" && typeof message.metadata.plan === "string" && <button className="plan-adopt" disabled={busy} onClick={() => void adoptPlan(String(message.metadata.plan))}><Check size={14}/>この構成を計画として採用</button>}{message.role === "assistant" && message.metadata.mode === "applied" && <div className="message-action"><CircleCheck size={14}/>変更を反映しました{typeof message.metadata.previousVersion === "number" && <button className="undo-inline" disabled={busy || !!proposal || project.version === Number(message.metadata.previousVersion)} onClick={() => void restore(Number(message.metadata.previousVersion), "history")}>元に戻す</button>}<button className="undo-inline" disabled={rendering || !project.deck.slides.length} onClick={() => void previewOutput()}>出力プレビューを表示</button></div>}{message.role === "assistant" && Array.isArray(message.metadata.summaries) && <ul className="op-summary">{(message.metadata.summaries as string[]).map((summary, index) => <li key={index}>{summary}</li>)}</ul>}{message.role === "assistant" && message.metadata.mode === "proposal" && <div className="message-action"><Sparkles size={14}/>変更案を作成しました</div>}{message.role === "assistant" && !!message.metadata.review && <div className="self-review">          {(() => { const r = message.metadata.review as { summary?: string; issues?: string[]; rounds?: number; fixed?: number; meetsIntent?: boolean }; return <>
            <div className="self-review-head"><Eye size={12}/><strong>AI 自己チェック{typeof r.rounds === "number" ? `(${r.rounds} 回の描画確認)` : ""}</strong><span className={r.meetsIntent === false ? "is-missing" : undefined}>{typeof r.fixed === "number" && r.fixed > 0 ? (r.meetsIntent === false ? `自動で ${r.fixed} 件修正・最終確認で意図不一致と判断` : `自動で ${r.fixed} 件修正し意図どおり確認`) : r.meetsIntent === false ? "意図不一致と判断(修正不能)" : "描画は意図どおりと判断"}</span></div>
            {!!r.summary && <p className="self-review-summary">{r.summary}</p>}
            {!!r.issues?.length && <ul className="self-review-issues">{r.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
          </>; })()}</div>}{message.role === "assistant" && message.metadata.mode === "chat" && <div className="message-action"><MessageSquare size={14}/>会話の回答</div>}</div>
          </div>)}
          {busy && <div className="chat-message from-assistant" role="status"><span className="message-avatar"><Sparkles size={13}/></span><div className="message-body ai-thinking"><Loader2 className="spin" size={16}/><span>{phaseLabel(chatStatus, chatMode)}</span>{chatElapsed >= 5 && <span className="chat-elapsed">{chatElapsed}s</span>}</div></div>}
          {busy && !!chatActivity.length && <div className="chat-activity">
            {chatActivity.map((item) => <div key={item.key} className={`chat-activity-item is-${item.kind}`}>
              {item.kind === "step" && <span className="chat-activity-step">STEP {item.step}</span>}
              {item.kind === "tool" && <>
                {item.status === "start" ? <Loader2 className="spin" size={12}/> : item.status === "result" ? <CircleCheck size={12}/> : <CircleAlert size={12}/>}
                <span className={`chat-activity-tool${item.tool.startsWith("commit_") ? " is-commit" : ""}`}>{toolPhaseLabel(item.tool)}{(item.args || item.summary) && <code className="chat-activity-detail">{String(item.args ?? item.summary ?? "").replace(/\s+/g, " ").slice(0, 140)}</code>}</span>
              </>}
              {item.kind === "reasoning" && <span className="chat-activity-reasoning">AI の思考: …{item.text.slice(-180)}</span>}
              {item.kind === "text" && <span className="chat-activity-text">…{item.text.slice(-120)}</span>}
            </div>)}
            <div ref={chatActivityEnd}/>
          </div>}
          <div ref={chatEnd}/>
        </div>
        <form className="chat-composer" onSubmit={sendChat}>
          {currentSlide && <div className="target-chip"><span>対象</span><strong>{targetLabel}</strong>{selectedElementId && <button type="button" title="要素選択を解除" aria-label="要素選択を解除" onClick={() => setSelectedElementId(null)}><X size={13}/></button>}</div>}
          <div className="composer-box"><textarea aria-label="AI への指示" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={chatMode === "plan" ? "目的・読者・伝えたいことを伝えると、構成案を一緒に考えます…" : (project.deck.slides.length ? "このスライドをどう編集しますか？" : "作りたい資料を入力してください…")} rows={3}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendChat(); } }}/><div className="composer-footer"><span>Enter で送信 · Shift+Enter で改行</span><span className="composer-buttons">{busy ? <button className="cancel-button" type="button" aria-label="AI へのリクエストをキャンセル" onClick={cancelChat}>キャンセル</button> : null}<button className="send-button" type="submit" title="送信" aria-label="送信" disabled={!modelId || !prompt.trim() || busy || !!proposal || saveState === "saving"}><Send size={17}/></button></span></div></div>
          {!models.length && <div className="model-notice">AI が未登録です。AI 設定からモデルを追加してください。</div>}
          {proposal && <div className="model-notice">変更案を適用または破棄してから、次の指示を送れます。</div>}
        </form>
      </aside>
    </div>
    {(sidebarOpen || chatOpen) && <div className="drawer-backdrop responsive-toggle" aria-hidden="true" onClick={() => { setSidebarOpen(false); setChatOpen(false); }}/>}
    {(error || notice) && <div className={`toast ${error ? "toast-error" : ""}`} role={error ? "alert" : "status"}>{error ? <CircleAlert size={16}/> : <CircleCheck size={16}/>}<span>{error || notice}</span>{error && saveState === "error" && retryOps && <button className="toast-retry" onClick={() => { const ops = retryOps; setRetryOps(null); setError(""); void commit(ops); }}>再試行</button>}<button aria-label="閉じる" title="閉じる" onClick={() => { setError(""); setNotice(""); setRetryOps(null); }}><X size={15}/></button></div>}
    {showHistory && <Modal isOpen={showHistory} onClose={() => setShowHistory(false)} labelledBy="history-title" className="history-modal">
      <header><div><History size={20}/><h2 id="history-title">版の履歴</h2></div><button className="icon-button" aria-label="閉じる" onClick={() => setShowHistory(false)}><X size={18}/></button></header>
      <p>以前の内容を新しい版として復元できます。</p>
      <div className="history-list">{history.map((item) => <div key={item.version} className="history-item"><span className="history-version">v{item.version}</span><div><strong>{item.summary}</strong><small>{relativeTime(item.createdAt)} · {item.source === "ai" ? "AI" : item.source === "manual" ? "手動" : item.source === "restore" ? "復元" : "作成"}</small></div><button className="button button-ghost" disabled={item.version === project.version || busy || !!proposal} onClick={() => void restore(item.version, "history")}>復元</button></div>)}</div>
    </Modal>}
    {showOutputPreview && <Modal isOpen={showOutputPreview} onClose={() => setShowOutputPreview(false)} labelledBy="output-title" className="output-modal">
      <header><div><Eye size={20}/><h2 id="output-title">PowerPoint 出力プレビュー</h2></div><button className="icon-button" aria-label="閉じる" onClick={() => setShowOutputPreview(false)}><X size={18}/></button></header>
      <div className="output-image-wrap">{renderedSlides[renderPage] && <img src={renderedSlides[renderPage]} alt={`出力スライド ${renderPage + 1}`}/>}</div>
      <footer><span>{renderPage + 1} / {renderedSlides.length}</span><div><button className="button button-ghost" disabled={renderPage === 0} onClick={() => setRenderPage((n) => n - 1)}>前へ</button><button className="button button-ghost" disabled={renderPage >= renderedSlides.length - 1} onClick={() => setRenderPage((n) => n + 1)}>次へ</button></div></footer>
    </Modal>}
    <IconPickerModal isOpen={showIconPicker} onClose={() => setShowIconPicker(false)} onSelect={addIcon} />
    {showPlan && project.plan && <Modal isOpen={showPlan} onClose={() => setShowPlan(false)} labelledBy="plan-title" className="plan-modal">
      <header><div><LayoutTemplate size={20}/><h2 id="plan-title">採用済みの構成計画</h2></div><button className="icon-button" aria-label="閉じる" onClick={() => setShowPlan(false)}><X size={18}/></button></header>
      <pre className="plan-block plan-modal-body">{project.plan}</pre>
      <footer><button className="button button-ghost" disabled={busy} onClick={() => { setShowPlan(false); void clearPlan(); }}>計画を解除</button><button className="button button-primary" onClick={() => { setShowPlan(false); setChatMode("build"); setChatOpen(true); }}>この構成で作成へ</button></footer>
    </Modal>}
  </div>;
}
