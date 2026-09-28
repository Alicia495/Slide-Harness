import { readAsset } from "@/lib/assets";
import { apiError, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = requireUuid((await context.params).id);
    const asset = await readAsset(id);
    if (!asset) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(asset.bytes), { headers: { "Content-Type": asset.mimeType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return apiError(error); }
}
