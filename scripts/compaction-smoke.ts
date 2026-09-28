import assert from "node:assert/strict";
import { db } from "../lib/db";
import { generateOperations } from "../lib/ai";
import { deleteModel, saveModel } from "../lib/model-settings";
import { addMessage, createProject, getProject } from "../lib/projects";

if (!process.env.DATABASE_URL) process.loadEnvFile(".env.local");
if (!process.env.DATABASE_URL || !process.env.VLLM_BASE_URL || !process.env.VLLM_MODEL) {
  throw new Error("DATABASE_URL, VLLM_BASE_URL and VLLM_MODEL are required");
}
process.env.DB_POOL_MAX = "1";

let modelId: string | undefined;
let projectId: string | undefined;
try {
  const model = await saveModel({
    label: "圧縮動作確認 5k", provider: "vllm",
    modelName: process.env.VLLM_MODEL,
    baseUrl: process.env.VLLM_BASE_URL, contextWindow: 5120, useManualContext: true,
    maxOutputTokens: 1536, temperature: 1, topP: 0.95,
  });
  modelId = model.id;
  const project = await createProject("圧縮動作確認");
  projectId = project.id;
  const conversation = await db().query<{ id: string }>("SELECT id FROM conversations WHERE project_id=$1", [projectId]);
  const conversationId = conversation.rows[0].id;
  const decisions = [
    "企画部門の定例会議に向けて、社内の進捗資料を作りたい。今回の主題は新しい申請フローの試行状況で、聞き手が会議後に次の行動を決められる内容にしたい。",
    "目的は申請フローの試行状況を共有し、会議で次の行動を決めることですね。対象は企画部門として、現状、判断事項、担当の順で資料を組み立てます。",
    "最初の案では濃いネイビーの背景を希望します。見出しを白にして、画面の切り替わりが分かる構成にしてください。表紙を作るなら色を統一したいです。",
    "濃いネイビーと白文字を当初の配色案として記録しました。投影時の視認性や資料の印刷を考え、後で配色を見直せるようにしておきます。",
    "会議室で投影すると暗い背景の細字が読みづらいので、濃いネイビー案は取り下げます。薄いグレーの背景と濃い文字に変更してください。",
    "配色は薄いグレーを基調に変更します。以前の濃いネイビー案は採用しません。見出しと本文の明暗差を保ち、投影時に読みやすくします。",
    "結論を最初に示してください。現時点では試行を続ける方針で、正式展開はまだ決定していません。『展開決定』と読める書き方は避けたいです。",
    "冒頭で『試行継続』を結論として示し、正式展開は未決定と明記します。確定事項と検討中の事項が混ざらないよう文言を分けます。",
    "申請件数と処理時間はまだ集計中です。具体的な数字を書く場合は仮置きと明示し、もっともらしい実績値を作らないでください。",
    "数値は未確定として扱います。集計が終わるまでは具体的な実績値を捏造せず、必要なら『集計中』と表示します。",
    "今回は図表を入れないでください。会議では細かい推移よりも、試行を続ける理由と次に決めることをすばやく共有したいです。",
    "図表は省き、短い文章と見出しで構成します。試行継続の理由、未解決事項、会議後の行動が一目で分かる並びにします。",
    "背景説明は一文に抑えてください。聞き手は制度の概要を知っています。画面の文字量が多いと議論の時間が減るので、短い箇条書きを使いたいです。",
    "背景は一文だけにし、判断に必要な情報を優先します。各項目は短い箇条書きにして、会議中に読み切れる文字量へ整えます。",
    "タイトル候補を『申請フロー試行の進捗』『申請フローの次の一歩』の二つで考えています。どちらが結論先行の構成に合うか比べたいです。",
    "前者は状況共有が明確で、後者は行動を促す印象です。今回の会議では進捗共有が主目的なので、前者を暫定候補として示します。",
    "タイトルは『社内進捗の共有』に決めます。対象の申請フローは副題で示せば十分です。暫定候補だった二つのタイトルは使わないでください。",
    "確定タイトルを『社内進捗の共有』、副題を『申請フローの試行状況』として記録します。先ほどの二つの候補は不採用にします。",
    "検討中の別案を別紙にまとめる必要はありません。資料には確定した方針と未決定である事実だけを載せ、議論の途中案は載せないでください。",
    "最終資料では試行継続、正式展開は未決定、数値は集計中という状態を分けて示します。途中で却下した別案は掲載しません。",
    "試行で確認したい点は、担当者が申請の差し戻し理由を理解できるかどうかです。今のところ改善余地があるので、成果だけを強調しないでください。",
    "差し戻し理由の分かりやすさを確認項目に入れます。改善余地を残していることも明記し、試行の成果を過大に表現しないようにします。",
    "会議で決めるのは試行継続の範囲だけです。正式展開の是非は集計結果と現場からの意見を見てから別途判断します。",
    "今回の判断事項を試行継続の範囲に限定します。正式展開は今回の会議の決定事項に含めず、後日の判断として示します。",
    "現場からは入力項目が多いという声があります。具体的に減らす項目は未定なので、改善候補としてだけ扱ってください。",
    "入力項目の多さは現場からの意見として記載します。削減する項目は未決定のため、確定した改善策のようには書きません。",
    "箇条書きは一項目一文にしてください。申請フローの専門用語は社内の共通名称だけにとどめ、説明のための長い注釈は避けたいです。",
    "一項目一文の箇条書きにします。共通名称以外の専門用語を増やさず、注釈が必要な内容は口頭で補足できるように絞ります。",
    "もし一枚に収めるなら、左に結論と理由、右に次の行動を置く構成はどうでしょう。細部の位置は読みやすさを優先して調整して構いません。",
    "左に試行継続の結論と理由、右に企画部の次の行動を置く二分割案として受け取りました。見出しの大きさと余白で読み順を作ります。",
    "薄いグレーは背景だけに使い、本文は濃い色にしてください。強調色は青を少量なら使えますが、結論が色だけで伝わる設計は避けたいです。",
    "背景を薄いグレー、本文を濃色とし、青は補助的な強調に限定します。『試行継続』という文字でも結論を明確に示します。",
    "担当が企画部であることは資料に入れてください。ただし個人名はまだ決まっていないので、架空の名前を置かないでください。",
    "担当は企画部と表示し、個人名は入れません。未定の期限や未集計の数値についても、確定値を作らない方針を維持します。",
    "最後に次の行動と担当を入れたいです。担当は企画部で、集計結果を確認してから再度判断します。期限はまだ決まっていません。",
    "次の行動は企画部による集計結果の確認と再判断です。期限は未定として扱い、勝手な日付は記載しません。",
    "まずは一枚の構成案から始めましょう。決定済みの配色、結論先行、図表なし、短い文、未確定事項の表示を反映してください。",
    "一枚構成の依頼を受けました。配色は薄いグレー、結論は試行継続、図表は省略し、未決定の正式展開と集計中の数値を明確に分けます。",
  ];
  for (const [index, decision] of decisions.entries()) {
    const role = index % 2 === 0 ? "user" : "assistant";
    await db().query("INSERT INTO messages(id,conversation_id,role,content,created_at) VALUES($1,$2,$3,$4,$5)", [
      crypto.randomUUID(), conversationId, role, decision, new Date(Date.now() - (decisions.length - index) * 60_000),
    ]);
  }
  const original = await getProject(projectId);
  assert.ok(original);
  const prompt = "これまでの決定を踏まえ、社内向け進捗資料を1枚で作成して。";
  await addMessage(projectId, "user", prompt, { modelId });
  const result = await generateOperations(projectId, original.deck, prompt, modelId);
  assert.equal(result.compacted, true);
  await addMessage(projectId, "assistant", result.reply, { mode: "proposal" });
  const memory = await db().query<{ observations: { text: string }[]; reflection: string; compaction_count: number; last_compacted_message_id: string }>(
    "SELECT observations,reflection,compaction_count,last_compacted_message_id FROM conversation_memory WHERE conversation_id=$1", [conversationId],
  );
  assert.equal(memory.rows.length, 1);
  assert.ok(memory.rows[0].compaction_count >= 1);
  assert.ok(memory.rows[0].last_compacted_message_id);
  const remembered = `${memory.rows[0].reflection}\n${memory.rows[0].observations.map((item) => item.text).join("\n")}`;
  assert.match(remembered, /ネイビー|グレー/);
  const messageCount = await db().query<{ count: string }>("SELECT count(*) FROM messages WHERE conversation_id=$1", [conversationId]);
  assert.equal(Number(messageCount.rows[0].count), decisions.length + 2);
  console.log(`Compaction smoke passed: ${memory.rows[0].compaction_count} pass(es), ${result.operations.length} operation(s), ${memory.rows[0].observations.length} observations`);
} finally {
  if (projectId) await db().query("DELETE FROM projects WHERE id=$1", [projectId]);
  if (modelId) await deleteModel(modelId);
  await db().end();
}
