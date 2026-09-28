"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Check, ChevronDown, CircleAlert, CircleCheck, Download, Eye, FilePlus2, History, ImagePlus, Layers3, Loader2, MessageSquare, Plus, RotateCcw, RotateCw, Send, Settings2, Sparkles, Trash2, X } from "lucide-react";
import { slideTitle, type Deck, type Element, type Operation, type Slide } from "@/lib/document";
import type { ModelProfile } from "@/lib/ai";
import type { ChatMessage, ProjectRecord, Proposal } from "@/lib/projects";
import { SlideCanvas } from "./SlideCanvas";

type HistoryItem = { version: number; source: string; summary: string; createdAt: string };
type ProjectPayload = { project: ProjectRecord; history: HistoryItem[]; messages: ChatMessage[]; proposal: Proposal | null };
type SaveState = "saved" | "saving" | "error";

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "通信に失敗しました。");
  return data as T;
}
const post = <T,>(url: string, body: unknown) => jsonRequest<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function relativeTime(value: string) {
  return new Date(value).toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
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
  const [exporting, setExporting] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [renderedSlides, setRenderedSlides] = useState<string[]>([]);
  const [renderPage, setRenderPage] = useState(0);
  const [showOutputPreview, setShowOutputPreview] = useState(false);
  const [undoTargets, setUndoTargets] = useState<number[]>([]);
  const [redoTargets, setRedoTargets] = useState<number[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragSlide = useRef<string | null>(null);
  const commitInFlight = useRef(false);

  const load = useCallback(async (initial = false) => {
    const data = await jsonRequest<ProjectPayload>(`/api/projects/${projectId}`);
    setProject(data.project); setHistory(data.history); setMessages(data.messages); setProposal(data.proposal);
    setSelectedSlideId((old) => old && data.project.deck.slides.some((s) => s.id === old) ? old : data.project.deck.slides[0]?.id ?? null);
    setSelectedElementId((old) => old && data.project.deck.slides.some((s) => s.elements.some((e) => e.id === old)) ? old : null);
    if (initial) setLoading(false);
    return data;
  }, [projectId]);

  useEffect(() => {
    Promise.all([
      load(true),
      jsonRequest<{ models: ModelProfile[] }>("/api/models").then((data) => { setModels(data.models); setModelId((old) => old || data.models[0]?.id || ""); }),
    ]).catch((reason) => { setError(reason.message); setLoading(false); });
  }, [load]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

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
      setSaveState("saved"); setNotice("変更を保存しました");
      const refreshed = await load();
      return refreshed.project;
    } catch (reason) { setSaveState("error"); setError(reason instanceof Error ? reason.message : "保存に失敗しました。"); }
    finally { commitInFlight.current = false; }
  }

  async function sendChat(event?: FormEvent) {
    event?.preventDefault();
    if (!project || !prompt.trim() || !modelId || busy || proposal || commitInFlight.current) return;
    const message = prompt.trim();
    const previousVersion = project.version;
    setBusy(true); setError(""); setNotice(""); setPrompt("");
    try {
      const result = await post<{ mode: "applied" | "proposal"; project?: ProjectRecord; proposal?: Proposal; compacted?: boolean }>(`/api/projects/${projectId}/chat`, {
        baseVersion: previousVersion, prompt: message, modelId,
        target: currentSlide ? { slideId: currentSlide.id, elementId: selectedElement?.id } : undefined,
      });
      if (result.mode === "applied") {
        setUndoTargets((items) => [...items, previousVersion]); setRedoTargets([]);
        setNotice(result.compacted ? "会話の記憶を整理し、AI の修正を反映しました。" : "AI の修正を反映しました。元に戻すこともできます。");
      } else { setPreviewProposal(true); setNotice(result.compacted ? "会話の記憶を整理しました。変更案を確認してください。" : "変更案を確認してください。"); }
      await load();
    } catch (reason) {
      setPrompt(message);
      setError(reason instanceof Error ? reason.message : "AI 処理に失敗しました。");
      await load().catch(() => undefined);
    } finally { setBusy(false); }
  }

  async function decide(accept: boolean) {
    if (!proposal || busy || !project) return;
    setBusy(true); setError("");
    try {
      await post(`/api/projects/${projectId}/proposals/${proposal.id}`, { accept });
      if (accept) { setUndoTargets((items) => [...items, project.version]); setRedoTargets([]); setNotice("変更案を適用しました。"); }
      else setNotice("変更案を破棄しました。");
      setPreviewProposal(false);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "変更案を処理できませんでした。"); }
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
    } catch (reason) { setError(reason instanceof Error ? reason.message : "復元できませんでした。"); }
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

  async function testConnection() {
    if (!modelId) return;
    setNotice("AI への接続を確認しています…");
    try {
      await post(`/api/models/test`, { modelId });
      setNotice("AI に接続できました。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "AI に接続できませんでした。"); }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable=true]")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) { const target = redoTargets.at(-1); if (target !== undefined) void restore(target, "redo"); } else { const target = undoTargets.at(-1); if (target !== undefined) void restore(target, "undo"); } }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); const target = redoTargets.at(-1); if (target !== undefined) void restore(target, "redo"); }
      if (event.key === "Escape") setSelectedElementId(null);
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
        <button className="icon-button responsive-toggle" title="スライド一覧" onClick={() => setSidebarOpen(!sidebarOpen)}><Layers3 size={18}/></button>
        <button className="icon-button responsive-toggle" title="AI チャット" onClick={() => setChatOpen(!chatOpen)}><MessageSquare size={18}/></button>
        <button className="button button-primary export-button" onClick={download} disabled={exporting || saveState === "saving" || !project.deck.slides.length}>{exporting ? <Loader2 className="spin" size={17}/> : <Download size={17}/>} <span>{exporting ? "出力中" : "PPTX 出力"}</span></button>
      </div>
    </header>

    <div className="editor-body">
      <aside className={`slide-sidebar ${sidebarOpen ? "mobile-open" : ""}`}>
        <div className="panel-heading"><span>スライド</span><button className="icon-button compact" title="スライドを追加" disabled={!!proposal || busy || saveState === "saving"} onClick={() => void commit([{ type: "addSlide", slide: { layout: "bullets", title: "新しいスライド", bullets: ["ここに内容を追加"] } }])}><Plus size={17}/></button></div>
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
        <div className="sidebar-bottom"><button className="text-button" onClick={() => setShowTheme(!showTheme)}>テーマ <ChevronDown size={14}/></button>{showTheme && <div className="theme-menu">
          {[{ label: "クリーン", primary: "#3156D3", accent: "#65A9F0" }, { label: "フォレスト", primary: "#176B5B", accent: "#7CBF9F" }, { label: "チャコール", primary: "#29344B", accent: "#C28A52" }].map((theme) => <button key={theme.label} disabled={!!proposal || busy || saveState === "saving"} onClick={() => { void commit([{ type: "setTheme", primary: theme.primary, accent: theme.accent }]); setShowTheme(false); }}><i style={{ background: theme.primary }}/>{theme.label}</button>)}
        </div>}</div>
      </aside>

      <main className="canvas-area">
        <div className="canvas-toolbar">
          <div className="canvas-breadcrumb"><span>{selectedSlide ? `スライド ${selectedIndex + 1}` : "キャンバス"}</span>{selectedElement && <><span className="crumb-separator">/</span><strong>{selectedElement.kind === "text" ? selectedElement.role : selectedElement.kind}</strong></>}</div>
          <div className="canvas-actions">
            <input ref={fileInput} type="file" accept="image/png,image/jpeg" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }}/>
            <button className="toolbar-button" disabled={!project.deck.slides.length || rendering || saveState === "saving"} onClick={previewOutput}>{rendering ? <Loader2 className="spin" size={16}/> : <Eye size={16}/>}出力プレビュー</button>
            <button className="toolbar-button" disabled={!currentSlide || !!proposal || busy || saveState === "saving"} onClick={() => fileInput.current?.click()}><ImagePlus size={16}/>画像</button>
            <button className="toolbar-button" disabled={!currentSlide || !!proposal || busy || saveState === "saving"} onClick={() => void commit([{ type: "addSlide", slide: { layout: "bullets", title: "新しいスライド", bullets: ["ここに内容を追加"] }, index: (project.deck.slides.findIndex((s) => s.id === currentSlide?.id) + 1) }])}><FilePlus2 size={16}/>追加</button>
            <button className="toolbar-button danger" disabled={!currentSlide || !!proposal || busy || saveState === "saving"} onClick={() => { if (currentSlide && window.confirm("このスライドを削除しますか？")) void commit([{ type: "deleteSlide", slideId: currentSlide.id }]); }}><Trash2 size={16}/>削除</button>
          </div>
        </div>
        {proposal && <div className="proposal-bar"><div><Sparkles size={17}/><strong>AI の変更案</strong><span>{proposal.summary}</span></div><div className="segmented"><button className={!previewProposal ? "active" : ""} onClick={() => setPreviewProposal(false)}>現在</button><button className={previewProposal ? "active" : ""} onClick={() => setPreviewProposal(true)}>変更後</button></div></div>}
        <div className="canvas-stage">
          {selectedSlide ? <div className="canvas-frame"><SlideCanvas slide={selectedSlide} selectedId={proposal ? null : selectedElementId} changedIds={proposal && previewProposal ? changedIds : undefined}
            readOnly={!!proposal || busy || saveState === "saving"} onSelect={(id) => setSelectedElementId(id)} onCommit={(op) => void commit([op])}/></div> :
            <div className="blank-stage"><span className="blank-illustration"><Layers3 size={40}/></span><h2>ここから始めましょう</h2><p>右のチャットに作りたい資料を伝えると、スライドの構成案が表示されます。</p><span className="blank-hint">例：新サービスの提案資料を5枚で作成して</span></div>}
          {!!selectedSlide && <div className="canvas-help">要素を選択して移動 · 角をドラッグしてサイズ変更 · ダブルクリックで文字編集</div>}
        </div>
        {proposal && <div className="proposal-footer"><div><strong>変更案を確認</strong><p>{proposal.operations.length} 件の変更が含まれます。適用するまで資料は変わりません。</p></div><div><button className="button button-ghost" disabled={busy} onClick={() => void decide(false)}>破棄</button><button className="button button-primary" disabled={busy} onClick={() => void decide(true)}><Check size={17}/>適用する</button></div></div>}
      </main>

      <aside className={`chat-panel ${chatOpen ? "mobile-open" : ""}`}>
        <div className="chat-header"><div><span className="chat-icon"><Sparkles size={17}/></span><div><strong>AI アシスタント</strong><small>資料づくりをサポート</small></div></div><button className="icon-button compact responsive-toggle" onClick={() => setChatOpen(false)}><X size={17}/></button></div>
        <div className="model-row"><select aria-label="AI モデル" value={modelId} onChange={(event) => setModelId(event.target.value)}>{models.length ? models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>) : <option value="">AI が未設定です</option>}</select><button title="接続を確認" className="icon-button compact" disabled={!modelId || busy} onClick={testConnection}><CircleCheck size={16}/></button><Link href="/settings/ai" title="AI 設定" className="icon-button compact"><Settings2 size={16}/></Link></div>
        <div className="chat-messages">
          {!messages.length && <div className="chat-welcome"><span className="welcome-sparkle"><Sparkles size={24}/></span><h3>どんな資料を作りますか？</h3><p>目的や対象読者を伝えると、スライドの構成から一緒に考えます。</p><div className="prompt-suggestions">{["営業提案を5枚で作成", "企画の概要を分かりやすく整理", "社内報告のスライドを作成"].map((suggestion) => <button key={suggestion} onClick={() => setPrompt(suggestion)}>{suggestion}<span>↗</span></button>)}</div></div>}
          {messages.map((message) => <div key={message.id} className={`chat-message ${message.role === "user" ? "from-user" : "from-assistant"}`}>
            {message.role === "assistant" && <span className="message-avatar"><Sparkles size={13}/></span>}
            <div className="message-body"><div className="message-text">{message.content}</div>{message.role === "assistant" && message.metadata.mode === "applied" && <div className="message-action"><CircleCheck size={14}/>変更を反映しました</div>}{message.role === "assistant" && message.metadata.mode === "proposal" && <div className="message-action"><Sparkles size={14}/>変更案を作成しました</div>}</div>
          </div>)}
          {busy && <div className="chat-message from-assistant"><span className="message-avatar"><Sparkles size={13}/></span><div className="message-body ai-thinking"><Loader2 className="spin" size={16}/>考えています…</div></div>}
          <div ref={chatEnd}/>
        </div>
        <form className="chat-composer" onSubmit={sendChat}>
          {currentSlide && <div className="target-chip"><span>対象</span><strong>{targetLabel}</strong>{selectedElementId && <button type="button" title="要素選択を解除" onClick={() => setSelectedElementId(null)}><X size={13}/></button>}</div>}
          <div className="composer-box"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={project.deck.slides.length ? "このスライドをどう編集しますか？" : "作りたい資料を入力してください…"} rows={3}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendChat(); } }}/><div className="composer-footer"><span>Enter で送信 · Shift+Enter で改行</span><button className="send-button" type="submit" title="送信" disabled={!modelId || !prompt.trim() || busy || !!proposal || saveState === "saving"}><Send size={17}/></button></div></div>
          {!models.length && <div className="model-notice">AI が未登録です。AI 設定からモデルを追加してください。</div>}
          {proposal && <div className="model-notice">変更案を適用または破棄してから、次の指示を送れます。</div>}
        </form>
      </aside>
    </div>
    {(error || notice) && <div className={`toast ${error ? "toast-error" : ""}`} role={error ? "alert" : "status"}>{error ? <CircleAlert size={16}/> : <CircleCheck size={16}/>}<span>{error || notice}</span><button onClick={() => { setError(""); setNotice(""); }} title="閉じる"><X size={15}/></button></div>}
    {showHistory && <div className="modal-backdrop" onMouseDown={() => setShowHistory(false)}><section className="history-modal" onMouseDown={(event) => event.stopPropagation()}><header><div><History size={20}/><h2>版の履歴</h2></div><button className="icon-button" onClick={() => setShowHistory(false)}><X size={18}/></button></header><p>以前の内容を新しい版として復元できます。</p><div className="history-list">{history.map((item) => <div key={item.version} className="history-item"><span className="history-version">v{item.version}</span><div><strong>{item.summary}</strong><small>{relativeTime(item.createdAt)} · {item.source === "ai" ? "AI" : item.source === "manual" ? "手動" : item.source === "restore" ? "復元" : "作成"}</small></div><button className="button button-ghost" disabled={item.version === project.version || busy || !!proposal} onClick={() => void restore(item.version, "history")}>復元</button></div>)}</div></section></div>}
    {showOutputPreview && <div className="modal-backdrop" onMouseDown={() => setShowOutputPreview(false)}><section className="output-modal" onMouseDown={(event) => event.stopPropagation()}><header><div><Eye size={20}/><h2>PowerPoint 出力プレビュー</h2></div><button className="icon-button" onClick={() => setShowOutputPreview(false)}><X size={18}/></button></header><div className="output-image-wrap">{renderedSlides[renderPage] && <img src={renderedSlides[renderPage]} alt={`出力スライド ${renderPage + 1}`}/>}</div><footer><span>{renderPage + 1} / {renderedSlides.length}</span><div><button className="button button-ghost" disabled={renderPage === 0} onClick={() => setRenderPage((n) => n - 1)}>前へ</button><button className="button button-ghost" disabled={renderPage >= renderedSlides.length - 1} onClick={() => setRenderPage((n) => n + 1)}>次へ</button></div></footer></section></div>}
  </div>;
}
