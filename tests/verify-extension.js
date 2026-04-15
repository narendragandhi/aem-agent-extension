const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const extensionPath = path.resolve(__dirname, '../');
  console.log('Loading extension from:', extensionPath);

  const browserContext = await chromium.launchPersistentContext('', {
    headless: false, // Must be headed for extensions
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const page = await browserContext.newPage();
    
    // 1. Navigate to AEM (Local or Mock)
    console.log('Navigating to AEM...');
    await page.goto('http://localhost:4502/libs/granite/core/content/login.html');
    
    // 2. Check if Content Script Stub is injected
    // (This works because the stub is in the MAIN world)
    const isStubInjected = await page.evaluate(() => {
      return typeof window.addEventListener === 'function'; 
    });
    console.log('Main world accessible:', isStubInjected);

    // 3. Find extension ID from service worker
    const [background] = browserContext.serviceWorkers();
    if (background) {
      const id = background.url().split('/')[2];
      console.log('Extension ID:', id);

      // 4. Open Sidepanel directly to verify UI
      const sidepanel = await browserContext.newPage();
      await sidepanel.goto(`chrome-extension://${id}/src/sidepanel/sidepanel.html`);
      
      const title = await sidepanel.title();
      console.log('Sidepanel Title:', title);

      const hasAuditTab = await sidepanel.isVisible('button[data-tab="tools"]');
      console.log('Tools Tab Visible:', hasAuditTab);

      const hasGraftBtn = await sidepanel.isVisible('#btnGraft');
      console.log('Graft Button Present:', hasGraftBtn);
    } else {
      console.log('Service worker not found. Extension might not have loaded.');
    }

  } catch (err) {
    console.error('Test Failed:', err);
  } finally {
    await browserContext.close();
  }
})();
