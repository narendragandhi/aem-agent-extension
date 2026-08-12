# Chrome Web Store readiness

The extension is intended for AEM developers and architects. SLICC is an
optional browser operator that can use the extension's read-only WebMCP tools;
it is not a required service and is not bundled with the extension.

## Release gates

Run these checks from the repository root:

```bash
npm ci
npm run validate:store
npm run test:unit
npm run build
```

Before submitting, run the complete Playwright suite in Linux CI and verify the
extension manually against a disposable AEM author instance. The live AEM
suite performs writes, so use a test page and test content only.

## Store listing declarations

- Single purpose: governed diagnostics and authoring assistance for AEM pages.
- Data handled: AEM page DOM, JCR/API responses, logs, workflow/MSM metadata,
  configured URLs, and credentials supplied by the user.
- Persistent storage: settings and username only. The AEM password is held in
  `chrome.storage.session` and is not persisted across browser sessions.
- Destinations: only the user-configured AEM author/stage host and local
  CXForge, when the user explicitly invokes a feature.
- No analytics, advertising, affiliate links, or extension-author-operated
  data collection.
- Reviewer access: provide a disposable AEM account and a short walkthrough
  covering read-only audit, WebMCP inspection, and confirmation-gated writes.

Do not claim Cloud Manager support in the listing until its real integration is
implemented and tested. Do not submit screenshots or descriptions that imply
AI features are available when Gemini Nano is unavailable; describe the local
rule-based fallback accurately.
