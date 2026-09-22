/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@haxitag/yueli-dex",
    "@haxitag/yueli-dex-plugin-sdk",
    "@haxitag/yueli-dex-provider-http",
    "@haxitag/yueli-dex-provider-typesafe",
    "@haxitag/yueli-dex-provider-cloudflare",
    "@haxitag/yueli-dex-provider-vercel",
    "@haxitag/yueli-dex-templates-core",
  ],
  experimental: {
    serverComponentsExternalPackages: [],
  },
};

export default nextConfig;
