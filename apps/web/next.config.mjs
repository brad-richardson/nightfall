/** @type {import('next').NextConfig} */
const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:3001";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const isExport = process.env.NEXT_EXPORT === "1";

const nextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  devIndicators: {
    appIsrStatus: false,
  },
  serverExternalPackages: ['@nightfall/config'],
  // Allow local requests from Playwright/IP address
  allowedDevOrigins: ['127.0.0.1:3000', 'localhost:3000'],
  output: isExport ? "export" : "standalone",
  trailingSlash: isExport ? true : undefined,
  basePath,
  assetPrefix: basePath ? `${basePath}/` : undefined,
  experimental: {
    turbopackUseSystemTlsCerts: true,
  },
  async rewrites() {
    if (isExport) return [];
    return [
      {
        source: "/api/:path*",
        destination: `${apiBaseUrl}/api/:path*`
      }
    ];
  }
};

export default nextConfig;
