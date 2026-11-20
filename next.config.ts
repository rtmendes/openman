// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const studioStorageOrigin = (() => {
  if (process.env.APP_DB_SCHEMA !== "mahara") return "";
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return url.protocol === "https:" ? ` ${url.origin}` : "";
  } catch { return ""; }
})();

/**
 * Security headers for every response (see docs/security-model.md). Set here rather than in the proxy: with
 * `cacheComponents` pages are served from prerendered shells, so a per-request nonce is not possible without
 * making every page dynamic; the policy therefore allows inline scripts Next emits for its own payload and
 * relies on React's escaping (there is no `dangerouslySetInnerHTML` in `src`).
 *
 * - frame-src: agent-built site previews on Orgo app URLs (`*.web.orgo.dev`), and our own file viewers.
 * - connect-src: Orgo's desktop and terminal websockets (`wss://www.orgo.ai`), ElevenLabs realtime transcription.
 * - frame-ancestors 'none' + X-Frame-Options: our pages cannot be framed (clickjacking).
 * - Microphone only on /app (dictation, meeting recorder); every other page gets no microphone.
 * Route handlers that serve user files set their own stricter `Content-Security-Policy: sandbox`, which replaces this one.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  // https: for styles and fonts: agent-written slides (sandboxed srcdoc frames inherit this policy) often link web fonts.
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "media-src 'self' data: blob: https:",
  `connect-src 'self' https://www.orgo.ai wss://www.orgo.ai wss://*.orgo.ai https://api.elevenlabs.io wss://api.elevenlabs.io${studioStorageOrigin}${isDev ? " ws: http://localhost:* http://127.0.0.1:*" : ""}`,
  "frame-src 'self' https://*.web.orgo.dev https://*.orgo.dev blob: data:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const permissions = (mic: string) =>
  [`microphone=${mic}`, "camera=()", "geolocation=()", "payment=()", "usb=()", "serial=()", "bluetooth=()", "hid=()", "midi=()", "display-capture=()", "interest-cohort=()"].join(", ");

const baseHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Permissions-Policy", value: permissions("()") },
];

const nextConfig: NextConfig = {
  // Deployment settings that browser code needs too (read by `src/config/brand.ts`). Under their own names so
  // server code keeps reading APP_PUBLIC_URL and AGENTMAIL_DOMAIN at run time.
  env: {
    OM_PUBLIC_URL: process.env.APP_PUBLIC_URL ?? "",
    OM_MAIL_DOMAIN: process.env.AGENTMAIL_DOMAIN ?? "",
  },
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: baseHeaders },
      // Later entries override earlier ones for the same header: the app itself may use the microphone.
      { source: "/app", headers: [{ key: "Permissions-Policy", value: permissions("(self)") }] },
      { source: "/app/:path*", headers: [{ key: "Permissions-Policy", value: permissions("(self)") }] },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
