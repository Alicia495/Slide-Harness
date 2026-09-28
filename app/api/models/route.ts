import { apiError } from "@/lib/http";
import { listModels, saveModel } from "@/lib/model-settings";

export const runtime = "nodejs";
export async function GET() {
  try { return Response.json({ models: await listModels() }); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try { return Response.json({ model: await saveModel(await request.json()) }, { status: 201 }); }
  catch (error) { return apiError(error); }
}
