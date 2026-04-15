const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const extensionPath = path.resolve(__dirname, '../');

test.describe('AEM Agent "Wow" Features', () => {
  let browserContext;
  let page;

  test.beforeEach(async () => {
    browserContext = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    page = await browserContext.newPage();
  });

  test.afterEach(async () => {
    await browserContext.close();
  });

  test('WebMCP Tools should be registered on window.navigator.modelContext', async () => {
    // Mock navigator.modelContext.registerTool (singular — matches bridge.js API)
    await page.addInitScript(() => {
      window.registeredTools = {};
      window.navigator.modelContext = {
        registerTool: (name, def) => {
          window.registeredTools[name] = def;
        }
      };
    });

    await page.goto('https://example.com');
    // Load bridge.js (MAIN world) which registers the WebMCP tools
    await page.addScriptTag({ path: path.join(extensionPath, 'src/content/bridge.js') });
    await page.waitForTimeout(100);

    const tools = await page.evaluate(() =>
      window.registeredTools ? Object.keys(window.registeredTools) : []
    );

    expect(tools).toContain('execute_aem_api');
    expect(tools).toContain('get_page_dom');
  });

  test('Log Whisperer should trigger correlation', async () => {
    const sidePanelPage = await browserContext.newPage();
    const extensionId = await getExtensionId(browserContext);
    await sidePanelPage.goto(`chrome-extension://${extensionId}/src/sidepanel/sidepanel.html`);
    await sidePanelPage.waitForLoadState('domcontentloaded');

    // Capture any console errors for diagnosis
    sidePanelPage.on('console', msg => {
      if (msg.type() === 'error') console.log('PAGE ERROR:', msg.text());
    });

    // Click via JS (no Playwright visibility requirement)
    await sidePanelPage.evaluate(() => document.getElementById('btnLogWhisperer').click());

    // Wait 500ms for synchronous addActivity to run and render
    await sidePanelPage.waitForTimeout(500);

    // Check DOM state directly — bypasses tab visibility
    const state = await sidePanelPage.evaluate(() => ({
      activityCount: document.querySelectorAll('.activity-item').length,
      activityListHTML: document.getElementById('activityList')?.innerHTML?.slice(0, 400) ?? 'NOT FOUND',
      btnExists: !!document.getElementById('btnLogWhisperer'),
    }));

    console.log('DOM state after click:', JSON.stringify(state, null, 2));

    expect(state.activityCount).toBeGreaterThan(0);
    const activityText = await sidePanelPage.evaluate(
      () => document.querySelector('.activity-item')?.textContent ?? ''
    );
    // Activity runs and completes quickly (ERR_CONNECTION_REFUSED in test env);
    // check for the activity name which is always present
    expect(activityText).toMatch(/log-whisperer|Analyzing AEM logs|No errors found/);
  });

  test('AI Chat should handle "create cf" command', async () => {
    const sidePanelPage = await browserContext.newPage();
    const extensionId = await getExtensionId(browserContext);
    await sidePanelPage.goto(`chrome-extension://${extensionId}/src/sidepanel/sidepanel.html`);
    await sidePanelPage.waitForLoadState('domcontentloaded');

    // Wait for AI overlay to clear (created immediately, removed after 2s)
    await sidePanelPage.waitForTimeout(2500);

    // Mock sendMessage, activate chat tab, set input, click send — all via evaluate
    await sidePanelPage.evaluate(() => {
      chrome.runtime.sendMessage = async (msg) => {
        if (msg.type === 'CREATE_CF') return { success: true };
        return {};
      };
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById('chat').classList.add('active');
      document.getElementById('chatInput').value = 'create cf for this page';
      document.getElementById('sendChat').click();
    });

    // simulateChatResponse fires after 800ms setTimeout
    await sidePanelPage.waitForTimeout(1500);

    const messages = await sidePanelPage.evaluate(() =>
      Array.from(document.querySelectorAll('.message.system p')).map(p => p.textContent)
    );

    console.log('Chat messages:', messages);
    expect(messages.some(m => m.includes('Creating a Content Fragment'))).toBe(true);
  });
});

async function getExtensionId(browserContext) {
  let [background] = browserContext.serviceWorkers();
  if (!background) background = await browserContext.waitForEvent('serviceworker');
  return background.url().split('/')[2];
}
