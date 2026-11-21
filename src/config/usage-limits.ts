// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
/**
 * Per-user caps for everything this server pays a vendor for on the user's behalf (not billed to the user's Orgo
 * account): phone numbers, SMS, calls, agent email, live and batch transcription, speech and sound effects with the
 * server's ElevenLabs key, and website invitation emails. Enforced in the database before each vendor call (`src/lib/usage`).
 * Override any value with the env `USAGE_LIMITS` as JSON, e.g. `{"sms":{"day":100,"month":1000}}`.
 */
export const USAGE_LIMITS = {
  /** Phone numbers bought (AgentPhone). One active at a time is enforced separately. */
  phone_numbers: { day: 1, month: 2, label: "phone numbers" },
  /** Outbound SMS sent from the agent's number. */
  sms: { day: 50, month: 500, label: "text messages" },
  /** Voice turns answered on calls to the agent's number. */
  call_turns: { day: 60, month: 600, label: "phone call turns" },
  /** Agent email inboxes created or replaced (AgentMail). */
  inboxes: { day: 3, month: 10, label: "email addresses" },
  /** Emails the agent sends (replies). */
  emails_sent: { day: 100, month: 1500, label: "emails" },
  /** Live transcription sessions (ElevenLabs realtime tokens). */
  voice_sessions: { day: 40, month: 400, label: "live transcription sessions" },
  /** Live transcription time requested, seconds. */
  voice_seconds: { day: 3 * 3600, month: 30 * 3600, label: "seconds of live transcription" },
  /** Recordings or files sent to ElevenLabs batch transcription. */
  transcription_jobs: { day: 10, month: 100, label: "transcriptions" },
  /** Audio sent to batch transcription, MB. */
  transcription_mb: { day: 2048, month: 10240, label: "MB of audio transcribed" },
  /** Characters turned into speech with the server's ElevenLabs key (`generate_speech`). */
  tts_characters: { day: 5000, month: 20000, label: "characters of speech" },
  /** Sound effects generated with the server's ElevenLabs key (`generate_sound_effect`). */
  sound_effects: { day: 20, month: 100, label: "sound effects" },
  /** People invited to a published website (Orgo emails them). */
  site_invites: { day: 50, month: 300, label: "website invitations" },
  /** Explicit owner-requested DataForSEO Google keyword ideas lookups. */
  studio_keyword_lookups: { day: 10, month: 60, label: "keyword lookups" },
} as const;

export type UsageMetric = keyof typeof USAGE_LIMITS;
