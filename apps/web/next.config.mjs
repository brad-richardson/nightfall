/** @type {import('next').NextConfig} */
const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:3001";

const nextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  devIndicators: {
    appIsrStatus: false,
  },
  serverExternalPackages: ['@nightfall/config'],
  // Allow local requests from Playwright/IP address
  allowedDevOrigins: ['127.0.0.1:3000', 'localhost:3000'],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiBaseUrl}/api/:path*`
      }
    ];
  }
};

export default nextConfig;
