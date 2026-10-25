import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],
  outputFileTracingIncludes: {
    "/mcp": [
      "./node_modules/playwright-core/browsers.json",
      "./node_modules/@sparticuz/chromium/bin/**/*",
      "./node_modules/@sparticuz/chromium/build/**/*",
    ],
  },
  poweredByHeader: false,
};

export default nextConfig;
