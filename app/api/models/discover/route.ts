import { z } from "zod";
import { apiError } from "@/lib/http";
import { discoverModels, getModel, matchesStoredTarget } from "@/lib/model-settings";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const input = z.object({
      id: z.uuid().optional(),
      provider: z.enum(["azure", "vllm"]), baseUrl: z.string().default(""), resourceName: z.string().default(""),
      modelName: z.string().default(""), apiVersion: z.string().default(""), apiKey: z.string().default(""),
    }).parse(await request.json());
    const stored = input.id ? await getModel(input.id) : null;
    // 保存済みキーは provider と正規化後の接続先が一致する場合だけ再利用し、
    // 一致しないクライアント指定 URL には SSRF ガードを適用する。
    const trusted = !!stored && stored.provider === input.provider && stored.managedBy !== "demo" &&
      matchesStoredTarget(stored, { provider: input.provider, baseUrl: input.baseUrl, resourceName: input.resourceName });
    const apiKey = input.apiKey || (trusted && stored ? stored.apiKey : "") || "";
    return Response.json({ models: await discoverModels({ ...input, apiKey, trusted }) });
  } catch (error) { return apiError(error); }
}
