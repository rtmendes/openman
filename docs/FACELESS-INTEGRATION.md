# Faceless Director integration

Content Studio is the destination for project organization, private media, editable shots and production. The Faceless integration adds source import, seven structured ChatGPT handoffs and local reference analysis to that existing editor.

## Development handoff

The integration branch starts from `codex/studio-project-organization` at `c79069d04fd944960bd37162d6a8a49b7a6ef1fb`. It does not contain uncommitted work on another computer. Review and merge it into the current Studio development branch after committing that computer's changes. Do not reset a dirty working tree or replace the development branch.

No migrations, new dependencies, model credentials or environment variables are required. `studio_drafts` retains its existing authenticated, per-user revision checks. The optional `faceless` field is validated by the draft API and included in normal draft/version storage.

## Import and production

1. Export a workspace JSON from Faceless Director. It can be the workspace object, a `{workspace, revision}` response, or the integration's own source export.
2. Open **Combine Faceless Director projects**, preview the file, and import. Matching source IDs are skipped; existing projects are never replaced. New items can be moved through the existing brand/folder sidebar.
3. Review warnings and source data. The complete source project and channel are preserved separately from the working copy. Credentials/settings are not imported. Source media identifiers are provenance only; use the private asset library to transfer and assign the actual files.
4. Compatible narrated scenes become a native Studio plan. Consecutive source scenes are grouped into at most 24 shots, with every narration word retained. Timings are fitted to the selected runtime; shortened visual descriptions remain complete in the source archive. Failed narration/timing validation leaves the native plan empty and explains why.
5. Wordless projects and sources longer than five minutes are retained for adaptation, not silently truncated into a production-ready film. Review the native script and assets before approval, rendering or publishing. Source approval flags never approve a Studio project.

The source export preserves the Faceless archive and agent outputs. Use Studio's normal project/version recovery for native editor changes and media assignments; the source export is not a full binary-media backup. Import is intentionally one-way and does not establish continuous synchronization between the two applications.

## ChatGPT handoffs

The project panel prepares Channel, Ideas, Script, Storyboard, Packaging, Critique and Strategy tasks. Copy/download the packet, run it in a ChatGPT conversation and paste the JSON response. The result must satisfy its task schema and match the unchanged project snapshot. New agent results remain in the source workspace until **Use source storyboard in editor** is selected; channel results update the project brand context immediately. Original imported content remains recoverable.

These controls make no model API calls and add no API usage. They do not authenticate the deployed site to a ChatGPT subscription, run unattended, or replace Studio's existing credit-based background agent. Media generation, rendering providers and distribution keep their existing configuration and billing. Monetization tasks distinguish supplied actual metrics from scenario assumptions; they do not promise revenue.

## Reference analysis

Local files are sampled in the browser, without upload or model calls: candidate cuts, sampled color palette, decoded dimensions and available audio RMS/peak/silence measurements. Segment length is bounded to 180 seconds; file size to 100 MB. Audio decoding is skipped for inputs over 20 MB or ten minutes. Users can adjust cut threshold, add a segment transcript, review findings, edit style notes, export/import evidence and compare a reference with a rebuild. The built-in calibration film has candidate cuts near 2 and 4 seconds.

Measurements are approximate. No claim is made to recover exact source frame rate, fonts, layers, software or effect settings. Audio values are dBFS, not LUFS. YouTube URLs are not fetched or decoded by this local analyzer.

## Validation

Run:

```sh
npm run typecheck
npx eslint src
node scripts/content-studio-audit.mjs
node scripts/faceless-integration-test.mjs
node scripts/safe-fetch-test.mjs
node src/lib/observability/redact.test.mjs
npm run build
```

The integration tests cover malformed and oversized exports, duplicate IDs, preservation of original data, 41-scene narration conversion, private-asset isolation, runtime and wordless adaptation warnings, export round trips, all seven result schemas, stale task rejection, source/editor synchronization and known-cut comparisons. They use synthetic data and make no provider calls.

Before production certification, check the preview interface, owner-authenticated save/reload against the configured database, real file transfers, mixed-audio render playback and a physical mobile device. Automated tests do not establish those outcomes.
