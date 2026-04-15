(function() {
  const CXFORGE_URL = 'http://localhost:10004';
  const AEM_AUTHOR_URL = 'http://localhost:4502';

  async function init() {
    await loadPageContext();
    setupActions();
    checkConnections();
  }

  async function loadPageContext() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      
      if (tab.url && (tab.url.includes('localhost:4502') || tab.url.includes('localhost:4503'))) {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTEXT' });
        if (response) {
          updatePageInfo(response);
        } else {
          document.getElementById('pagePath').textContent = extractPathFromUrl(tab.url);
        }
      } else {
        document.getElementById('pagePath').textContent = 'Not on AEM page';
        document.getElementById('pageMeta').textContent = '';
      }
    } catch (e) {
      document.getElementById('pagePath').textContent = 'AEM page not detected';
    }
  }

  function extractPathFromUrl(url) {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.replace(/\.html$/, '');
      return path || '/';
    } catch {
      return '-';
    }
  }

  function updatePageInfo(info) {
    document.getElementById('pagePath').textContent = info.path || '-';
    
    const meta = [];
    if (info.template) meta.push(`Template: ${info.template.split('/').pop()}`);
    if (info.site) meta.push(`Site: ${info.site}`);
    if (info.workflowStatus && info.workflowStatus !== 'none') meta.push(`Workflow: ${info.workflowStatus}`);
    
    document.getElementById('pageMeta').textContent = meta.join(' | ');
  }

  function setupActions() {
    document.getElementById('openSidePanel').addEventListener('click', () => {
      chrome.sidePanel.open();
    });

    document.getElementById('openCxforge').addEventListener('click', () => {
      chrome.tabs.create({ url: CXFORGE_URL });
    });

    document.getElementById('refreshContext').addEventListener('click', async () => {
      await loadPageContext();
    });

    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const toolId = btn.dataset.tool;
        openToolInPanel(toolId);
      });
    });
  }

  async function openToolInPanel(toolId) {
    await chrome.storage.local.set({ pendingToolId: toolId });
    await chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
  }

  async function checkConnections() {
    const status = document.getElementById('status');
    
    try {
      const res = await fetch(`${CXFORGE_URL}/actuator/health`, { 
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        status.textContent = 'CXForge Connected';
        status.className = 'status online';
      } else {
        throw new Error('Not OK');
      }
    } catch (e) {
      status.textContent = 'CXForge Offline';
      status.className = 'status offline';
    }
  }

  init();
})();