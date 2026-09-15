import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@playwright/mcp", "@modelcontextprotocol/sdk"],
};

export default nextConfig;
