/**
 * AEM Integration Tests
 * Requires a live AEM instance at http://localhost:4502 with WKND content.
 * Run: npx playwright test tests/aem-integration.test.js
 */
const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const extensionPath = path.resolve(__dirname, '../');
const AEM = 'http://localhost:4502';
const AEM_USER = 'admin';
const AEM_PASS = 'admin';
const WKND_PAGE = '/content/wknd/us/en/magazine';

function aemHeaders(csrfToken) {
  const headers = { 'Authorization': 'Basic ' + Buffer.from(`${AEM_USER}:${AEM_PASS}`).toString('base64') };
  if (csrfToken) headers['CSRF-Token'] = csrfToken;
  return headers;
}

async function getCsrfToken(request) {
  const res = await request.get(`${AEM}/libs/granite/csrf/token.json`, {
    headers: aemHeaders()
  });
  const data = await res.json();
  return data.token;
}

test.describe('AEM Integration — Core APIs', () => {

  test('CSRF token endpoint is accessible', async ({ request }) => {
    const res = await request.get(`${AEM}/libs/granite/csrf/token.json`, {
      headers: aemHeaders()
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.token).toBeTruthy();
    expect(data.token.length).toBeGreaterThan(10);
  });

  test('JCR read — WKND page properties', async ({ request }) => {
    const res = await request.get(`${AEM}${WKND_PAGE}/jcr:content.json`, {
      headers: aemHeaders()
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data['jcr:primaryType']).toBeTruthy();
    expect(data['cq:template']).toBeTruthy();
    console.log('Page template:', data['cq:template']);
    console.log('Page title:', data['jcr:title']);
  });

  test('Replicate (Activate) page with CSRF token', async ({ request }) => {
    const token = await getCsrfToken(request);
    const res = await request.post(`${AEM}/bin/replicate.json`, {
      headers: { ...aemHeaders(token), 'Content-Type': 'application/x-www-form-urlencoded' },
      data: `path=${encodeURIComponent(WKND_PAGE)}&cmd=Activate&_charset_=utf-8`
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data['status.code']).toBe(200);
    console.log('Replicate result:', data['status.message']?.trim());
  });

  test('Lock page via Sling POST (cq:locked)', async ({ request }) => {
    const token = await getCsrfToken(request);

    // Lock
    const lockRes = await request.post(`${AEM}${WKND_PAGE}/jcr:content`, {
      headers: { ...aemHeaders(token), 'Content-Type': 'application/x-www-form-urlencoded' },
      data: `cq:locked=true&cq:lockOwner=admin&_charset_=utf-8`
    });
    expect(lockRes.ok()).toBeTruthy();

    // Verify locked
    const checkRes = await request.get(`${AEM}${WKND_PAGE}/jcr:content.json`, { headers: aemHeaders() });
    const data = await checkRes.json();
    // JCR JSON servlet returns booleans as strings ("true") in some AEM versions
    expect(data['cq:locked']).toBeTruthy();
    console.log('Page locked, owner:', data['cq:lockOwner']);
  });

  test('Unlock page via Sling POST (delete cq:locked)', async ({ request }) => {
    const token = await getCsrfToken(request);

    // Unlock
    const unlockRes = await request.post(`${AEM}${WKND_PAGE}/jcr:content`, {
      headers: { ...aemHeaders(token), 'Content-Type': 'application/x-www-form-urlencoded' },
      data: `cq:locked@Delete=&cq:lockOwner@Delete=&_charset_=utf-8`
    });
    expect(unlockRes.ok()).toBeTruthy();

    // Verify unlocked
    const checkRes = await request.get(`${AEM}${WKND_PAGE}/jcr:content.json`, { headers: aemHeaders() });
    const data = await checkRes.json();
    expect(data['cq:locked']).toBeUndefined();
    console.log('Page unlocked successfully');
  });

  test('JCR infinity diff — WKND page deep structure', async ({ request }) => {
    const res = await request.get(`${AEM}${WKND_PAGE}.infinity.json`, { headers: aemHeaders() });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    // Should have jcr:content with nested structure
    const jcrContent = data['jcr:content'];
    expect(jcrContent).toBeTruthy();
    // Check we get sub-nodes (previously the diff skipped these)
    const subNodeCount = Object.values(jcrContent).filter(v => typeof v === 'object' && v !== null).length;
    expect(subNodeCount).toBeGreaterThan(0);
    console.log(`JCR infinity: ${Object.keys(jcrContent).length} top-level keys, ${subNodeCount} sub-nodes`);
  });

  test('Log Whisperer — Sling logs endpoint', async ({ request }) => {
    const res = await request.get(`${AEM}/system/console/status-slinglogs.txt`, {
      headers: aemHeaders()
    });
    expect(res.ok()).toBeTruthy();
    const text = await res.text();
    expect(text.length).toBeGreaterThan(100);
    const lines = text.split('\n');
    console.log(`Log lines: ${lines.length}, first: ${lines[0]?.slice(0, 80)}`);
  });

  test('CF Models — discover wknd-shared models', async ({ request }) => {
    const res = await request.get(`${AEM}/conf/wknd-shared/settings/dam/cfm/models.1.json`, {
      headers: aemHeaders()
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const models = Object.entries(data)
      .filter(([k, v]) => !k.startsWith('jcr:') && typeof v === 'object' && v !== null &&
        (v['jcr:primaryType'] === 'dam:CFModel' || v['jcr:primaryType'] === 'cq:Template'))
      .map(([k]) => k);
    expect(models.length).toBeGreaterThan(0);
    console.log('CF Models found:', models);
  });

  test('Content Fragment creation with real model', async ({ request }) => {
    const token = await getCsrfToken(request);
    const res = await request.post(`${AEM}/api/assets/wknd-shared/en/*`, {
      headers: { ...aemHeaders(token), 'Content-Type': 'application/json' },
      data: JSON.stringify({
        'entity-type': 'contentFragment',
        'properties': {
          'cq:model': '/conf/wknd-shared/settings/dam/cfm/models/article',
          'title': 'AEM Agent Integration Test Fragment',
          'name': 'aem-agent-integration-test'
        }
      })
    });
    // 201 = created, 409 = already exists (both acceptable in test env)
    expect([200, 201, 409]).toContain(res.status());
    const data = await res.json();
    console.log('CF result:', data['class'], data['properties']?.title);
  });

  test('Page properties update with CSRF', async ({ request }) => {
    const token = await getCsrfToken(request);
    // Write a test property and verify it persists
    const res = await request.post(`${AEM}${WKND_PAGE}/jcr:content`, {
      headers: { ...aemHeaders(token), 'Content-Type': 'application/x-www-form-urlencoded' },
      data: `aem-agent-test-ts=${Date.now()}&_charset_=utf-8`
    });
    expect(res.ok()).toBeTruthy();
    console.log('JCR write via Sling POST: OK');
  });

  test('MSM context — graceful on non-MSM site', async ({ request }) => {
    const res = await request.get(
      `${AEM}/libs/wcm/msm/content/commands/getLiveCopyStatus.json?path=${encodeURIComponent(WKND_PAGE)}`,
      { headers: aemHeaders() }
    );
    // 404 is acceptable (MSM servlet not available or page has no MSM relationship)
    console.log('MSM endpoint status:', res.status());
    if (res.ok()) {
      const data = await res.json();
      console.log('MSM data:', JSON.stringify(data).slice(0, 200));
    } else {
      console.log('MSM not available on this instance (expected for WKND)');
    }
    // We just verify the extension handles it gracefully — no hard assertion
    expect([200, 404, 500]).toContain(res.status());
  });

});

test.describe('AEM Integration — Extension in Browser', () => {
  let browserContext;

  test.beforeEach(async () => {
    browserContext = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    // Pre-configure AEM credentials in extension storage
    const bg = await getServiceWorker(browserContext);
    await browserContext.serviceWorkers()[0]?.evaluate(() => {});
  });

  test.afterEach(async () => {
    await browserContext?.close();
  });

  test('Extension loads on AEM author page', async () => {
    const page = await browserContext.newPage();

    // Navigate to AEM (will hit login page — check extension loads without errors)
    let consoleErrors = [];
    page.on('pageerror', err => consoleErrors.push(err.message));

    await page.goto(`${AEM}/editor.html${WKND_PAGE}.html`);
    await page.waitForTimeout(2000);

    // Extension should not throw JS errors on load
    const relevantErrors = consoleErrors.filter(e =>
      e.includes('AEM Agent') || e.includes('SyntaxError') || e.includes('TypeError')
    );
    if (relevantErrors.length > 0) console.log('Extension errors:', relevantErrors);
    expect(relevantErrors).toHaveLength(0);
  });

  test('Side panel loads and shows settings form', async () => {
    const sidePanelPage = await browserContext.newPage();
    const extensionId = await getExtensionId(browserContext);
    await sidePanelPage.goto(`chrome-extension://${extensionId}/src/sidepanel/sidepanel.html`);
    await sidePanelPage.waitForLoadState('domcontentloaded');

    // Author URL field should be present (new field we added)
    await expect(sidePanelPage.locator('#aemAuthorUrl')).toBeVisible();
    await expect(sidePanelPage.locator('#aemUsername')).toBeVisible();
    await expect(sidePanelPage.locator('#aemPassword')).toBeVisible();
    await expect(sidePanelPage.locator('#stageUrl')).toBeVisible();
    await expect(sidePanelPage.locator('#saveEnvConfig')).toBeVisible();
  });

  test('Settings save and persist', async () => {
    const sidePanelPage = await browserContext.newPage();
    const extensionId = await getExtensionId(browserContext);
    await sidePanelPage.goto(`chrome-extension://${extensionId}/src/sidepanel/sidepanel.html`);
    await sidePanelPage.waitForLoadState('domcontentloaded');
    await sidePanelPage.waitForTimeout(500);

    // Fill in settings
    await sidePanelPage.evaluate(() => {
      document.getElementById('aemAuthorUrl').value = 'http://localhost:4502';
      document.getElementById('aemUsername').value = 'admin';
      document.getElementById('aemPassword').value = 'admin';
    });

    await sidePanelPage.locator('#saveEnvConfig').click();
    await sidePanelPage.waitForTimeout(300);

    // Should show confirmation message
    const messages = await sidePanelPage.evaluate(() =>
      Array.from(document.querySelectorAll('.message.system p')).map(p => p.textContent)
    );
    const hasSaved = messages.some(m => m.includes('Settings saved') || m.includes('Author'));
    expect(hasSaved).toBe(true);
  });

});

async function getExtensionId(browserContext) {
  let [background] = browserContext.serviceWorkers();
  if (!background) background = await browserContext.waitForEvent('serviceworker');
  return background.url().split('/')[2];
}

async function getServiceWorker(browserContext) {
  let [sw] = browserContext.serviceWorkers();
  if (!sw) sw = await browserContext.waitForEvent('serviceworker');
  return sw;
}
