import { z } from "zod";
import { DeckSchema, OperationSchema, type Deck, type Operation } from "./document";
import { DocumentError } from "./operations";

export type AIPersistenceDecision =
  | { kind: "chat" }
  | { kind: "commit"; deckOverride: Deck | undefined };

export type AIPersistenceInput = {
  mode: "tool-loop" | "legacy";
  operations: Operation[];
  replayable: boolean;
  reviewedDeck: Deck | null;
};

const PersistenceInputSchema = z.object({
  mode: z.enum(["tool-loop", "legacy"]),
  operations: z.array(OperationSchema),
  replayable: z.boolean(),
  reviewedDeck: z.union([DeckSchema, z.null()]),
});

// 保存段階の判断を集約する。tool-loop は再適用確認済みの操作だけを保存し、reviewedDeck で隠さない。
export function buildAIPersistenceDecision(input: AIPersistenceInput): AIPersistenceDecision {
  const parsed = PersistenceInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new DocumentError("AI の保存判定に使用するデータが不正です。時間をおいて再試行してください。", 500);
  }
  const { mode, operations, replayable, reviewedDeck } = parsed.data;
  if (operations.length === 0) return { kind: "chat" };
  if (mode === "legacy") {
    if (!reviewedDeck) throw new DocumentError("AI の視覚レビュー結果が見つかりません。再試行してください。", 502);
    return { kind: "commit", deckOverride: reviewedDeck };
  }
  // 再適用できないツールループ結果は reviewedDeck 適用で偽らず、操作ログと Deck の不一致を避ける。
  if (!replayable) throw new DocumentError("AI のツールループ結果を安全に保存できませんでした。依頼を短くして再試行してください。", 502);
  return { kind: "commit", deckOverride: undefined };
}
