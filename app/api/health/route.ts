import { db } from "@/lib/db";

export const runtime = "nodejs";
export async function GET() {
  try {
    await db().query("SELECT 1");
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "error" }, { status: 503 });
  }
}
