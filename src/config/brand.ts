// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
/**
 * One place for every brand-specific string and asset. Forks rename the product here.
 *
 * The public URL and the agent mail domain are deployment settings, not brand constants: they come from
 * `APP_PUBLIC_URL` and `AGENTMAIL_DOMAIN`, which `next.config.ts` passes to browser code as
 * `OM_PUBLIC_URL` and `OM_MAIL_DOMAIN`.
 */
const publicUrl = (process.env.OM_PUBLIC_URL || process.env.APP_PUBLIC_URL || "http://localhost:3000").trim().replace(/\/+$/, "");

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "localhost";
  }
}

export const brand = {
  name: "Mahara",
  wordmark: "mahara",
  agentNoun: "Mahara",
  /** Public origin of this deployment, without a trailing slash. */
  url: publicUrl,
  /** Host name of `url`. */
  host: hostOf(publicUrl),
  /** Domain of the agent's inbound mail addresses; null until one is configured (the mail provider's default applies). */
  mailDomain: (process.env.OM_MAIL_DOMAIN || process.env.AGENTMAIL_DOMAIN || "").trim().toLowerCase() || null,
  /** Drawn for dark backgrounds; each has a `-light.svg` twin in dark ink for light backgrounds. */
  logoMark: "/brand/logo-mark.svg",
  logoWord: "/brand/logo-word.svg",
  modes: {
    max: { label: "Mahara Max", description: "Our strongest model, for long, multi-step work." },
    standard: { label: "Mahara", description: "The balanced default for most jobs." },
    lite: { label: "Mahara Lite", description: "Quick and light, for small everyday jobs." },
    flex: { label: "Your own key", description: "Runs on the model API key you bring." },
  },
} as const;
export type ModeId = keyof typeof brand.modes;
