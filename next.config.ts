// file: web/next.config.ts

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Ikke bruk "env:" her for secrets.
  // La process.env håndteres direkte av Node.

  experimental: {
    // Sørger for at route handlers kjører stabilt i node runtime
    // (spesielt viktig med Turbopack + server-side env)
    serverActions: {
      allowedOrigins: ["localhost:3000"],
    },
  },
};

export default nextConfig;