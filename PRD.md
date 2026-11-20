# Mahara product requirements

## Goal

Give the workspace owner one place to save prior Manus work, continue it with an AI agent, and return to it from a desktop or mobile browser.

## Scope

| Requirement | Acceptance criteria |
| --- | --- |
| Private workspace | The owner signs in through Orgo, and project files require authorized project access. The deployment uses a dedicated Supabase project. |
| Manus import | An owner or project editor can upload multiple exported Markdown files. Files appear in Project files, open in a text preview, and download with their original contents. Each file can be up to 2 MB, with up to 50 per project. |
| Saved content | Projects, files, and supported task history persist across sign-out and are available when the owner signs in from a second device. |
| AI tasks | New project tasks receive the project instructions and available reference files. The user can select a Claude tier, and the Anthropic key option appears when Orgo reports an active key. |
| Browser and app access | The same HTTPS URL works at desktop and phone widths. Supported browsers can install Mahara using the app manifest and icons. |

## Release checks

- Sign in and import a sample Manus file. Refresh and confirm the preview still opens and the downloaded bytes match the original.
- Sign in from a second device and confirm the same project and file appear.
- Start a new Hermes task that summarizes the imported file. Verify the resulting task can be reopened.
- Verify installation and launch on a supported desktop browser and verify Add to Home Screen on iOS Safari.
- Document the result of a long agent run on Vercel before using it for time-sensitive jobs.

## Initial release boundaries

Imports preserve Markdown as reference files. Manus chat history, attachments referenced by remote links, and automatic account synchronization are outside this release. The workspace requires internet access. Hermes and Claude are the initial integrations.
