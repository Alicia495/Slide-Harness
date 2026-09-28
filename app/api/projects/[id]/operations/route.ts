import { z } from "zod";
import { OperationSchema } from "@/lib/document";
import { apiError, requireUuid } from "@/lib/http";
import { commitOperations } from "@/lib/projects";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = requireUuid((await context.params).id);
    const body = z.object({ baseVersion: z.number().int().nonnegative(), operations: z.array(OperationSchema).min(1).max(30) }).parse(await request.json());
    return Response.json({ project: await commitOperations(id, body.baseVersion, body.operations, "manual") });
  } catch (error) { return apiError(error); }
}
