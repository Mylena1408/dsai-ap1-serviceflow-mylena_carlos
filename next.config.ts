import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // 4,25 MiB (4.456.448 bytes): 4 MiB of files plus room for the description and the
      // multipart overhead, below the 4.5 MB Vercel Function body limit (SPEC 21.15.3).
      bodySizeLimit: "4.25mb",
    },
  },
};

export default nextConfig;
