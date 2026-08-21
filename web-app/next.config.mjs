const apiProxyTarget = (
  process.env.API_PROXY_TARGET || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

const outputConfig =
  process.platform === "win32" ? {} : { output: "standalone" };

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...outputConfig,
  reactStrictMode: false,
  skipTrailingSlashRedirect: true,
  experimental: {
    optimizePackageImports: [
      "@ant-design/x",
      "@ant-design/x-sdk",
      "lodash",
    ],
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiProxyTarget}/:path*`,
      },
    ];
  },
};

export default nextConfig;
