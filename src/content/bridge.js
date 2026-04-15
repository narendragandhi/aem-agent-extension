/**
 * AEM Agent Main World Bridge
 * Executes in the page's JS context to access window.Granite
 */
(function() {
  console.log('AEM Agent: MAIN World Bridge loading...');

  function extractContext() {
    // 1. Path Seek
    const path = window.Granite?.author?.ContentFrame?.contentPath || 
                 window.Granite?.author?.pageInfo?.path ||
                 document.querySelector('meta[name="user.path"]')?.content ||
                 window.location.pathname.replace('/editor.html', '').replace('.html', '');

    // 2. Template Seek
    const template = window.Granite?.author?.pageInfo?.template ||
                     window.Granite?.author?.pageTemplate ||
                     document.querySelector('meta[name="template"]')?.content ||
                     'unknown';

    // 3. Resource Type Seek (Page Level)
    const resourceType = document.querySelector('body')?.getAttribute('data-resource-type') ||
                         document.querySelector('[data-sling-resource-type]')?.getAttribute('data-sling-resource-type') ||
                         document.querySelector('meta[name="resourceType"]')?.content ||
                         'unknown';

    const context = {
      path: path,
      template: template,
      resourceType: resourceType,
      site: path.split('/')[2] || 'unknown',
      locked: !!document.querySelector('.cq-siteadmin-admin-childpages.is-locked'),
      workflowStatus: document.querySelector('.cq-siteadmin-admin-childpages-status')?.textContent?.trim() || 'none',
      pageTitle: document.title
    };
    
    console.log('AEM Agent: Extracted robust context', context);
    return context;
  }

  // Listen for requests from ISOLATED world
  window.addEventListener('AEM_AGENT_REQUEST_CONTEXT', () => {
    console.log('AEM Agent: Received REQUEST_CONTEXT from ISOLATED world');
    const context = extractContext();
    window.dispatchEvent(new CustomEvent('AEM_AGENT_CONTEXT_RESPONSE', { detail: context }));
  });

  // Register WebMCP Tools (MCP Compliant Semantic Bridge)
  if (window.navigator.modelContext) {
    console.log('AEM Agent: Registering tools with window.navigator.modelContext');
    // ... same tools ...
    window.navigator.modelContext.registerTool('get_page_dom', {
      name: 'get_page_dom',
      description: 'Gets the current AEM page DOM structure for analysis',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector to narrow down the DOM extraction' }
        }
      },
      execute: (args) => {
        if (args?.selector) {
          return document.querySelector(args.selector)?.innerHTML || 'Selector not found';
        }
        return document.body.innerHTML;
      }
    });

    window.navigator.modelContext.registerTool('execute_aem_api', {
      name: 'execute_aem_api',
      description: 'Executes a direct AEM API call (GET/POST) via the authenticated browser session',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The JCR path or API endpoint' },
          method: { type: 'string', enum: ['GET', 'POST'], default: 'GET' }
        },
        required: ['path']
      },
      execute: async (args) => {
        // Security: only relative JCR paths allowed — blocks BSRF to external URLs
        if (!args.path || !args.path.startsWith('/')) {
          throw new Error('execute_aem_api: path must be a relative JCR path starting with /');
        }
        const res = await fetch(args.path, { method: args.method || 'GET', credentials: 'include' });
        return await res.json();
      }
    });
  }

  console.log('AEM Agent: MAIN World Bridge initialized.');
})();
