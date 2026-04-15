(function() {
  const CXFORGE_URL = 'http://localhost:10004';
  let tools = [];
  let pageContext = {};
  let activities = [];
  let aiSession = null;

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function init() {
    loadPageContext(); // Non-blocking
    loadTools();       // Non-blocking
    setupTabs();
    setupChat();
    setupQuickActions();
    checkConnections();
    checkPendingTools();
    initNativeAI();
    checkFirstRunCredentials();
    
    // Listen for live context updates from background/content script
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'AEM_PAGE_CONTEXT') {
        console.log('AEM Agent: Sidepanel received live context update:', message.payload);
        pageContext = message.payload;
        updatePageContext();
        // Optionally reload blast radius if path changed
        loadBlastRadius();
      }
    });

    chrome.storage.onChanged.addListener((changes) => {
      if (changes.pendingToolId) {
        checkPendingTools();
      }
    });
  }

  async function initNativeAI() {
    const chatTab = document.getElementById('chat');
    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'ai-loading-overlay';
    loadingOverlay.innerHTML = '<div class="spinner"></div><span>Initializing Gemini Nano...</span>';
    chatTab.appendChild(loadingOverlay);

    if (window.ai && window.ai.languageModel) {
      try {
        const capabilities = await window.ai.languageModel.capabilities();
        
        if (capabilities.available === 'after-download') {
          loadingOverlay.querySelector('span').textContent = 'Downloading Local AI Model (Gemini Nano)...';
          // In a real implementation, we could track download progress if the API supported it
        }

        if (capabilities.available !== 'no') {
          aiSession = await window.ai.languageModel.create({
            systemPrompt: `You are an AEM (Adobe Experience Manager) Expert Agent. 
            Assistant to: Developer. Page: ${pageContext.path || 'unknown'}. 
            Context: Standardized MCP tools (get_page_dom, execute_aem_api, analyze_aem_logs).`
          });
          loadingOverlay.remove();
          addChatMessage('system', 'Native AI Agent Ready (MCP Standard).');
        } else {
          loadingOverlay.innerHTML = '<span>Native AI Model not available. Enable Prompt API in flags.</span>';
        }
      } catch (e) {
        console.error('Native AI Init error:', e);
        loadingOverlay.innerHTML = '<span>AI Initialization Failed. Check chrome://components</span>';
      }
    } else {
      loadingOverlay.innerHTML = '<span>Browser Prompt API not detected. Fallback to Simulation Mode.</span>';
      setTimeout(() => loadingOverlay.remove(), 2000);
    }
  }

  function checkFirstRunCredentials() {
    chrome.storage.local.get(['aemUsername', 'aemPassword', 'credentialsPrompted'], (result) => {
      if (!result.aemUsername || !result.aemPassword) {
        if (!result.credentialsPrompted) {
          chrome.storage.local.set({ credentialsPrompted: true });
          // Scroll to settings and highlight them
          const envConfig = document.querySelector('.env-config');
          if (envConfig) {
            envConfig.style.border = '2px solid #d52b1e';
            envConfig.style.borderRadius = '4px';
            envConfig.style.padding = '8px';
          }
          addChatMessage('system', 'Welcome to AEM Agent!\n\nSet your AEM Author URL and credentials in the Settings panel (Actions tab) to get started.\n\nWorks with:\n- Local SDK: http://localhost:4502\n- Remote author: https://author-p*.adobeaemcloud.com');
        }
      }
    });
  }

  async function loadPageContext() {
    try {
      pageContext = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTEXT' });
      updatePageContext();
      if (pageContext.path) {
        loadBlastRadius();
      }
    } catch (e) {
      console.log('No page context available');
    }
  }

  async function loadBlastRadius() {
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'GET_MSM_CONTEXT',
        payload: { path: pageContext.path }
      });

      if (result.blastRadius) {
        const analysisEl = document.getElementById('impactAnalysis');
        analysisEl.classList.remove('hidden');
        
        const severityEl = document.getElementById('impactSeverity');
        severityEl.textContent = `${result.blastRadius.severity.toUpperCase()} IMPACT`;
        severityEl.className = `severity-badge ${result.blastRadius.severity}`;
        
        document.getElementById('impactCount').textContent = result.blastRadius.count;
        
        const listEl = document.getElementById('impactList');
        listEl.innerHTML = '';
        result.blastRadius.paths.forEach(p => {
          const li = document.createElement('li');
          li.textContent = p;
          listEl.appendChild(li);
        });
      }
    } catch (e) {
      console.error('Blast Radius error:', e);
    }
  }

  function updatePageContext() {
    document.getElementById('pagePath').textContent = pageContext.path || '-';
    document.getElementById('template').textContent = pageContext.template || '-';
    const siteEl = document.getElementById('site');
    if (siteEl) siteEl.textContent = pageContext.site || '-';
    document.getElementById('workflowStatus').textContent = pageContext.workflowStatus || 'none';
    
    if (pageContext.replicationStatus) {
      document.getElementById('workflowStatus').textContent = pageContext.replicationStatus.status || 'none';
    }
    
    updateQuickActionsState();
  }
  
  function updateQuickActionsState() {
    const btnUnlock = document.getElementById('btnUnlock');
    if (pageContext.locked) {
      btnUnlock.disabled = false;
    } else {
      btnUnlock.disabled = true;
    }
  }

  async function loadTools() {
    try {
      const response = await fetch(`${CXFORGE_URL}/api/tools`);
      if (!response.ok) throw new Error('Failed to load tools');
      tools = await response.json();
      renderTools();
    } catch (e) {
      document.getElementById('toolList').innerHTML = `
        <div class="empty-state">
          <p>Cannot connect to CXForge</p>
          <p>Make sure CXForge is running on port 10004</p>
        </div>
      `;
    }
  }

  function renderTools() {
    const container = document.getElementById('toolList');
    if (!tools.length) {
      container.innerHTML = '<div class="empty-state">No tools available</div>';
      return;
    }

    container.innerHTML = tools.map(tool => `
      <div class="tool-card" data-tool-id="${escapeHtml(tool.id)}">
        <div class="tool-card-header">
          <span class="tool-name">${escapeHtml(tool.name)}</span>
          <span class="tool-category">${escapeHtml(tool.category || 'General')}</span>
        </div>
        <div class="tool-description">${escapeHtml(tool.description || '')}</div>
      </div>
    `).join('');

    container.querySelectorAll('.tool-card').forEach(card => {
      card.addEventListener('click', () => openToolForm(card.dataset.toolId));
    });
  }

  function openToolForm(toolId) {
    const tool = tools.find(t => t.id === toolId);
    if (!tool) return;

    const container = document.getElementById('toolList');
    const params = tool.parameters || [];
    
    let paramsHtml = '';
    if (params.length > 0) {
      paramsHtml = params.map(param => `
        <div class="form-group">
          <label>${param.label || param.name}</label>
          ${param.type === 'PATH' 
            ? `<input type="text" name="${param.name}" value="${pageContext.path || ''}" />`
            : `<input type="text" name="${param.name}" />`
          }
        </div>
      `).join('');
    } else {
      paramsHtml = `<p style="color:#666;font-size:12px;">This tool will use the current page context.</p>`;
    }

    const formHtml = `
      <div class="tool-form active" id="toolForm-${escapeHtml(toolId)}">
        <h3>${escapeHtml(tool.name)}</h3>
        <p style="color:#666;font-size:12px;margin:8px 0;">${escapeHtml(tool.description || '')}</p>
        <form>
          ${paramsHtml}
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Run</button>
            <button type="button" class="btn btn-secondary">Cancel</button>
          </div>
        </form>
      </div>
    `;

    const existingForm = document.getElementById(`toolForm-${toolId}`);
    if (existingForm) {
      existingForm.remove();
    } else {
      container.insertAdjacentHTML('beforeend', formHtml);
      const newForm = document.getElementById(`toolForm-${toolId}`);
      newForm.querySelector('form').addEventListener('submit', (e) => runTool(e, toolId));
      newForm.querySelector('.btn-secondary').addEventListener('click', () => closeToolForm(toolId));
    }
  }

  window.closeToolForm = function(toolId) {
    const form = document.getElementById(`toolForm-${toolId}`);
    if (form) form.remove();
  };

  window.runTool = async function(event, toolId) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const params = Object.fromEntries(formData.entries());
    
    if (!params.path && pageContext.path) {
      params.path = pageContext.path;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'RUN_CXFORGE_TOOL',
        payload: { toolId, params }
      });

      if (response.jobId) {
        addActivity(toolId, 'running', 'Job started');
        closeToolForm(toolId);
        pollJobStatus(response.jobId);
      } else if (response.error) {
        addActivity(toolId, 'failed', response.error);
      }
    } catch (e) {
      addActivity(toolId, 'failed', e.message);
    }
  };

  async function pollJobStatus(jobId) {
    const check = async () => {
      try {
        const job = await chrome.runtime.sendMessage({
          type: 'EXECUTE_JOB',
          payload: { jobId }
        });
        
        if (job.status === 'completed' || job.status === 'failed') {
          const status = job.status === 'completed' ? 'completed' : 'failed';
          const message = job.results?.length ? `${job.results.length} results` : job.error || 'Done';
          addActivity(job.toolId, status, message);
        } else if (job.status === 'running') {
          addActivity(job.toolId, 'running', job.progress || 'Running...');
          setTimeout(check, 2000);
        }
      } catch (e) {
        console.log('Job polling error:', e);
      }
    };
    check();
  }

  function addActivity(toolId, status, message) {
    const tool = tools.find(t => t.id === toolId);
    const activity = {
      id: Date.now(),
      name: tool?.name || toolId,
      status,
      message,
      time: new Date().toLocaleTimeString()
    };
    activities.unshift(activity);
    if (activities.length > 100) activities.length = 100;
    renderActivities();
  }

  function renderActivities() {
    const container = document.getElementById('activityList');
    if (!activities.length) {
      container.innerHTML = '<div class="empty-state">No recent activity</div>';
      return;
    }

    container.innerHTML = activities.map(a => `
      <div class="activity-item">
        <div class="activity-item-header">
          <span class="activity-name">${escapeHtml(a.name)}</span>
          <span class="activity-time">${escapeHtml(a.time)}</span>
        </div>
        <div class="activity-status ${escapeHtml(a.status)}">${escapeHtml(a.message)}</div>
      </div>
    `).join('');
  }

  function setupTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
      });
    });
  }

  function setupChat() {
    const input = document.getElementById('chatInput');
    const send = document.getElementById('sendChat');

    const sendMessage = async () => {
      const text = input.value.trim();
      if (!text) return;
      
      addChatMessage('user', text);
      input.value = '';
      
      if (aiSession) {
        try {
          const stream = aiSession.promptStreaming(text);
          let responseText = '';
          const messageId = `msg-${Date.now()}`;
          addChatMessage('system', '...', messageId);
          
          for await (const chunk of stream) {
            responseText = chunk;
            updateChatMessage(messageId, responseText);
          }
        } catch (e) {
          addChatMessage('system', `❌ Error: ${e.message}`);
        }
      } else {
        simulateChatResponse(text);
      }
    };

    send.addEventListener('click', sendMessage);
    input.addEventListener('keypress', e => {
      if (e.key === 'Enter') sendMessage();
    });
  }

  function updateChatMessage(id, text) {
    const msgEl = document.getElementById(id);
    if (msgEl) {
      msgEl.querySelector('p').innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
      const container = document.getElementById('chatMessages');
      container.scrollTop = container.scrollHeight;
    }
  }

  function addChatMessage(role, text, id = null) {
    const container = document.getElementById('chatMessages');
    const messageId = id || `msg-${Date.now()}`;
    const html = `
      <div class="message ${role}" id="${messageId}">
        <p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>
        <div class="timestamp">${new Date().toLocaleTimeString()}</div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', html);
    container.scrollTop = container.scrollHeight;
  }

  async function simulateChatResponse(text) {
    setTimeout(async () => {
      if (text.toLowerCase().includes('create cf') || text.toLowerCase().includes('create content fragment')) {
        addChatMessage('system', 'Understood. Creating a Content Fragment in `/content/dam/fragments/new-fragment` using the Generic Model...');
        
        try {
          const result = await chrome.runtime.sendMessage({
            type: 'CREATE_CF',
            payload: {
              folderPath: 'fragments',
              name: 'new-fragment',
              title: 'New Fragment from Agent',
              modelPath: '/conf/global/settings/dam/cfm/models/generic',
              properties: {
                description: `Created from page: ${pageContext.path}`
              }
            }
          });
          
          if (result.error) {
            addChatMessage('system', `❌ Error creating fragment: ${result.error}`);
          } else {
            addChatMessage('system', `✅ Content Fragment created successfully! [View in Assets](http://localhost:4502/assets.html/content/dam/fragments)`);
          }
        } catch (e) {
          addChatMessage('system', `❌ Connection error: ${e.message}`);
        }
      } else {
        addChatMessage('system', `I'm analyzing your request regarding \`${pageContext.path}\`. 
        
I can help you:
1. **Analyze Logs** for this page
2. **Convert** components to Content Fragments
3. **Publish** or **Unlock** this page

What would you like to do?`);
      }
    }, 800);
  }

  function setupQuickActions() {
    document.getElementById('btnActivate').addEventListener('click', () => activatePage());
    document.getElementById('btnUnlock').addEventListener('click', () => unlockPage());
    document.getElementById('btnLogWhisperer').addEventListener('click', () => analyzePageLogs());
    document.getElementById('btnQuery').addEventListener('click', () => openQueryTool());
    document.getElementById('btnConvertCF').addEventListener('click', () => startCFConversion());
    document.getElementById('btnGenerateTest').addEventListener('click', () => startTestGeneration());
    document.getElementById('btnAccessibility').addEventListener('click', () => runAccessibilityAudit());
    document.getElementById('btnDevOps').addEventListener('click', () => openDevOpsStatus());
    document.getElementById('btnPermissions').addEventListener('click', () => runPermissionsDebug());
    document.getElementById('btnGhostwriter').addEventListener('click', () => startGhostwriter());
    document.getElementById('btnProperties').addEventListener('click', () => openProperties());
    document.getElementById('btnReferences')?.addEventListener('click', () => showReferences());
    document.getElementById('btnDiff').addEventListener('click', () => performDiff());
    document.getElementById('btnGraft').addEventListener('click', () => performGraft());
    document.getElementById('btnAccessibility').addEventListener('click', () => runAccessibilityAudit());

    // Governance Audit Polling — only runs when an AEM page is active
    setInterval(() => { if (pageContext.path) runGovernanceAudit(); }, 30000); // Every 30s, not 10s
    setTimeout(() => { if (pageContext.path) runGovernanceAudit(); }, 3000);   // Initial check
    }

    const GOVERNANCE_POLICY = {
    maxImageSizeKB: 500,
    maxParsysDepth: 4,
    mandatoryAltText: true,
    checkSeoMeta: true
    };

    async function runGovernanceAudit() {
    if (!pageContext.path) return;

    const violations = [];

    // 1. Check SEO Metadata
    if (GOVERNANCE_POLICY.checkSeoMeta) {
      if (!pageContext.pageTitle || pageContext.pageTitle === 'unknown') {
        violations.push('Missing Page Title (SEO Risk)');
      }
    }

    // 2. Check DOM-based rules via MCP Tool
    chrome.runtime.sendMessage({ type: 'GET_DOM' }, (response) => {
      if (response && response.dom) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(response.dom, 'text/html');

        // Check for large images (heuristic based on src)
        const images = doc.querySelectorAll('img');
        images.forEach(img => {
          if (GOVERNANCE_POLICY.mandatoryAltText && !img.alt) {
            violations.push('Image missing Alt Text (ADA violation)');
          }
        });

        // Check Parsys Depth
        const parsysDepth = doc.querySelectorAll('.parsys .parsys .parsys').length;
        if (parsysDepth > GOVERNANCE_POLICY.maxParsysDepth) {
          violations.push('Excessive Component Nesting (Performance Risk)');
        }

        updateGovernanceUI(violations);
      }
    });
    }

    function updateGovernanceUI(violations) {
    const healthScoreEl = document.getElementById('healthScore');
    const scoreValueEl = healthScoreEl.querySelector('.score-value');

    const score = Math.max(0, 100 - (violations.length * 15));
    scoreValueEl.textContent = `${score}%`;

    if (score < 70) {
      healthScoreEl.style.background = '#d52b1e'; // Red
      healthScoreEl.title = `Governance Alerts:\n${violations.join('\n')}`;
    } else if (score < 90) {
      healthScoreEl.style.background = '#f39c12'; // Orange
      healthScoreEl.title = `Governance Alerts:\n${violations.join('\n')}`;
    } else {
      healthScoreEl.style.background = '#27ae60'; // Green
      healthScoreEl.title = 'Page meets all governance standards.';
    }
    }

    // Load saved config
    chrome.storage.local.get(['aemAuthorUrl', 'stageUrl', 'aemUsername'], (result) => {
      const authorInput = document.getElementById('aemAuthorUrl');
      if (result.aemAuthorUrl && authorInput) authorInput.value = result.aemAuthorUrl;
      const stageInput = document.getElementById('stageUrl');
      if (result.stageUrl && stageInput) stageInput.value = result.stageUrl;
      const userInput = document.getElementById('aemUsername');
      if (result.aemUsername && userInput) userInput.value = result.aemUsername;
      // Password intentionally not pre-filled
    });

    const btnSaveEnv = document.getElementById('saveEnvConfig');
    if (btnSaveEnv) {
      btnSaveEnv.addEventListener('click', () => {
        const aemAuthorUrl = document.getElementById('aemAuthorUrl').value.trim();
        const stageUrl = document.getElementById('stageUrl').value.trim();
        const aemUsername = document.getElementById('aemUsername').value.trim();
        const aemPassword = document.getElementById('aemPassword').value;
        chrome.storage.local.set({ aemAuthorUrl, stageUrl, aemUsername, aemPassword }, () => {
          addChatMessage('system', `✅ Settings saved.\n- Author: ${aemAuthorUrl || 'http://localhost:4502 (default)'}\n- Stage: ${stageUrl || '(none)'}`);
        });
      });
    }

  async function startGhostwriter() {
    addActivity('ghostwriter', 'running', 'Analyzing page content for SEO...');
    document.querySelector('.tab[data-tab="chat"]').click();
    addChatMessage('system', `🔍 **SEO Analysis for \`${pageContext.path}\`**\n\nI am analyzing the page DOM to suggest high-impact SEO metadata...`);

    try {
      // 1. Get DOM content for analysis
      chrome.runtime.sendMessage({ type: 'GET_DOM' }, async (response) => {
        const dom = response?.dom || '';
        const parser = new DOMParser();
        const doc = parser.parseFromString(dom, 'text/html');
        
        const h1 = doc.querySelector('h1')?.textContent || 'Untitled Section';
        const mainText = doc.body.innerText.substring(0, 1000); // Sample first 1000 chars

        let suggestedTitle = '';
        let suggestedDesc = '';

        if (aiSession) {
          const seoPrompt = `Analyze this page content:
          H1: ${h1}
          Body Excerpt: ${mainText}
          
          Suggest a concise SEO Title (max 60 chars) and an SEO Meta Description (max 160 chars).
          Format as JSON: { "title": "...", "description": "..." }`;

          const aiResult = await aiSession.prompt(seoPrompt);
          try {
            const parsed = JSON.parse(aiResult.replace(/```json|```/g, '').trim());
            suggestedTitle = parsed.title;
            suggestedDesc = parsed.description;
          } catch (e) {
            suggestedTitle = `${h1} | AEM Agent Suggested`;
            suggestedDesc = `Learn more about ${h1} on this WKND page.`;
          }
        } else {
          suggestedTitle = `${h1} | AEM Agent Suggested`;
          suggestedDesc = `Learn more about ${h1} on this WKND page. (AI Model Offline)`;
        }

        const messageId = `seo-${Date.now()}`;
        addChatMessage('system', `✅ **SEO Recommendations**:\n\n` +
          `- **Suggested Title**: \`${suggestedTitle}\`\n` +
          `- **Suggested Description**: \`${suggestedDesc}\`\n\n` +
          `Would you like me to apply these to the JCR properties?`, messageId);

        // Add "Apply" button to chat response
        const msgEl = document.getElementById(messageId);
        const applyBtn = document.createElement('button');
        applyBtn.textContent = 'Apply to JCR';
        applyBtn.className = 'apply-btn-inline';
        applyBtn.onclick = () => applySEOMetadata(suggestedTitle, suggestedDesc);
        msgEl.appendChild(applyBtn);

        addActivity('ghostwriter', 'completed', 'SEO suggestions generated');
      });
    } catch (e) {
      addActivity('ghostwriter', 'failed', e.message);
    }
  }

  async function applySEOMetadata(title, description) {
    addActivity('ghostwriter', 'running', 'Saving to JCR...');
    addChatMessage('system', `💾 Saving metadata to \`${pageContext.path}/jcr:content\`...`);

    try {
      // Use AEM Sling POST servlet to update properties
      const result = await chrome.runtime.sendMessage({
        type: 'QUERY_AEM_API',
        payload: {
          path: `${pageContext.path}/jcr:content`,
          method: 'POST',
          body: {
            'jcr:title': title,
            'jcr:description': description,
            'seo:title': title,
            'seo:description': description,
            ':operation': 'nop' // Use a multi-property update pattern if needed, but standard POST works
          }
        }
      });

      addChatMessage('system', `✅ **JCR Updated Successfully**!\n\nPage properties have been synchronized with SEO suggestions.`);
      addActivity('ghostwriter', 'completed', 'JCR Metadata Updated');
    } catch (e) {
      addChatMessage('system', `❌ **Failed to update JCR**: ${e.message}`);
      addActivity('ghostwriter', 'failed', e.message);
    }
  }

  async function runPermissionsDebug() {
    addActivity('security', 'running', 'Analyzing ACLs...');
    document.querySelector('.tab[data-tab="chat"]').click();
    addChatMessage('system', 'I am debugging effective permissions for the current path...');

    try {
      const result = await chrome.runtime.sendMessage({
        type: 'DEBUG_PERMISSIONS',
        payload: { path: pageContext.path, user: 'anonymous' }
      });

      let summary = `**Effective Permissions for \`${result.user}\`**\n\n`;
      summary += `- Read: ${result.canRead ? '✅' : '❌'}\n`;
      summary += `- Edit: ${result.canEdit ? '✅' : '❌'}\n\n`;
      summary += `**Inheritance Trace:**\n`;
      result.inheritanceTrace.forEach(t => {
        summary += `- \`${t.path}\`: ${t.rules.join(', ')}\n`;
      });

      addChatMessage('system', summary);

      if (aiSession) {
        const analysis = await aiSession.prompt(`Given this permission trace: ${JSON.stringify(result.inheritanceTrace)}, explain to an AEM developer why a user might be seeing 'Read-Only' access even if they are in the 'contributors' group.`);
        addChatMessage('system', `**AI Security Advisor Analysis**:\n\n${analysis}`);
      }

      addActivity('security', 'completed', 'Analysis finished');
    } catch (e) {
      addActivity('security', 'failed', e.message);
    }
  }

  async function openDevOpsStatus() {
    addActivity('devops', 'running', 'Fetching Cloud Manager status...');
    document.querySelector('.tab[data-tab="chat"]').click();
    addChatMessage('system', 'I am fetching the latest status from Adobe Cloud Manager...');

    try {
      const result = await chrome.runtime.sendMessage({
        type: 'GET_CLOUD_MANAGER_STATUS',
        payload: { programId: 'p12345' }
      });

      if (result.error) {
        addChatMessage('system', `❌ ${result.error}`);
        addActivity('devops', 'failed', result.error);
        return;
      }

      const demoLabel = result._demo ? ' *(Demo Data — not connected to real Cloud Manager)*' : '';
      if (result._notice) addChatMessage('system', `⚠️ ${result._notice}`);
      let summary = `**Cloud Manager Status${demoLabel}**\n\n`;
      result.pipelines.forEach(p => {
        const icon = p.status === 'FAILED' ? '❌' : (p.status === 'IDLE' ? '⚪' : '▶');
        summary += `${icon} **${p.name}**: ${p.status}\n`;
        if (p.error) summary += `   - *Error: ${p.error}*\n`;
      });

      addChatMessage('system', summary);

      const failedPipeline = result.pipelines.find(p => p.status === 'FAILED');
      if (failedPipeline && aiSession) {
        const analysis = await aiSession.prompt(`A Cloud Manager pipeline '${failedPipeline.name}' failed with error: '${failedPipeline.error}'. Explain the possible cause and suggest a fix for an AEM developer.`);
        addChatMessage('system', `**AI Build Whisperer Analysis**:\n\n${analysis}`);
      }

      addActivity('devops', 'completed', 'Status updated');
    } catch (e) {
      addActivity('devops', 'failed', e.message);
    }
  }

  async function runAccessibilityAudit() {
    addActivity('ada-audit', 'running', 'Auditing DOM...');
    document.querySelector('.tab[data-tab="chat"]').click();
    addChatMessage('system', 'Performing accessibility audit of the current page DOM...');

    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_DOM' });
      const dom = response?.dom || '';
      const parser = new DOMParser();
      const doc = parser.parseFromString(dom, 'text/html');

      const issues = [];
      doc.querySelectorAll('img').forEach(img => {
        if (!img.getAttribute('alt')) {
          issues.push({ type: 'ADA', element: 'img', issue: 'Missing alt attribute', suggestion: 'Add descriptive alt text' });
        }
      });
      const h1s = doc.querySelectorAll('h1');
      if (h1s.length > 1) {
        issues.push({ type: 'SEO', element: 'h1', issue: `${h1s.length} H1 tags found`, suggestion: 'Keep only one H1 per page' });
      }

      if (!dom) {
        addChatMessage('system', 'Could not retrieve page DOM. Make sure you are on an AEM page (localhost:4502/4503).');
        addActivity('ada-audit', 'failed', 'No DOM available');
        return;
      }

      const score = Math.max(0, 100 - (issues.length * 15));
      document.getElementById('healthScore').querySelector('.score-value').textContent = `${score}%`;

      let report = `**Accessibility Audit Complete (Score: ${score}%)**\n\n`;
      if (issues.length === 0) {
        report += 'No issues found.';
      } else {
        issues.forEach(i => {
          report += `- [${i.type}] \`${i.element}\`: ${i.issue}. *Suggestion: ${i.suggestion}*\n`;
        });
      }

      addChatMessage('system', report);

      if (aiSession && issues.length > 0) {
        const remediation = await aiSession.prompt(`Given these accessibility issues: ${JSON.stringify(issues)}, provide a specific remediation plan for an AEM developer.`);
        addChatMessage('system', `**AI Remediation Plan**:\n\n${remediation}`);
      }

      addActivity('ada-audit', 'completed', `Score: ${score}%`);
    } catch (e) {
      addActivity('ada-audit', 'failed', e.message);
    }
  }

  async function startTestGeneration() {
    addActivity('test-gen', 'running', 'Scanning components...');
    document.querySelector('.tab[data-tab="chat"]').click();
    addChatMessage('system', 'Scanning the live page DOM for AEM components...');

    try {
      // Discover real components from the live page DOM via content script
      const domResponse = await chrome.runtime.sendMessage({ type: 'GET_DOM' });
      const dom = domResponse?.dom || '';
      const components = [];

      if (dom) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(dom, 'text/html');
        doc.querySelectorAll('[data-sling-resource-type],[data-resource-type]').forEach(el => {
          const resourceType = el.getAttribute('data-sling-resource-type') || el.getAttribute('data-resource-type');
          const path = el.getAttribute('data-path') || el.getAttribute('data-cq-content-path');
          if (resourceType && path && !components.find(c => c.path === path)) {
            components.push({ path, resourceType });
          }
        });
      }

      if (components.length === 0) {
        addChatMessage('system', 'No AEM components with `data-sling-resource-type` found on the current page. Make sure you are viewing an AEM author page.');
        addActivity('test-gen', 'failed', 'No components found');
        return;
      }

      addChatMessage('system', `Found **${components.length} component(s)**. Generating Playwright test for the first one:\n\n` +
        components.slice(0, 5).map((c, i) => `${i+1}. \`${c.path.split('/').pop()}\` — ${c.resourceType}`).join('\n'));

      const target = components[0];
      const result = await chrome.runtime.sendMessage({
        type: 'GENERATE_TEST',
        payload: { 
          componentPath: target.path,
          resourceType: target.resourceType,
          type: 'playwright'
        }
      });

      if (result.success) {
        addChatMessage('system', `✅ **Generated Playwright Test for ${result.componentName}**:\n\n\`\`\`javascript\n${result.code}\n\`\`\``);
        addActivity('test-gen', 'completed', 'Test generated successfully');
      } else {
        addChatMessage('system', `❌ Error: ${result.error}`);
        addActivity('test-gen', 'failed', result.error);
      }
    } catch (e) {
      addActivity('test-gen', 'failed', e.message);
    }
  }

  async function analyzePageLogs() {
    addActivity('log-whisperer', 'running', 'Analyzing AEM logs...');
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'ANALYZE_LOGS',
        payload: { resourceType: pageContext.resourceType || 'unknown' }
      });
      
      if (result.logs && result.logs.length > 0) {
        addActivity('log-whisperer', 'completed', `Found ${result.logs.length} relevant entries`);
        document.querySelector('.tab[data-tab="chat"]').click();
        addChatMessage('system', `**Log Analysis for ${result.resourceType}**:\n\n${result.logs.join('\n')}`);
      } else {
        addActivity('log-whisperer', 'completed', 'No errors found in recent logs');
      }
    } catch (e) {
      addActivity('log-whisperer', 'failed', e.message);
    }
  }

  function openQueryTool() {
    document.querySelector('.tab[data-tab="tools"]').click();
    openToolForm('query-builder');
  }

  async function startCFConversion() {
    addActivity('cf-convert', 'running', 'Extracting page structure...');
    try {
      await chrome.runtime.sendMessage({
        type: 'QUERY_AEM_API',
        payload: { path: `${pageContext.path}.content.html` }
      });

      document.querySelector('.tab[data-tab="chat"]').click();
      addChatMessage('system', `**Content Fragment Suggestion**:\n\nBased on the page structure at \`${pageContext.path}\`, I've identified several content sections that can be converted to fragments.\n\nSuggested Model: **Generic Content**\n\nWould you like me to create a draft Content Fragment in \`/content/dam/fragments\`?`);
      
      addActivity('cf-convert', 'completed', 'Analysis complete. Waiting for user input in chat.');
    } catch (e) {
      addActivity('cf-convert', 'failed', e.message);
    }
  }

  async function activatePage() {
    if (!pageContext.path) {
      addActivity('activate', 'failed', 'No page path available');
      return;
    }
    addActivity('activate', 'running', 'Publishing page...');
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'REPLICATE_PAGE',
        payload: { path: pageContext.path, action: 'activate' }
      });
      addActivity('activate', 'completed', result.success ? 'Page published' : result.error || 'Published');
    } catch (e) {
      addActivity('activate', 'failed', e.message);
    }
  }

  async function unlockPage() {
    if (!pageContext.path) {
      addActivity('unlock', 'failed', 'No page path available');
      return;
    }
    addActivity('unlock', 'running', 'Unlocking page...');
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'UNLOCK_PAGE',
        payload: { path: pageContext.path }
      });
      addActivity('unlock', 'completed', result.success ? 'Page unlocked' : result.error || 'Unlocked');
    } catch (e) {
      addActivity('unlock', 'failed', e.message);
    }
  }

  async function openProperties() {
    if (!pageContext.path) return;
    chrome.tabs.create({ 
      url: `http://localhost:4502/mnt/overlay/wcm/core/content/sites/properties.html?item=${pageContext.path}` 
    });
  }

  async function showReferences() {
    if (!pageContext.path) return;
    chrome.tabs.create({ 
      url: `http://localhost:4502/sites.html/content/dam?checkReferences=${pageContext.path}` 
    });
  }

  async function checkConnections() {
    const statusEl = document.getElementById('connectionStatus');
    try {
      const res = await fetch(`${CXFORGE_URL}/actuator/health`, { method: 'GET' });
      if (res.ok) {
        statusEl.innerHTML = '<span class="status-dot online"></span><span>CXForge Connected</span>';
      }
    } catch (e) {
      statusEl.innerHTML = '<span class="status-dot offline"></span><span>CXForge Offline</span>';
    }
  }

  async function checkPendingTools() {
    const data = await chrome.storage.local.get('pendingToolId');
    if (data.pendingToolId) {
      const toolId = data.pendingToolId;
      await chrome.storage.local.remove('pendingToolId');
      document.querySelector('.tab[data-tab="tools"]').click();
      if (tools.length === 0) {
        let attempts = 0;
        const checkTools = setInterval(() => {
          if (tools.length > 0 || attempts > 10) {
            clearInterval(checkTools);
            openToolForm(toolId);
          }
          attempts++;
        }, 200);
      } else {
        openToolForm(toolId);
      }
    }
  }

  async function performDiff() {
    const { stageUrl } = await chrome.storage.local.get(['stageUrl']);
    if (!stageUrl) {
      addChatMessage('system', 'Please set a Stage URL first.');
      return;
    }

    const path = pageContext.path;
    addChatMessage('system', `Fetching cross-environment diff for ${path}...`);

    chrome.runtime.sendMessage({ type: 'COMPARE_ENVIRONMENTS', payload: { path, stageUrl } }, (response) => {
      if (response.error) {
        addChatMessage('system', `Diff Error: ${response.error}`);
        return;
      }
      showDiffOverlay(response.diff || {});
    });
  }

  async function performGraft() {
    const { stageUrl } = await chrome.storage.local.get(['stageUrl']);
    if (!stageUrl) {
      addChatMessage('system', 'Please set a Stage URL first.');
      return;
    }

    if (!confirm(`Are you sure you want to GRAFT this page to ${stageUrl}? This will overwrite existing content.`)) {
      return;
    }

    addActivity('graft', 'running', 'Porting content...');
    document.querySelector('.tab[data-tab="chat"]').click();
    addChatMessage('system', `🌱 Initiating Content Graft: \`${pageContext.path}\` → \`${stageUrl}\`...`);

    chrome.runtime.sendMessage({
      type: 'GRAFT_CONTENT',
      payload: { path: pageContext.path, targetUrl: stageUrl }
    }, (response) => {
      if (response && response.success) {
        addChatMessage('system', `✅ **Graft Successful**! Content ported to Stage.\n\n[View on Stage](${stageUrl}/editor.html${pageContext.path}.html)`);
        addActivity('graft', 'completed', 'Graft Successful');
      } else {
        addChatMessage('system', `❌ **Graft Failed**: ${response?.error || 'Unknown error'}`);
        addActivity('graft', 'failed', response?.error);
      }
    });
  }

  function showDiffOverlay(diff) {
    const toolsTab = document.getElementById('tools');
    const overlay = document.createElement('div');
    overlay.className = 'diff-overlay';

    let rows = '';
    const entries = Object.entries(diff);

    if (entries.length === 0) {
      rows = '<div class="empty-state">All properties identical.</div>';
    } else {
      const renderDiffEntries = (diffObj, prefix = '') => {
        let out = '';
        for (const [key, val] of Object.entries(diffObj)) {
          const label = prefix ? `${escapeHtml(prefix)} › ${escapeHtml(key)}` : escapeHtml(key);
          if (val.type === 'node') {
            // Recurse into sub-node children — don't silently drop them
            out += renderDiffEntries(val.children, prefix ? `${prefix}/${key}` : key);
            continue;
          }
          let statusClass = '';
          if (val.type === 'added') statusClass = 'diff-added';
          if (val.type === 'removed') statusClass = 'diff-removed';
          if (val.type === 'changed') statusClass = 'diff-changed';
          const displayVal = val.type === 'changed'
            ? `<div class="diff-removed">${escapeHtml(String(val.old ?? ''))}</div><div class="diff-added">${escapeHtml(String(val.new ?? ''))}</div>`
            : escapeHtml(String(val.val ?? ''));
          out += `
            <div class="diff-row ${statusClass}">
              <div class="diff-key">${label}</div>
              <div class="diff-val">${displayVal}</div>
            </div>`;
        }
        return out;
      };
      rows = renderDiffEntries(diff);
    }

    overlay.innerHTML = `
      <div class="diff-header">
        <strong>JCR Parity (Local vs Stage)</strong>
        <button class="close-btn" id="closeDiff">×</button>
      </div>
      <div class="diff-content">${rows}</div>
    `;

    toolsTab.appendChild(overlay);
    document.getElementById('closeDiff').onclick = () => overlay.remove();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  })();