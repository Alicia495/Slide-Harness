import { apiError } from "@/lib/http";
import { listTemplates, saveTemplate } from "@/lib/templates";

export const runtime = "nodejs";
export async function GET() {
  try { return Response.json({ templates: await listTemplates() }); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "テンプレートファイル（.potx）を選択してください。" }, { status: 400 });
    const name = form.get("name");
    const template = await saveTemplate(file, typeof name === "string" ? name : undefined);
    return Response.json({ template }, { status: 201 });
  } catch (error) { return apiError(error); }
}
