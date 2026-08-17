/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // NOTE: `output: "standalone"` is intentionally NOT set here — Vercel packages
  // its own serverless functions. The Dockerfile self-hosting path needs it, so
  // it is injected there via the NEXT_OUTPUT_STANDALONE env var instead.
  ...(process.env.NEXT_OUTPUT_STANDALONE === "1" ? { output: "standalone" } : {}),
  poweredByHeader: false,
  experimental: {
    // Prisma ships a native query engine and ioredis opens raw TCP sockets, so
    // both must stay external and resolve at runtime on Node. bcryptjs is
    // deliberately NOT listed: it is pure JavaScript with no native binary, so
    // externalising it gains nothing and only risks the file not being traced
    // into the serverless bundle. Let the bundler include it normally.
    serverComponentsExternalPackages: ["@prisma/client", "ioredis"],
  },
  logging: {
    fetches: { fullUrl: false },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
