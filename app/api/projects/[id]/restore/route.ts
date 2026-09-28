import { z } from "zod";
import { apiError, requireUuid } from "@/lib/http";
import { restoreVersion } from "@/lib/projects";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = requireUuid((await context.params).id);
    const body = z.object({ baseVersion: z.number().int().nonnegative(), restoreVersion: z.number().int().nonnegative() }).parse(await request.json());
    return Response.json({ project: await restoreVersion(id, body.baseVersion, body.restoreVersion) });
  } catch (error) { return apiError(error); }
}
