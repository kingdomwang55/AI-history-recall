import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: path.resolve(".")
  },
  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@": path.resolve("./src")
    };

    return config;
  },
  serverExternalPackages: ["better-sqlite3"]
};

export default nextConfig;
