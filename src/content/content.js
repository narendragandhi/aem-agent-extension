/**
 * AEM Agent Content Script
 * Hardened Architecture: Isolated Agent
 * (Bridge logic moved to src/content/bridge.js via manifest.json)
 */

function initIsolatedAgent() {
  console.log('AEM Agent: ISOLATED Agent initialized.');

  // Request context from MAIN world via Bridge
  window.addEventListener('AEM_AGENT_CONTEXT_RESPONSE', (event) => {
    const context = event.detail;
    console.log('AEM Agent: Received CONTEXT_RESPONSE from MAIN world:', context);
    chrome.runtime.sendMessage({
      type: 'AEM_PAGE_CONTEXT',
      payload: context
    });
  });

  // Listen for background requests — validate sender is this extension
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return; // ignore messages from other extensions
    console.log('AEM Agent: ISOLATED Agent received background message:', message.type);
    if (message.type === 'GET_DOM') {
      sendResponse({ dom: document.body.innerHTML });
    }
    return true;
  });

  // Periodically request context (AEM Editor changes frequently without reload)
  setInterval(() => {
    // console.log('AEM Agent: Periodically requesting context from MAIN world...');
    window.dispatchEvent(new CustomEvent('AEM_AGENT_REQUEST_CONTEXT'));
  }, 3000);

  // Initial trigger
  window.dispatchEvent(new CustomEvent('AEM_AGENT_REQUEST_CONTEXT'));
}

// Expose context accessor for testability (reads DOM directly, no chrome APIs needed)
window.AEM_AGENT = {
  getContext: () => ({
    resourceType: document.querySelector('html')?.getAttribute('data-resource-type') ||
                  document.querySelector('body')?.getAttribute('data-resource-type') ||
                  document.querySelector('[data-sling-resource-type]')?.getAttribute('data-sling-resource-type') ||
                  'unknown',
    template: document.querySelector('[data-cq-template-path]')?.getAttribute('data-cq-template-path') ||
              document.querySelector('meta[name="template"]')?.content ||
              'unknown',
    workflowStatus: document.querySelector('.workflow-badge')?.getAttribute('data-workflow-status') || 'none',
    language: document.documentElement.lang || 'unknown'
  })
};

// Start the isolated agent (requires chrome extension context)
try {
  initIsolatedAgent();
} catch (e) {
  // Not in extension context — testability mode only
}
