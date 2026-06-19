import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@prisma/client",
    "@imgly/background-removal-node",
    "onnxruntime-node",
    "sharp",
  ],
};
export default nextConfig;
