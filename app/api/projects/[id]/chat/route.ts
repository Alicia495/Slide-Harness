import { z } from "zod";
import { generateOperations, generatePlan, generateToolLoopOperations, selectAIGenerationMode, type ActivityReporter, type PhaseReporter } from "@/lib/ai";
import { assetPathsForProject } from "@/lib/assets";
import { buildAIPersistenceDecision } from "@/lib/chat-policy";
import { getModel } from "@/lib/model-settings";
import { apiError, requireUuid } from "@/lib/http";
import { DocumentError, decideAIChangeMode, isReplayableToolLoopResult, operationSummaries } from "@/lib/operations";
import { addMessage, commitOperations, createProposal, getPendingProposal, getProject } from "@/lib/projects";
import { buildPptx } from "@/lib/pptx";
import { renderProposalSlides } from "@/lib/render";

export const runtime = "nodejs";
const encoder = new TextEncoder();

async function assertChatModel(modelId: string, mode: "plan" | "build"): Promise<void> {
  const profile = await getModel(modelId);
  if (!profile) throw new DocumentError("AI モデルを選択してください。");
  if (profile.provider === "demo" && mode === "build") throw new DocumentError("Vision 対応を確認したモデルを選択してください。");
  if (mode === "build" && !profile.visionSupported) throw new DocumentError("選択したモデルは Vision 疎通テストに合格していません。AI 設定で接続を確認してください。");
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let id: string;
  let body: z.infer<typeof BodySchema>;
  try {
    id = requireUuid((await context.params).id);
    body = BodySchema.parse(await request.json());
    const project = await getProject(id);
    if (!project) throw new DocumentError("資料が見つかりません。", 404);
    if (project.version !== body.baseVersion) throw new DocumentError("別の変更が先に保存されました。画面を更新してください。", 409);
    if (await getPendingProposal(id)) throw new DocumentError("確認待ちの変更案を先に適用または破棄してください。", 409);
    await assertChatModel(body.modelId, body.mode);
  } catch (error) { return apiError(error); }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (payload: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`)); } catch { /* クライアント切断時は無視 */ }
      };
      const onPhase: PhaseReporter = (phase, detail) => write({ type: "phase", phase, ...(detail ?? {}) });
      const onActivity: ActivityReporter = (event) => write({ type: "activity", ...event });
      try {
        const project = (await getProject(id))!;
        if (body.mode === "plan") {
          const plan = await generatePlan(id, project.deck, body.prompt, body.modelId, onPhase);
          await addMessage(id, "user", body.prompt, { modelId: body.modelId, mode: "plan" });
          await addMessage(id, "assistant", plan.reply, { mode: "plan", plan: plan.plan, questions: plan.questions });
          write({ type: "result", mode: "plan", reply: plan.reply, plan: plan.plan, questions: plan.questions, compacted: !!plan.compacted });
          return;
        }
        const generationMode = selectAIGenerationMode(process.env, project.deck);
        const generated = generationMode === "tool-loop"
          ? await generateToolLoopOperations(id, project.deck, body.baseVersion, body.prompt, body.modelId, body.target, project.plan, onPhase, onActivity)
          : await generateOperations(id, project.deck, body.prompt, body.modelId, body.target, project.plan, onPhase);
        const reviewedDeck = generated.reviewedDeck ?? null;
        // 再適用判定は tool-loop のみ。legacy は現行どおり reviewedDeck override で保存する。
        const replayable = generationMode === "legacy" || isReplayableToolLoopResult(project.deck, generated.operations, reviewedDeck);
        const decision = buildAIPersistenceDecision({ mode: generationMode, operations: generated.operations, replayable, reviewedDeck });
        if (decision.kind === "chat") {
          await addMessage(id, "user", body.prompt, { modelId: body.modelId, target: body.target });
          await addMessage(id, "assistant", generated.reply, { mode: "chat", questions: generated.questions });
          write({ type: "result", mode: "chat", reply: generated.reply, questions: generated.questions, compacted: !!generated.compacted });
          return;
        }
        const changeMode = decideAIChangeMode(generated.operations, generationMode === "tool-loop" ? generated.policy : undefined);
        if (changeMode === "applied") {
          // 小修正は Vision レビュー済み Deck を提案にせず即時コミットする(ADR-0001)。tool-loop は操作の再適用で Deck と操作ログを一致させる。
          const updated = await commitOperations(id, body.baseVersion, generated.operations, "ai", decision.deckOverride);
          await addMessage(id, "user", body.prompt, { modelId: body.modelId, target: body.target });
          await addMessage(id, "assistant", generated.reply, { mode: "applied", version: updated.version, previousVersion: body.baseVersion, summaries: operationSummaries(generated.operations), review: generated.review });
          write({ type: "result", mode: "applied", reply: generated.reply, project: updated, review: generated.review, compacted: !!generated.compacted });
          return;
        }
        // tool-loop は再適用確認済み操作をそのまま提案に適用し、legacy は reviewedDeck override を維持する。
        const proposal = await createProposal(id, body.baseVersion, generated.operations, decision.deckOverride);
        await addMessage(id, "user", body.prompt, { modelId: body.modelId, target: body.target });
        await addMessage(id, "assistant", generated.reply, { mode: "proposal", proposalId: proposal.id, summaries: operationSummaries(generated.operations), review: generated.review });
        // 変更案の意図確認用に参加者が見る出力プレビュー画像を生成する(失敗しても提案作成は成功扱い)。
        onPhase("rendering");
        let previewSlides: string[] = [];
        try {
          const pptx = await buildPptx(proposal.proposedDeck, await assetPathsForProject(id));
          previewSlides = await renderProposalSlides(id, proposal.id, pptx, proposal.proposedDeck.slides.length);
        } catch (reason) { console.warn(`[chat] 変更案プレビュー生成失敗 project=${id}`, reason); }
        write({ type: "result", mode: "proposal", reply: generated.reply, proposal, previewSlides, compacted: !!generated.compacted });
      } catch (error) {
        if (error instanceof DocumentError) write({ type: "error", error: error.message, status: error.status });
        else {
          console.error(error);
          write({ type: "error", error: "処理に失敗しました。サーバーログを確認してください。", status: 500 });
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
  });
}

const BodySchema = z.object({
  baseVersion: z.number().int().nonnegative(),
  prompt: z.string().trim().min(1).max(4000),
  modelId: z.string().min(1).max(80),
  mode: z.enum(["plan", "build"]).default("build"),
  target: z.object({ slideId: z.uuid().optional(), elementId: z.uuid().optional() }).optional(),
});
