# Mahara operations SOP

## Deploy the workspace

1. Use the Mahara project in Vercel and a dedicated Mahara project in Supabase. Keep development and production credentials separate.
2. Apply the SQL migrations in `supabase/migrations/` in order. Use the database project identified for Mahara when running `supabase db push`.
3. Follow [Quick start](README.md#quick-start-self-hosting) to run `node scripts/setup.mjs` with a local `.env.local`. Apply its generated database-secret hash SQL in the Mahara database.
4. In Vercel Production environment variables, set `APP_PUBLIC_URL` to the production HTTPS URL, `INVITE_GATE=1`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `APP_DB_SECRET`, `SESSION_SECRET`, `APP_ENCRYPTION_KEY`, and `CRON_SECRET`. Use the dedicated project's publishable key and the generated Mahara secrets. Keep `.env.local` out of Git.
5. Run `npm run typecheck` and `npm run build`, then deploy with `vercel deploy --prod --project mahara` under the intended Vercel scope. The first authorized Orgo sign-in initializes the invite list. Complete computer setup for Hermes on the owner's Orgo account.
6. Verify `/api/health`, `/signin`, and `/manifest.webmanifest`. Run the [PRD release checks](PRD.md#release-checks) with a sample Markdown export before importing the owner's archive.

## Import and resume work

1. Open the relevant project and select **Project files → Import Manus Markdown**.
2. Choose the exported files and check each one appears. Open the filename to preview the text.
3. Add reusable guidance under **Instructions**. Start a new task in the project and identify the files Hermes should use.
4. To use your own Anthropic key, save it in Orgo Secrets and refresh Mahara. Select **Your own key** after it appears in the model menu.

## Diagnose and recover

- **Sign-in or uploads fail** — Verify the Vercel environment scope, Supabase migrations, database-secret hash, and project permissions. Redeploy after changing Vercel environment variables.
- **A model or task fails** — Check the selected Orgo computer, credit balance or Anthropic key, and Vercel runtime logs. A task may outlive a Vercel function invocation. Verify long-running tasks before relying on them.
- **Scheduled work stops** — Run the scheduler from a persistent runner or call the authenticated cron endpoint from an external scheduler. Verify the last tick through `/api/health/deep`. See [deployment details](docs/deploy.md).
- **A release breaks the app** — Restore the last healthy Vercel deployment if the database schema is compatible. Handle database recovery separately using the Supabase project's backups.
