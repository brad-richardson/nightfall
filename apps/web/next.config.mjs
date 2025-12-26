/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  devIndicators: {
    appIsrStatus: false,
  },
  serverExternalPackages: ['@nightfall/config'],
  // Allow local requests from Playwright/IP address
  allowedDevOrigins: ['127.0.0.1:3000', 'localhost:3000']
};

export default nextConfig;
