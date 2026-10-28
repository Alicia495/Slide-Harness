import { z } from "zod";
import { apiError } from "@/lib/http";
import { createProject, listProjects } from "@/lib/projects";

export const runtime = "nodejs";
export async function GET() {
  try { return Response.json({ projects: await listProjects() }); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    const body = z.object({ title: z.string().max(160).optional(), templateId: z.uuid().optional() }).parse(await request.json());
    return Response.json({ project: await createProject(body.title, body.templateId) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
