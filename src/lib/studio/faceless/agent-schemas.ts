import { z } from 'zod';
const txt = z.string().max(100000);
const small = z.string().max(6000);
export const outputSchemas = {
    channel: z.object({ name: small, niche: small, audience: small, promise: small, rules: txt, style: small, cta: small, notes: small }),
    ideas: z.object({ ideas: z.array(z.object({ title: small, angle: small, hook: small, evidence: small, priority: z.enum(['high', 'medium', 'low']) })).min(1).max(100) }),
    script: z.object({ script: txt.min(1), claims: z.array(small).max(100), notes: small }),
    storyboard: z.object({ scenes: z.array(z.object({ title: small, text: txt, visual: small, duration: z.number().finite().positive().max(180) })).min(1).max(100) }),
    package: z.object({ titles: z.array(small).min(1).max(20), description: txt, thumbnailText: small, concepts: z.array(small).max(20) }),
    critique: z.object({ notes: small, issues: z.array(z.object({ severity: z.string().max(50), location: small, fix: small })).max(100), ready: z.boolean() }),
    strategy: z.object({ notes: small, experiments: z.array(z.object({ hypothesis: small, change: small, metric: small, successCriterion: small })).max(100) })
};
