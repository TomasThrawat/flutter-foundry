import type { NextConfig } from "next";
const nextConfig: NextConfig = { serverExternalPackages: ["@sparticuz/chromium", "playwright-core"], poweredByHeader: false };
export default nextConfig;