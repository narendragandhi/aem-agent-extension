# SLICC Integration Example

SLICC can operate the AEM Agent Extension as a browser-based AEM operations
assistant. The extension remains responsible for its own host allowlist, CSRF
handling, credentials, and side-panel actions; SLICC supplies the natural
language operator and browser control.

## Start

1. Build or install the extension dependencies:

   ```bash
   npm install
   ```

2. Load the repository as an unpacked Chrome extension from
   `chrome://extensions`.
3. Open a test AEM Author page, such as `http://localhost:4502`.
4. Open the AEM Agent side panel.
5. Start SLICC with `npx sliccy` and operate the same browser session.

## Example request

> Run a content-health audit for the current page. Show the findings and
> proposed fixes. Do not publish or modify content.

Expected operator flow:

1. Identify the AEM Author page and current page path.
2. Open the extension's Content Health or Accessibility action.
3. Read the results from the side panel.
4. Capture the findings and screenshot.
5. Stop before Publish, Graft, Unlock, or any write operation.

For a write request, SLICC must summarize the target, path, fields, and
environment, then wait for confirmation immediately before the action.

## WebMCP note

The extension currently exposes lightweight page tools such as
`get_page_dom` and `execute_aem_api`. Prefer the AEM WebMCP contract from
`aem-webmcp` when that clientlib is present; it provides stronger tool metadata
and consent semantics. Do not use `execute_aem_api` as a general-purpose
escape hatch.

## Verification

```bash
npm run test:unit
```

Live integration tests require AEM at `http://localhost:4502` with suitable
WKND content and are intentionally separate from the unit run.
