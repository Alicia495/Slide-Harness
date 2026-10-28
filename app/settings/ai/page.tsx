"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Check, CircleAlert, CircleCheck, Database, Loader2, Plus, RefreshCw, Save, Settings2, Trash2 } from "lucide-react";
import type { ModelProfile } from "@/lib/model-settings";
import "./settings.css";

type FormState = {
  id?: string; sourceId?: string; label: string; provider: "vllm" | "azure"; modelName: string; baseUrl: string; resourceName: string; apiVersion: string;
  legacyUrls: boolean; apiKey: string; clearApiKey: boolean; contextWindow: number | undefined; useManualContext: boolean;
  temperature: number; topP: number; maxOutputTokens: number;
};
type Discovered = { id: string; contextWindow: number | null };
const emptyForm = (): FormState => ({ label: "", provider: "vllm", modelName: "", baseUrl: "http://127.0.0.1:8888/v1", resourceName: "", apiVersion: "",
  legacyUrls: false, apiKey: "", clearApiKey: false, contextWindow: undefined, useManualContext: false, temperature: 1, topP: 0.95, maxOutputTokens: 4096 });
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "処理に失敗しました。");
  return data as T;
}
function fromProfile(profile: ModelProfile): FormState {
  return { id: profile.managedBy === "settings" ? profile.id : undefined, sourceId: profile.id, label: profile.label, provider: profile.provider === "azure" ? "azure" : "vllm",
    modelName: profile.modelName, baseUrl: profile.baseUrl, resourceName: profile.resourceName, apiVersion: profile.apiVersion,
    legacyUrls: profile.legacyUrls, apiKey: "", clearApiKey: false, contextWindow: profile.contextWindow ?? undefined,
    useManualContext: profile.contextSource === "manual", temperature: profile.temperature, topP: profile.topP, maxOutputTokens: profile.maxOutputTokens };
}

export default function AISettingsPage() {
  const [models, setModels] = useState<ModelProfile[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [discovered, setDiscovered] = useState<Discovered[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function load() {
    const data = await api<{ models: ModelProfile[] }>("/api/models");
    setModels(data.models);
  }
  useEffect(() => { load().catch((reason) => setError(reason.message)).finally(() => setLoading(false)); }, []);
  function update<K extends keyof FormState>(key: K, value: FormState[K]) { setForm((current) => ({ ...current, [key]: value })); }
  async function discover() {
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await api<{ models: Discovered[] }>("/api/models/discover", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: form.id, provider: form.provider, baseUrl: form.baseUrl, resourceName: form.resourceName, apiVersion: form.apiVersion, modelName: form.modelName, apiKey: form.apiKey }) });
      setDiscovered(data.models);
      const match = data.models.find((item) => item.id === form.modelName) ?? (data.models.length === 1 ? data.models[0] : undefined);
      if (match) setForm((old) => ({ ...old, modelName: match.id, contextWindow: match.contextWindow ?? old.contextWindow,
        maxOutputTokens: match.contextWindow ? Math.min(old.maxOutputTokens, Math.max(64, Math.floor(match.contextWindow * 0.2))) : old.maxOutputTokens }));
      setNotice(data.models.length ? `${data.models.length} 件のモデルを取得しました。` : "モデルが見つかりませんでした。ID とコンテキスト長を手動で入力できます。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "モデル一覧を取得できませんでした。"); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const data = await api<{ model: ModelProfile }>(form.id ? `/api/models/${form.id}` : "/api/models", {
        method: form.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      await load(); setForm(fromProfile(data.model)); setDiscovered([]); setNotice("モデル設定を保存しました。チャット画面で選択できます。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存できませんでした。"); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!form.id || !window.confirm("このモデル登録を削除しますか？")) return;
    setBusy(true); setError("");
    try { await api(`/api/models/${form.id}`, { method: "DELETE" }); await load(); setForm(emptyForm()); setNotice("モデル登録を削除しました。"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "削除できませんでした。"); }
    finally { setBusy(false); }
  }
  async function test() {
    if (!form.id) return;
    setBusy(true); setError(""); setNotice("接続を確認しています…");
    try {
      const data = await api<{ reply: string; visionSupported: boolean }>("/api/models/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelId: form.id }) });
      await load();
      setNotice(data.visionSupported ? "画像入力と内容認識を確認しました。" : data.reply);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "接続できませんでした。"); }
    finally { setBusy(false); }
  }
  const active = models.find((item) => item.id === (form.sourceId ?? form.id));
  return <main className="settings-shell">
    <header className="settings-header"><Link href="/" className="settings-back"><ArrowLeft size={17}/>資料一覧</Link><span>Slide Harness / 設定</span></header>
    <div className="settings-content">
      <div className="settings-title"><span className="settings-title-icon"><Settings2 size={21}/></span><div><h1>AI 設定</h1><p>接続先とモデルを登録し、資料ごとのチャットで切り替えられます。</p></div></div>
      {(error || notice) && <div className={`settings-alert ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}>{error ? <CircleAlert size={17}/> : <CircleCheck size={17}/>}<span>{error || notice}</span></div>}
      <div className="settings-columns">
        <aside className="settings-list"><div className="settings-list-head"><strong>登録モデル</strong><button type="button" onClick={() => { setForm(emptyForm()); setDiscovered([]); setError(""); }}><Plus size={16}/>追加</button></div>
          {loading ? <p className="settings-empty">読み込んでいます…</p> : models.length ? models.map((model) => <button type="button" key={model.id} className={`settings-model ${(form.sourceId ?? form.id) === model.id ? "active" : ""}`} onClick={() => { setForm(fromProfile(model)); setDiscovered([]); setError(""); }}>
            <span className="settings-model-mark">{model.provider === "azure" ? "Az" : model.provider === "demo" ? "De" : "AI"}</span><span><strong>{model.label}</strong><small>{model.provider === "azure" ? "Azure OpenAI" : model.provider === "demo" ? "デモ" : "OpenAI 互換"} · {model.contextWindow ? `${model.contextWindow.toLocaleString()} tokens` : "文脈長未設定"} · {model.visionSupported ? "Vision 確認済み" : "Vision 未確認"}</small></span>
          </button>) : <p className="settings-empty">モデルがありません。右側から登録してください。</p>}
        </aside>
        <section className="settings-form-panel">
          <div className="settings-form-head"><div><h2>{form.id ? "モデルを編集" : active?.managedBy === "environment" ? "環境モデルを複製" : "モデルを追加"}</h2><p>{active?.managedBy === "environment" ? "環境変数のモデルは読み取り専用です。この内容で新しい登録を作成できます。" : "接続情報と生成時の設定を保存します。"}</p></div>{form.id && <button type="button" className="settings-delete" disabled={busy} onClick={remove}><Trash2 size={15}/>削除</button>}</div>
          <form onSubmit={save}>
            <div className="settings-form-grid">
              <label className="settings-field"><span>表示名</span><input required value={form.label} onChange={(e) => update("label", e.target.value)} placeholder="例：ローカル 27B"/></label>
              <label className="settings-field"><span>種類</span><select value={form.provider} onChange={(e) => { update("provider", e.target.value as FormState["provider"]); setDiscovered([]); }}><option value="vllm">OpenAI 互換 / vLLM</option><option value="azure">Azure OpenAI</option></select></label>
              <label className="settings-field wide"><span>接続先 URL</span><input value={form.baseUrl} onChange={(e) => update("baseUrl", e.target.value)} placeholder={form.provider === "vllm" ? "http://127.0.0.1:8888/v1" : "https://example.openai.azure.com/openai/v1"}/></label>
              {form.provider === "azure" && <><label className="settings-field"><span>Azure リソース名</span><input value={form.resourceName} onChange={(e) => update("resourceName", e.target.value)} placeholder="URL指定時は省略可"/></label><label className="settings-field"><span>API バージョン</span><input value={form.apiVersion} onChange={(e) => update("apiVersion", e.target.value)} placeholder="省略可"/></label></>}
              <label className="settings-field wide"><span>API キー</span><input type="password" autoComplete="new-password" value={form.apiKey} onChange={(e) => update("apiKey", e.target.value)} placeholder={form.id && active?.hasApiKey ? "保存済み（変更時のみ入力）" : "認証不要なら空欄"}/><small>入力したキーは暗号化して保存し、画面には再表示しません。</small></label>
              {form.id && active?.hasApiKey && <label className="settings-check wide"><input type="checkbox" checked={form.clearApiKey} onChange={(e) => update("clearApiKey", e.target.checked)}/><span>保存済みの API キーを削除する</span></label>}
              <div className="settings-discovery wide"><button type="button" className="button button-ghost" disabled={busy} onClick={discover}>{busy ? <Loader2 size={16} className="spin"/> : <RefreshCw size={16}/>}モデルと最大文脈長を取得</button><span>接続先の /models を確認します。</span></div>
              <label className="settings-field wide"><span>モデル ID</span>{discovered.length ? <select value={form.modelName} onChange={(e) => { const match = discovered.find((item) => item.id === e.target.value); setForm((old) => ({ ...old, modelName: e.target.value, contextWindow: match?.contextWindow ?? old.contextWindow })); }}><option value="">選択してください</option>{discovered.map((item) => <option key={item.id} value={item.id}>{item.id}{item.contextWindow ? ` · ${item.contextWindow.toLocaleString()} tokens` : ""}</option>)}</select> : <input required value={form.modelName} onChange={(e) => update("modelName", e.target.value)} placeholder="サーバーのモデル ID または Azure デプロイ名"/>}</label>
              <label className="settings-field"><span>最大コンテキスト長</span><input type="number" min="512" max="2000000" value={form.contextWindow ?? ""} onChange={(e) => update("contextWindow", e.target.value ? Number(e.target.value) : undefined)} placeholder="自動取得"/><small>{form.useManualContext ? "手動設定" : "保存時にも自動取得します"}</small></label>
              <label className="settings-check"><input type="checkbox" checked={form.useManualContext} onChange={(e) => update("useManualContext", e.target.checked)}/><span>自動取得値を使わず、手動の長さを使用</span></label>
            </div>
            <div className="settings-subhead"><h3>生成パラメータ</h3><p>{form.provider === "vllm" ? "OpenAI 互換モデルでは指定値に固定します。" : "このモデルを使った資料生成と編集に適用されます。"}</p></div>
            <div className="settings-form-grid params">
              {form.provider === "vllm" ? <div className="settings-fixed-params wide">temperature 1.0 · top_p 0.95 · top_k 20 · min_p 0.0 · presence_penalty 0.0 · repetition_penalty 1.0</div> : <>
                <label className="settings-field"><span>Temperature</span><input type="number" min="0" max="2" step="0.1" value={form.temperature} onChange={(e) => update("temperature", Number(e.target.value))}/><small>低いほど結果が安定します。</small></label>
                <label className="settings-field"><span>Top P</span><input type="number" min="0.01" max="1" step="0.01" value={form.topP} onChange={(e) => update("topP", Number(e.target.value))}/><small>候補トークンの範囲。</small></label>
              </>}
              <label className="settings-field"><span>最大出力トークン</span><input type="number" min="64" max="131072" value={form.maxOutputTokens} onChange={(e) => update("maxOutputTokens", Number(e.target.value))}/></label>
            </div>
            <div className="settings-memory"><Database size={18}/><div><strong>会話の記憶</strong><p>推定入力と最大出力がコンテキスト長の80%に達すると、古い会話を時系列の観測記録に変えます。直近の会話と元の履歴は保持し、記録が長くなれば方針・決定・未解決事項を再整理します。</p></div></div>
            <div className="settings-actions">{form.id && <button type="button" className="button button-ghost" disabled={busy} onClick={test}><Check size={16}/>Vision 接続を確認</button>}<button className="button button-primary" type="submit" disabled={busy}>{busy ? <Loader2 size={16} className="spin"/> : <Save size={16}/>}保存する</button></div>
          </form>
        </section>
      </div>
    </div>
  </main>;
}
