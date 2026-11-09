import { createMcpHandler } from "mcp-handler";
import type { z } from "zod";
import { enforceRateLimit } from "@/lib/request-guards";
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
		server.registerTool(
			name,
			{ title, description, inputSchema },
			async (input: unknown) => {
				try {
					const result = await run(input);
					return {
						content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
						structuredContent: result as Record<string, unknown>,
					};
				} catch (error) {
					return {
						isError: true,
						content: [
							{
								type: "text",
								text:
									error instanceof Error
										? error.message
										: "Tool execution failed.",
							},
						],
					};
				}
			},
		);
	};
	registerSuperpowersTools(register);
});

export async function GET(request: Request) {
	const limited = await enforceRateLimit(
		request,
		"superpowers-mcp",
		120,
		60_000,
	);
	if (limited) return limited;
	return handler(request);
}

export async function POST(request: Request) {
	const limited = await enforceRateLimit(
		request,
		"superpowers-mcp",
		120,
		60_000,
	);
	if (limited) return limited;
	return handler(request);
}
