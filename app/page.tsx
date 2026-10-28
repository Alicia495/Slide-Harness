"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Clock3, FilePlus2, Layers3, LayoutTemplate, MessageSquare, Plus, Settings2, Trash2 } from "lucide-react";
import type { ProjectRecord } from "@/lib/projects";
import { SlideCanvas } from "@/components/SlideCanvas";
import { TemplateModal } from "@/components/TemplateModal";

export default function HomePage() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  useEffect(() => {
    fetch("/api/projects", { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "資料を読み込めませんでした。");
      setProjects(data.projects);
    }).catch((reason) => setError(reason.message)).finally(() => setLoading(false));
  }, []);

  async function create(templateId?: string) {
    setCreating(true); setError("");
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(templateId ? { templateId } : {}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "作成できませんでした。");
      window.location.href = `/projects/${data.project.id}`;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "作成できませんでした。"); setCreating(false); }
  }

  async function remove(project: ProjectRecord) {
    if (!window.confirm(`「${project.title}」を削除しますか？ この操作は取り消せません。`)) return;
    setDeletingId(project.id); setError("");
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "資料を削除できませんでした。");
      setProjects((current) => current.filter((item) => item.id !== project.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "資料を削除できませんでした。"); }
    finally { setDeletingId(""); }
  }

  return <main className="home-shell">
    <header className="home-header">
      <div className="brand"><span className="brand-mark"><Layers3 size={20} strokeWidth={2.4}/></span><span>Slide Harness</span></div>
      <div className="home-header-actions"><span className="header-caption">社内ワークスペース</span><a href="/settings/ai" className="home-settings-link"><Settings2 size={17}/>AI 設定</a></div>
    </header>
    <div className="workspace-shell">
      <div className="workspace-top">
        <div><span className="workspace-kicker">ワークスペース</span><h1>プレゼンテーション</h1><p>資料を作成し、チャットで編集できます。</p></div>
        <button className="button button-primary" onClick={() => setTemplatePickerOpen(true)} disabled={creating}><Plus size={18}/>{creating ? "作成中…" : "新しい資料"}</button>
      </div>
      {error && <div className="inline-error" role="alert">{error}</div>}
      <section className="project-section">
        <div className="section-heading"><h2>最近の資料</h2><span>{projects.length} 件</span></div>
        <div className="project-grid">
          <button className="create-card" onClick={() => setTemplatePickerOpen(true)} disabled={creating}>
            <div className="create-cover"><div className="slide-stack slide-stack-back"/><div className="slide-stack slide-stack-front"><span/><i/><i/><i/><div><b/><b/><b/></div></div><span className="create-plus"><MessageSquare size={20}/></span></div>
            <div className="project-meta"><strong>新しいプレゼンテーション</strong><span><FilePlus2 size={14}/>テーマを選んでチャットから作成<ArrowUpRight size={14}/></span></div>
          </button>
          {loading && <div className="project-loading">資料を読み込んでいます…</div>}
          {!loading && projects.map((project) => <div className="project-card" key={project.id}>
            <Link href={`/projects/${project.id}`} className="project-card-link">
              <div className="project-cover">{project.deck.slides[0] ? <SlideCanvas slide={project.deck.slides[0]} compact readOnly/> : <div className="empty-slide-preview"><span/><i/><i/></div>}</div>
              <div className="project-meta"><strong>{project.title}</strong><span><Clock3 size={14}/>{new Date(project.updatedAt).toLocaleDateString("ja-JP")}<span className="meta-separator">·</span>{project.deck.slides.length} 枚{project.plan ? <><span className="meta-separator">·</span><LayoutTemplate size={13}/>計画済み</> : null}</span></div>
            </Link>
            <button className="project-delete" title="この資料を削除" aria-label={`${project.title} を削除`} disabled={deletingId === project.id} onClick={() => void remove(project)}><Trash2 size={14}/></button>
          </div>)}
        </div>
      </section>
    </div>
    <TemplateModal isOpen={templatePickerOpen} onClose={() => setTemplatePickerOpen(false)} onSelect={(templateId) => void create(templateId ?? undefined)}/>
  </main>;
}
