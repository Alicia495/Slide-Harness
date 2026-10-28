"use client";

import { useEffect, useRef, useState } from "react";
import { FilePlus2, FileUp, LayoutTemplate, Trash2, X } from "lucide-react";
import { DEFAULT_THEME, type Theme } from "@/lib/document";
import { Modal } from "./Modal";

type TemplateSummary = { id: string; name: string; originalName: string; theme: Theme; createdAt: string };

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (templateId: string | null) => void;
};

function Swatches({ theme }: { theme: Theme }) {
  return <span className="template-swatches">
    <i style={{ background: theme.background, borderColor: "#d5dbe4" }}/>
    <i style={{ background: theme.text }}/>
    <i style={{ background: theme.primary }}/>
    <i style={{ background: theme.accent }}/>
  </span>;
}

export function TemplateModal({ isOpen, onClose, onSelect }: Props) {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    setLoading(true);
    fetch("/api/templates", { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "テンプレートを読み込めませんでした。");
      setTemplates(data.templates);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "テンプレートを読み込めませんでした。")).finally(() => setLoading(false));
  }, [isOpen]);

  async function upload(file: File) {
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/templates", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "テンプレート登録に失敗しました。");
      setTemplates((current) => [data.template, ...current]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "テンプレート登録に失敗しました。"); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`「${name}」を削除しますか？`)) return;
    setError("");
    try {
      const response = await fetch(`/api/templates/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json()).error || "テンプレートを削除できませんでした。");
      setTemplates((current) => current.filter((template) => template.id !== id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "テンプレートを削除できませんでした。"); }
  }

  if (!isOpen) return null;

  return <Modal isOpen={isOpen} onClose={onClose} labelledBy="template-modal-title" className="template-modal">
      <header>
        <div><LayoutTemplate size={19}/><h2 id="template-modal-title">テンプレートを選択</h2></div>
        <button className="icon-button" onClick={onClose} title="閉じる" aria-label="テンプレート選択を閉じる"><X size={18}/></button>
      </header>
      <p>PowerPoint テンプレート（.potx）から色とフォントを引き継いで作成できます。</p>
      {error && <div className="inline-error" role="alert">{error}</div>}
      <div className="template-grid">
        <button className="template-card" onClick={() => onSelect(null)} disabled={busy}>
          <div className="template-card-top"><Swatches theme={DEFAULT_THEME}/><span className="template-badge">まっさら</span></div>
          <strong>白紙</strong><small>標準テーマで開始</small>
        </button>
        {loading && <div className="template-loading">テンプレートを読み込んでいます…</div>}
        {templates.map((template) => <div className="template-card selectable" key={template.id} role="button" tabIndex={0}
          onClick={() => onSelect(template.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(template.id); }}>
          <div className="template-card-top"><Swatches theme={template.theme}/><span className="template-badge">{new Date(template.createdAt).toLocaleDateString("ja-JP")}</span></div>
          <strong>{template.name}</strong>
          <small>{template.theme.fontFace}</small>
          <button className="template-delete" title="削除" aria-label={`${template.name} を削除`} onClick={(event) => { event.stopPropagation(); void remove(template.id, template.name); }}><Trash2 size={14}/></button>
        </div>)}
      </div>
      <footer>
        <input ref={fileInput} type="file" accept=".potx" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }}/>
        <button className="button" onClick={() => fileInput.current?.click()} disabled={busy}><FileUp size={16}/>{busy ? "登録中…" : ".potx を登録"}</button>
        <span className="template-footer-hint"><FilePlus2 size={14}/>企業テンプレートの .potx をアップロードすると、ここに並びます</span>
      </footer>
    </Modal>;
}
