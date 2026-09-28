import { ZodError } from "zod";
import { DocumentError } from "./operations";

export function apiError(error: unknown): Response {
  if (error instanceof DocumentError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError) return Response.json({ error: "入力の形式が正しくありません。", details: error.issues.slice(0, 3).map((issue) => issue.message) }, { status: 400 });
  console.error(error);
  return Response.json({ error: "処理に失敗しました。サーバーログを確認してください。" }, { status: 500 });
}

export function requireUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new DocumentError("ID の形式が正しくありません。");
  }
  return value;
}
