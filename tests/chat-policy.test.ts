import { describe, expect, it } from "vitest";
import { buildAIPersistenceDecision, type AIPersistenceDecision } from "../lib/chat-policy";
import { emptyDeck, type Deck, type Operation } from "../lib/document";
import { applyOperations } from "../lib/operations";

function deckWithSlide(): Deck {
  return applyOperations(emptyDeck(), [{ type: "replaceDeck", title: "製品提案", slides: [
    { layout: "title", title: "製品提案", subtitle: "2026年", bullets: [] },
    { layout: "bullets", title: "課題", bullets: ["現状を整理", "改善を進める"] },
  ] }]);
}

function singleEdit(deck: Deck): Operation[] {
  return [{ type: "updateText", slideId: deck.slides[0].id, elementId: deck.slides[0].elements[0].id, text: "更新" }];
}

function expectCommit(decision: AIPersistenceDecision): { deckOverride: Deck | undefined } {
  if (decision.kind !== "commit") throw new Error(`commit を期待して ${decision.kind} を受け取った`);
  return decision;
}

describe("AI persistence decision", () => {
  it("keeps a tool-loop result without committed operations as chat", () => {
    const decision = buildAIPersistenceDecision({ mode: "tool-loop", operations: [], replayable: false, reviewedDeck: null });
    expect(decision.kind).toBe("chat");
  });

  it("keeps a legacy result without operations as chat", () => {
    const decision = buildAIPersistenceDecision({ mode: "legacy", operations: [], replayable: false, reviewedDeck: null });
    expect(decision.kind).toBe("chat");
  });

  it("commits a replayable tool-loop result by re-applying operations without a deck override", () => {
    const deck = deckWithSlide();
    const operations = singleEdit(deck);
    const reviewedDeck = applyOperations(deck, operations);
    const decision = expectCommit(buildAIPersistenceDecision({ mode: "tool-loop", operations, replayable: true, reviewedDeck }));
    expect(decision.deckOverride).toBeUndefined();
  });

  it("passes the reviewed deck as the persistence override for legacy", () => {
    const deck = deckWithSlide();
    const operations = singleEdit(deck);
    const reviewedDeck = applyOperations(deck, operations);
    const decision = expectCommit(buildAIPersistenceDecision({ mode: "legacy", operations, replayable: true, reviewedDeck }));
    expect(decision.deckOverride).toEqual(reviewedDeck);
  });

  it("rejects a non-replayable tool-loop result instead of hiding it behind the reviewed deck", () => {
    const deck = deckWithSlide();
    const operations = singleEdit(deck);
    const reviewedDeck = applyOperations(deck, operations);
    expect(() => buildAIPersistenceDecision({ mode: "tool-loop", operations, replayable: false, reviewedDeck })).toThrow();
  });
});
