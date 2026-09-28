import { z } from "zod";
import { apiError } from "@/lib/http";
import { discoverModels, getModel } from "@/lib/model-settings";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const input = z.object({
      id: z.uuid().optional(),
      provider: z.enum(["azure", "vllm"]), baseUrl: z.string().default(""), resourceName: z.string().default(""),
      modelName: z.string().default(""), apiVersion: z.string().default(""), apiKey: z.string().default(""),
    }).parse(await request.json());
    const stored = input.id ? await getModel(input.id) : null;
    return Response.json({ models: await discoverModels({ ...input, apiKey: input.apiKey || stored?.apiKey }) });
  } catch (error) { return apiError(error); }
}
