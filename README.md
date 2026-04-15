# AEM Agent — AI-Powered AEM Developer Assistant

[![Tests](https://img.shields.io/badge/tests-20%2F20%20passing-brightgreen)](./tests)
[![Manifest](https://img.shields.io/badge/manifest-v3-blue)](./manifest.json)
[![Version](https://img.shields.io/badge/version-1.0.0-orange)](./manifest.json)
[![License](https://img.shields.io/badge/license-ISC-lightgrey)](./package.json)

A Chrome extension that puts an AI development assistant directly inside Adobe Experience Manager. Analyze Sling logs, audit governance, create Content Fragments, diff environments, and debug permissions — without leaving the browser.

---

## Features

### Log Whisperer
Fetches live Sling error logs, filters for high-signal entries (ERRORs, stack traces, resource-type matches), and surfaces them in the side panel. On instances with Gemini Nano, the AI correlates errors to components automatically.

### Governance Audit
Runs automatically on every AEM author page. Checks for missing alt text (ADA), excessive component nesting (performance), and missing SEO metadata. Displays a live health score (0–100%) in the header.

### JCR Environment Diff
Fetches `{page}.infinity.json` from your local author and a configured stage URL, then diffs the JCR tree recursively (3 levels deep). Highlights added, removed, and changed properties including sub-nodes.

### Content Grafting
After diffing, graft the page JCR content to the target environment via Sling POST import. Requires credentials in Settings.

### Content Fragment Creation
Creates Content Fragments via the AEM Assets HTTP API. Discovers real CF models from `/conf/{site}/settings/dam/cfm/models`. Supports both `dam:CFModel` (AEM 6.5) and `cq:Template` (AEM as a Cloud Service).

### Ghostwriter (AI SEO)
Reads the live page DOM, extracts H1 and body text, uses Gemini Nano (or simulation mode) to suggest SEO title + meta description, then writes to `jcr:content` via Sling POST.

### Page Actions
- **Publish** — Activates via `/bin/replicate.json` with CSRF token
- **Unlock** — Removes `cq:locked`/`cq:lockOwner` from `jcr:content`
- **Permissions Debug** — Shows effective ACLs and inheritance trace

### WebMCP Tool Registration
Registers `execute_aem_api` and `get_page_dom` with `window.navigator.modelContext` so AI assistants with WebMCP support can interact with AEM from the browser.

---

## Installation

### Load Unpacked (Developer Mode)
1. Clone: `git clone https://github.com/narendragandhi/aem-agent-extension.git`
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** → select the cloned folder
5. AEM Agent icon appears in your toolbar

### From Chrome Web Store
*(Submission in progress)*

---

## Setup

Open the side panel → **Actions** tab → **Environment Reference** section:

| Field | Example |
|---|---|
| AEM Author URL | `http://localhost:4502` or `https://author-p12345-e67890.adobeaemcloud.com` |
| AEM Username | `admin` |
| AEM Password | `••••••••` |
| Stage / Publish URL | `https://publish-p12345-e67890.adobeaemcloud.com` |

Credentials stored in `chrome.storage.local` — never transmitted outside your configured AEM hosts.

---

## Compatibility

| Environment | Status |
|---|---|
| AEM 6.5 on `localhost:4502` | Fully supported |
| AEM as a Cloud Service (`*.adobeaemcloud.com`) | Supported via browser session |
| Gemini Nano AI features | Chrome Canary + `#prompt-api-for-gemini-nano` flag |
| Cloud Manager integration | Requires Adobe I/O API key |

---

## Security

Audited against OWASP and Snyk guidelines:

- **CSRF tokens** on every mutating request
- **URL allowlist** — stage/target URLs validated before credentials are transmitted
- **BSRF prevention** — `execute_aem_api` restricted to relative JCR paths only
- **No `eval()`**, no remote code execution
- **CSP enforced** — `script-src 'self'; object-src 'self'`
- **Sender validation** in content script `onMessage`

[Privacy Policy](https://narendragandhi.github.io/aem-agent-extension/privacy-policy.html)

---

## Running Tests

```bash
npm install
npx playwright install chromium
npx playwright test
```

Requires a live AEM instance at `http://localhost:4502` with WKND content for integration tests.

**20/20 tests passing** — 6 unit + 14 integration against live AEM SDK.

---

## Architecture

```
aem-agent-extension/
├── manifest.json                  # MV3, v1.0.0
├── src/
│   ├── background/background.js   # Service worker — AEM APIs, CSRF, config
│   ├── content/
│   │   ├── bridge.js              # MAIN world — Granite context, WebMCP
│   │   └── content.js             # ISOLATED world — DOM relay
│   ├── popup/                     # Toolbar popup
│   └── sidepanel/                 # Agent UI
├── tests/
│   ├── extension.test.js
│   ├── wow-features.test.js
│   └── aem-integration.test.js    # Live AEM tests
├── assets/                        # Icons 16/32/48/128px
└── privacy-policy.html
```

---

## Roadmap

- [ ] IMS / OAuth 2.0 for AEM as a Cloud Service
- [ ] Real Adobe I/O Cloud Manager integration
- [ ] Bulk page operations (bulk activate, bulk diff)
- [ ] Component-level JCR diff

---

## License

ISC © Narendra Gandhi
