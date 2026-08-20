# Survey QA Assistant

A Chrome/Edge extension for testing surveys you own or are explicitly authorized to test. It fills controls using synthetic test profiles, verifies form interactions, and leaves final submission to the tester.

## Guardrails

- The extension runs only on exact origins listed in **Settings → Authorized Test Origins**.
- Final submit buttons are never clicked by the extension.
- Attention-check prompts pause the run so the tester can verify the question and scoring manually.
- It does not discover or start other surveys.

## What it tests

- Radio buttons, checkboxes, dropdowns, scales, dates, and text inputs.
- Multi-page flows, stopping at the final submit page.
- Synthetic profiles with demographic fields, custom rules, interests, language, and scenario notes.
- Optional AI-generated synthetic text for authorized QA environments.

## Setup

1. Load this directory in Chrome or Edge using Developer Mode → **Load unpacked**.
2. Open the extension settings and add your test server's exact origin, for example `http://localhost:3000`.
3. Create a synthetic test profile.
4. Navigate to the approved test survey and press **Start**.
5. Review the final page and submit it yourself if appropriate.

## Notes

The extension may still be loaded on a page for detection, but it will refuse to run unless its origin is allowlisted. Keep test profiles synthetic and use a staging or local environment whenever possible.
