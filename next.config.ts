import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  // El route /dev/skill lee estas skills en runtime para servirlas interpoladas:
  // hay que incluirlo en el bundle de la función serverless (no solo en el CDN).
  // La skill vive en ./skills (layout estándar de `npx skills`), no en public/.
  outputFileTracingIncludes: {
    "/dev/skill": ["./skills/**/*"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withSentryConfig(nextConfig, {
  // Identidad del proyecto (o vía env SENTRY_ORG / SENTRY_PROJECT).
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Token para subir source maps en el build. Sin él, se omite la subida
  // (build local/sin CI no falla ni tira warnings).
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  silent: !process.env.CI,
  telemetry: false,
});
