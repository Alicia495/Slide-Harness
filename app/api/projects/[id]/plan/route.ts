import { z } from "zod";
import { apiError, requireUuid } from "@/lib/http";
import { setProjectPlan } from "@/lib/projects";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = requireUuid((await context.params).id);
    const body = z.object({ plan: z.string().trim().max(4000).nullable(), baseVersion: z.number().int().min(0) }).parse(await request.json());
    return Response.json({ project: await setProjectPlan(id, body.plan, body.baseVersion) });
  } catch (error) { return apiError(error); }
}
