import { z } from "zod";
import { testModelConnection } from "@/lib/ai";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const { modelId } = z.object({ modelId: z.string().min(1).max(80) }).parse(await request.json());
    return Response.json({ ok: true, reply: await testModelConnection(modelId) });
  } catch (error) { return apiError(error); }
}
