"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Clock3, FilePlus2, Layers3, Plus, Settings2 } from "lucide-react";
import type { ProjectRecord } from "@/lib/projects";
import { SlideCanvas } from "@/components/SlideCanvas";

export default function HomePage() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/projects", { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "資料を読み込めませんでした。");
      setProjects(data.projects);
    }).catch((reason) => setError(reason.message)).finally(() => setLoading(false));
  }, []);

  async function create() {
    setCreating(true); setError("");
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "作成できませんでした。");
      window.location.href = `/projects/${data.project.id}`;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "作成できませんでした。"); setCreating(false); }
  }

  return <main className="home-shell">
    <header className="home-header">
      <div className="brand"><span className="brand-mark"><Layers3 size={20} strokeWidth={2.4}/></span><span>Slide Harness</span></div>
      <div className="home-header-actions"><span className="header-caption">社内ワークスペース</span><Link href="/settings/ai" className="home-settings-link"><Settings2 size={17}/>AI 設定</Link></div>
    </header>
    <div className="workspace-shell">
      <div className="workspace-top">
        <div><span className="workspace-kicker">ワークスペース</span><h1>プレゼンテーション</h1><p>資料を作成し、チャットで編集できます。</p></div>
        <button className="button button-primary" onClick={create} disabled={creating}><Plus size={18}/>{creating ? "作成中…" : "新しい資料"}</button>
      </div>
      {error && <div className="inline-error" role="alert">{error}</div>}
      <section className="project-section">
        <div className="section-heading"><h2>最近の資料</h2><span>{projects.length} 件</span></div>
        <div className="project-grid">
          <button className="create-card" onClick={create} disabled={creating}>
            <div className="create-cover"><div className="slide-stack slide-stack-back"/><div className="slide-stack slide-stack-front"><span/><i/><i/><i/><div><b/><b/><b/></div></div><span className="create-plus"><Plus size={20}/></span></div>
            <div className="project-meta"><strong>新しいプレゼンテーション</strong><span><FilePlus2 size={14}/>チャットから作成<ArrowUpRight size={14}/></span></div>
          </button>
          {loading && <div className="project-loading">資料を読み込んでいます…</div>}
          {!loading && projects.map((project) => <Link href={`/projects/${project.id}`} className="project-card" key={project.id}>
            <div className="project-cover">{project.deck.slides[0] ? <SlideCanvas slide={project.deck.slides[0]} compact readOnly/> : <div className="empty-slide-preview"><span/><i/><i/></div>}</div>
            <div className="project-meta"><strong>{project.title}</strong><span><Clock3 size={14}/>{new Date(project.updatedAt).toLocaleDateString("ja-JP")}<span className="meta-separator">·</span>{project.deck.slides.length} 枚</span></div>
          </Link>)}
        </div>
      </section>
    </div>
  </main>;
}
