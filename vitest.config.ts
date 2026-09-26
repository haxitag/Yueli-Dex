import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      "@haxitag/yueli-dex": path.resolve(__dirname, "packages/core/src"),
      "@haxitag/yueli-dex-plugin-sdk": path.resolve(__dirname, "packages/plugin-sdk/src"),
      "@haxitag/yueli-dex-provider-http": path.resolve(__dirname, "packages/provider-http/src"),
      "@haxitag/yueli-dex-provider-typesafe": path.resolve(__dirname, "packages/provider-typesafe/src"),
      "@haxitag/yueli-dex-provider-cloudflare": path.resolve(__dirname, "packages/provider-cloudflare/src"),
      "@haxitag/yueli-dex-provider-vercel": path.resolve(__dirname, "packages/provider-vercel/src"),
      "@haxitag/yueli-dex-templates-core": path.resolve(__dirname, "packages/templates-core/src"),
    },
  },
});
