import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],
  outputFileTracingIncludes: {
    "/mcp": ["./node_modules/playwright-core/browsers.json"],
  },
  poweredByHeader: false,
};

export default nextConfig;
