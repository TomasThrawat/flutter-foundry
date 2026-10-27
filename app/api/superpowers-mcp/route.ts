import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { registerSuperpowersTools } from "@/lib/superpowers";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const handler = createMcpHandler((server) => {
  const register = (
    name: string,
    title: string,
    description: string,
    inputSchema: z.ZodType,
    run: (input: unknown) => Promise<unknown> | unknown,
  ) => {
    server.registerTool(name, { title, description, inputSchema }, async (input: unknown) => {
      try {
        const result = await run(input);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : "Tool execution failed." }],
        };
      }
    });
  };
  registerSuperpowersTools(register);
});

function authorize(request: Request): Response | null {
  const token = process.env.MCP_API_TOKEN;
  if (!token) return null;
  if (request.headers.get("authorization") !== "Bearer " + token) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

export async function GET(request: Request) {
  return authorize(request) || handler(request);
}

export async function POST(request: Request) {
  return authorize(request) || handler(request);
}
