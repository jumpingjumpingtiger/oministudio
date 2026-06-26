import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@prisma/client",
    "@imgly/background-removal-node",
    "onnxruntime-node",
    "sharp",
    "better-sqlite3",
    "pg",
    "sqlite-vec",
    "@huggingface/transformers",
  ],
};
export default nextConfig;
