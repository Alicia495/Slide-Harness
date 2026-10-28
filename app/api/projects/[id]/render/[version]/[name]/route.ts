import { apiError, requireUuid } from "@/lib/http";
import { readRenderedSlide } from "@/lib/render";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string; version: string; name: string }> }) {
  try {
    const { id, version, name } = await context.params;
    requireUuid(id);
    if (!/^(\d+|proposal-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(version) || !/^slide-\d+\.png$/.test(name)) return new Response(null, { status: 400 });
    const bytes = await readRenderedSlide(id, version, name);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return new Response(null, { status: 404 });
    return apiError(error);
  }
}
