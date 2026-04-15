const CXFORGE_URL = 'http://localhost:10004';

async function getAemConfig() {
  return new Promise(resolve => {
    chrome.storage.local.get(['aemAuthorUrl', 'aemUsername', 'aemPassword'], result => {
      resolve({
        authorUrl: (result.aemAuthorUrl || 'http://localhost:4502').replace(/\/$/, ''),
        username: result.aemUsername || '',
        password: result.aemPassword || '',
        configured: !!(result.aemUsername && result.aemPassword)
      });
    });
  });
}

// CSRF token cache (AEM tokens expire after ~30 min; refresh every 10 min to be safe)
const csrfCache = { token: null, expiry: 0 };

async function getCsrfToken(authorUrl) {
  if (csrfCache.token && Date.now() < csrfCache.expiry) return csrfCache.token;
  try {
    const res = await fetch(`${authorUrl}/libs/granite/csrf/token.json`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      csrfCache.token = data.token;
      csrfCache.expiry = Date.now() + 10 * 60 * 1000;
      return csrfCache.token;
    }
    if (res.status === 401 || res.status === 403) throw new Error('SESSION_EXPIRED');
  } catch (e) {
    if (e.message === 'SESSION_EXPIRED') throw e;
    console.warn('CSRF token fetch failed:', e.message);
  }
  return null;
}

function assertSession(response) {
  if (response.status === 401 || response.status === 403) {
    throw new Error('AEM session expired or insufficient permissions. Please log into AEM and try again.');
  }
}

// Security: validate that a URL is a permitted AEM target before sending credentials to it
function assertSafeAemUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  const allowed = [
    /^https?:\/\/localhost(:\d+)?$/,
    /^https:\/\/[a-z0-9-]+\.adobeaemcloud\.com$/,
    /^https:\/\/[a-z0-9-]+\.adobeaemcloud\.net$/,
    /^https:\/\/[a-z0-9-]+\.author\.cloud\.adobe\.com$/
  ];
  if (!allowed.some(pattern => pattern.test(parsed.origin))) {
    throw new Error(`Target URL "${parsed.origin}" is not a recognised AEM host. Check your Stage URL setting.`);
  }
  if (parsed.protocol === 'http:' && parsed.hostname !== 'localhost') {
    throw new Error(`Target URL must use HTTPS for non-localhost hosts (received: ${url}). Credentials would be sent in cleartext.`);
  }
}

// Compatibility shim — keep getTargetCredentials for any callers not yet updated
async function getTargetCredentials() {
  const cfg = await getAemConfig();
  return { username: cfg.username, password: cfg.password, configured: cfg.configured };
}

let currentTabContext = {};
let webmcReady = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'AEM_PAGE_CONTEXT':
      currentTabContext = message.payload;
      console.log('AEM Agent: Background received context update:', currentTabContext);
      chrome.sidePanel?.setOptions({ path: 'src/sidepanel/sidepanel.html' });
      // Broadcast to sidepanel if open
      chrome.runtime.sendMessage({ type: 'AEM_PAGE_CONTEXT', payload: currentTabContext });
      break;

    case 'WEBMC_READY':
      webmcReady = message.payload.enabled;
      break;

    case 'GET_PAGE_CONTEXT':
      sendResponse(currentTabContext);
      break;

    case 'RUN_CXFORGE_TOOL':
      runCxforgeTool(message.payload).then(sendResponse).catch(err => sendResponse({ error: err.message }));
      return true;

    case 'QUERY_AEM_API':
      queryAemApi(message.payload).then(sendResponse).catch(err => sendResponse({ error: err.message }));
      return true;

    case 'OPEN_PAGE_IN_AEM':
      openPageInAem(message.payload.path);
      break;

    case 'GET_TOOL_DEFINITIONS':
      getToolDefinitions().then(sendResponse).catch(err => sendResponse({ error: err.message }));
      return true;

    case 'EXECUTE_JOB':
      executeJob(message.payload).then(sendResponse).catch(err => sendResponse({ error: err.message }));
      return true;

    case 'REPLICATE_PAGE':
      replicatePage(message.payload).then(sendResponse).catch(err => sendResponse({ error: err.message }));
      return true;

    case 'ANALYZE_LOGS':
      analyzeLogs(message.payload).then(sendResponse).catch(err => sendResponse({ error: err.message }));
      return true;

    case 'GET_MSM_CONTEXT':
      getMsmContext(message.payload).then(sendResponse).catch(err => sendResponse({ error: err.message }));
      return true;

    case 'GENERATE_TEST':
      generateComponentTest(message.payload).then(sendResponse).catch(err => sendResponse({ error: err.message }));
      return true;

    case 'GET_CLOUD_MANAGER_STATUS':
      getCloudManagerStatus(message.payload).then(sendResponse).catch(err => sendResponse({ error: err.message }));
      return true;

    case 'DEBUG_PERMISSIONS':
      debugPermissions(message.payload).then(sendResponse).catch(err => sendResponse({ error: err.message }));
      return true;

    case 'CREATE_CF':
      createContentFragment(message.payload).then(sendResponse).catch(err => sendResponse({ error: err.message }));
      return true;

    case 'UNLOCK_PAGE':
      unlockPage(message.payload).then(sendResponse).catch(err => sendResponse({ error: err.message }));
      return true;

    case 'GET_CF_MODELS':
      getCfModels(message.payload).then(sendResponse).catch(err => sendResponse({ error: err.message }));
      return true;

    case 'COMPARE_ENVIRONMENTS':
      compareEnvironments(message.payload).then(sendResponse);
      return true;

    case 'GRAFT_CONTENT':
      handleGraftContent(message.payload).then(sendResponse);
      return true;

    case 'GET_DOM':
      handleGetDom(sendResponse);
      return true;

    default:
      break;
  }
});

async function handleGetDom(sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      sendResponse({ error: 'No active tab found' });
      return;
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_DOM' });
    sendResponse(response);
  } catch (error) {
    sendResponse({ error: error.message });
  }
}

async function handleGraftContent({ path, targetUrl }) {
  try {
    assertSafeAemUrl(targetUrl);
    const { authorUrl, username, password, configured } = await getAemConfig();
    if (!configured) {
      return { success: false, error: 'AEM credentials not configured. Please set them in the Settings panel.' };
    }

    // 1. Export from current source
    const sourceUrl = `${authorUrl}${path}.infinity.json`;
    const sourceRes = await fetch(sourceUrl, { credentials: 'include' });
    
    if (!sourceRes.ok) {
      throw new Error(`Source fetch failed: ${sourceRes.status} ${sourceRes.statusText}`);
    }
    
    const sourceData = await sourceRes.json();
    
    // 2. Prepare for Import to Target
    // AEM Sling POST Servlet :operation=import
    const formData = new FormData();
    formData.append(':operation', 'import');
    formData.append(':contentType', 'json');
    formData.append(':name', path.split('/').pop());
    formData.append(':content', JSON.stringify(sourceData));
    formData.append(':replace', 'true');
    formData.append(':replaceProperties', 'true');

    // Determine target parent path
    const targetPath = path.substring(0, path.lastIndexOf('/'));
    const targetEndpoint = `${targetUrl}${targetPath}`;

    const response = await fetch(targetEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${username}:${password}`)
      },
      body: formData
    });

    if (response.ok) {
      return { success: true, message: `Grafted to ${targetUrl}` };
    } else {
      const errorText = await response.text();
      return { success: false, error: `Graft failed: ${response.status} ${errorText}` };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function runCxforgeTool({ toolId, params }) {
  const response = await fetch(`${CXFORGE_URL}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      toolId,
      parameters: params,
      context: currentTabContext
    })
  });
  
  if (!response.ok) {
    throw new Error(`CXForge error: ${response.status}`);
  }
  
  return response.json();
}

async function debugPermissions({ path, user = 'anonymous' }) {
  try {
    const { authorUrl } = await getAemConfig();
    const url = `${authorUrl}/bin/wcm/security/permissions.json?path=${encodeURIComponent(path)}&user=${encodeURIComponent(user)}`;
    
    const response = await fetch(url, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      throw new Error(`Permission API error: ${response.status}`);
    }
    
    const data = await response.json();
    const inheritanceTrace = tracePermissions(path, data);
    
    return {
      path,
      user,
      permissions: data.permissions || [],
      canRead: data.canRead || false,
      canEdit: data.canEdit || false,
      inheritanceTrace
    };
  } catch (e) {
    return { error: e.message };
  }
}

function tracePermissions(path, data) {
  // Build trace from real API response if available
  if (data.acl && Array.isArray(data.acl)) {
    return data.acl.map(entry => ({
      path: entry.path || path,
      inherited: !!entry.inherited,
      rules: (entry.privileges || []).map(p => `${p.granted ? 'Allow' : 'Deny'} ${p.name} for '${entry.principal}'`)
    }));
  }

  // Fallback: construct path segments with real permission flags from the response
  const segments = path.split('/').filter(Boolean);
  const trace = [];
  let currentPath = '';
  segments.forEach(seg => {
    currentPath += '/' + seg;
    const rules = [];
    if (data.canRead) rules.push("Allow jcr:read");
    if (data.canEdit) rules.push("Allow jcr:modifyProperties");
    if (rules.length === 0) rules.push("No explicit allow — check group membership");
    trace.push({ path: currentPath, inherited: true, rules });
  });
  return trace;
}

async function getCloudManagerStatus({ programId }) {
  // NOTE: Real Cloud Manager integration requires an Adobe I/O API key configured below.
  // Until configured, this returns demo data clearly labelled as such.
  // To enable: create an integration at console.adobe.io, add aemCloudManagerApiKey to storage.
  return new Promise(resolve => {
    chrome.storage.local.get(['aemCloudManagerApiKey'], result => {
      if (result.aemCloudManagerApiKey) {
        // Real integration placeholder — implement Adobe I/O API call here
        resolve({ error: 'Cloud Manager API key found but real integration not yet implemented. Coming soon.' });
      } else {
        resolve({
          programId: programId || 'p12345',
          _demo: true,
          _notice: 'DEMO DATA — not connected to real Cloud Manager. Add API key in settings to connect.',
          pipelines: [
            { id: '1', name: 'Production Deployment', status: 'FAILED', lastRun: '2026-04-07T14:30:00Z', error: 'Unit Test Failure: Core Bundle' },
            { id: '2', name: 'Stage Deployment', status: 'IDLE', lastRun: '2026-04-06T10:00:00Z' }
          ],
          environments: [
            { name: 'Production', type: 'prod', status: 'ready' },
            { name: 'Stage', type: 'stage', status: 'ready' },
            { name: 'Development', type: 'dev', status: 'ready' }
          ]
        });
      }
    });
  });
}

async function generateComponentTest({ componentPath, resourceType, type = 'playwright' }) {
  try {
    const { authorUrl } = await getAemConfig();

    // 1. Fetch component definition from JCR
    const response = await fetch(`${authorUrl}${resourceType}.json`, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) throw new Error(`Failed to fetch component definition: ${response.status}`);
    assertSession(response);
    const componentDef = await response.json();

    // 2. Fetch component instance data (properties)
    const instResponse = await fetch(`${authorUrl}${componentPath}.json`, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    });
    
    const instanceData = instResponse.ok ? await instResponse.json() : {};

    // 3. Generate Test based on type
    const testCode = type === 'playwright' 
      ? generatePlaywrightTest(componentPath, resourceType, instanceData)
      : generateJUnitTest(componentPath, resourceType, instanceData);

    return {
      success: true,
      code: testCode,
      componentName: componentDef['jcr:title'] || resourceType.split('/').pop()
    };
  } catch (e) {
    return { error: e.message };
  }
}

function generatePlaywrightTest(path, resourceType, data) {
  const componentName = resourceType.split('/').pop();
  const properties = Object.keys(data)
    .filter(k => !k.startsWith('jcr:') && !k.startsWith('sling:'))
    .map(k => `  // Expect property '${k}' to be rendered correctly
  await expect(page.locator('[data-resource-path="${path}"]')).toContainText('${data[k]}');`)
    .join('\n');

  return `import { test, expect } from '@playwright/test';

test('verify ${componentName} component', async ({ page }) => {
  await page.goto('http://localhost:4502/editor.html${path.split('/jcr:content')[0]}.html');
  
  // Wait for component to be visible
  const component = page.locator('[data-resource-path="${path}"]');
  await expect(component).toBeVisible();

${properties}
});`;
}

function generateJUnitTest(path, resourceType, data) {
  const className = resourceType.split('/').pop().replace(/-/g, '') + 'Test';
  return `package com.example.core.components;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import static org.junit.jupiter.api.Assertions.assertEquals;

@ExtendWith(AemContextExtension.class)
class ${className} {

    private final AemContext context = new AemContext();

    @BeforeEach
    void setUp() {
        context.load().json("${path}.json", "${path}");
    }

    @Test
    void testComponentProperties() {
        context.currentResource("${path}");
        // Add assertions for Sling Model or Resource properties
    }
}`;
}

async function getMsmContext({ path }) {
  try {
    const { authorUrl } = await getAemConfig();
    const url = `${authorUrl}/libs/wcm/msm/content/commands/getLiveCopyStatus.json?path=${encodeURIComponent(path)}`;
    
    const response = await fetch(url, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      throw new Error(`MSM API error: ${response.status}`);
    }
    
    const msmData = await response.json();
    const blastRadius = calculateBlastRadius(path, msmData);
    
    return {
      path,
      isLiveCopy: msmData.isLiveCopy || false,
      isSource: msmData.isSource || false,
      liveCopies: msmData.liveCopies || [],
      blueprints: msmData.blueprints || [],
      blastRadius
    };
  } catch (e) {
    return { error: e.message };
  }
}

function calculateBlastRadius(path, msmData) {
  const affectedPaths = [];
  
  // 1. Direct Page Invalidation
  affectedPaths.push(`${path}.html`);
  
  // 2. Dispatcher Statfile Level Heuristic (Assuming level 2/3)
  const segments = path.split('/').filter(Boolean);
  if (segments.length > 3) {
    const parentPath = '/' + segments.slice(0, 3).join('/');
    affectedPaths.push(`${parentPath}/* (Statfile Invalidation)`);
  }

  // 3. MSM Propagation
  if (msmData.liveCopies && msmData.liveCopies.length > 0) {
    msmData.liveCopies.forEach(lc => {
      affectedPaths.push(`${lc.path}.html (Propagated)`);
    });
  }

  return {
    paths: affectedPaths,
    count: affectedPaths.length,
    severity: affectedPaths.length > 10 ? 'high' : 'low'
  };
}

async function queryAemApi({ path, method = 'GET', body = null }) {
  const { authorUrl } = await getAemConfig();
  const url = path.startsWith('/') ? `${authorUrl}${path}` : path;

  const options = {
    method,
    credentials: 'include',
    headers: { 'Accept': 'application/json' }
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    const csrf = await getCsrfToken(authorUrl);
    const formData = new URLSearchParams();
    for (const key in body) formData.append(key, body[key]);
    options.body = formData;
    options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (csrf) options.headers['CSRF-Token'] = csrf;
  } else if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  assertSession(response);
  if (!response.ok) throw new Error(`AEM API error: ${response.status}`);
  return response.json();
}

async function getToolDefinitions() {
  const response = await fetch(`${CXFORGE_URL}/api/tools`);
  
  if (!response.ok) {
    throw new Error(`CXForge error: ${response.status}`);
  }
  
  return response.json();
}

async function executeJob({ jobId }) {
  const response = await fetch(`${CXFORGE_URL}/api/jobs/${jobId}`);
  
  if (!response.ok) {
    throw new Error(`CXForge error: ${response.status}`);
  }
  
  return response.json();
}

async function openPageInAem(path) {
  const { authorUrl } = await getAemConfig();
  chrome.tabs.create({ url: `${authorUrl}/editor.html${path}.html` });
}

async function replicatePage({ path, action }) {
  const { authorUrl } = await getAemConfig();
  const csrf = await getCsrfToken(authorUrl);
  const cmd = action === 'activate' ? 'Activate' : 'Deactivate';

  const formData = new URLSearchParams();
  formData.append('path', path);
  formData.append('cmd', cmd);
  formData.append('_charset_', 'utf-8');

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (csrf) headers['CSRF-Token'] = csrf;

  const response = await fetch(`${authorUrl}/bin/replicate.json`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: formData.toString()
  });

  assertSession(response);
  if (response.ok) return { success: true };
  const error = await response.text();
  return { success: false, error: error || 'Replication failed' };
}

async function unlockPage({ path }) {
  const { authorUrl } = await getAemConfig();
  const csrf = await getCsrfToken(authorUrl);

  // AEM uses cq:locked/cq:lockOwner on jcr:content to track soft locks.
  // Sling POST @Delete removes both properties atomically.
  const formData = new URLSearchParams();
  formData.append('cq:locked@Delete', '');
  formData.append('cq:lockOwner@Delete', '');
  formData.append('_charset_', 'utf-8');

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (csrf) headers['CSRF-Token'] = csrf;

  const response = await fetch(`${authorUrl}${path}/jcr:content`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: formData.toString()
  });

  assertSession(response);
  if (response.ok) return { success: true };
  const error = await response.text();
  return { success: false, error: error || 'Unlock failed' };
}

async function analyzeLogs({ resourceType }) {
  try {
    const { authorUrl } = await getAemConfig();
    const logsUrl = `${authorUrl}/system/console/status-slinglogs.txt`;
    const response = await fetch(logsUrl, {
      credentials: 'include',
      headers: { 'Accept': 'text/plain' }
    });
    
    if (!response.ok) throw new Error('Could not fetch AEM logs');
    
    const text = await response.text();
    const lines = text.split('\n');
    
    // Surgical Pre-processing: Filter for high-signal lines
    const highSignalLines = [];
    let captureStackTrace = 0;

    for (const line of lines) {
      const isError = line.includes('ERROR') || line.includes('Exception');
      const isAemCore = line.includes('com.day.cq') || line.includes('org.apache.sling');
      const isTargetResource = resourceType && line.includes(resourceType);

      if (isError || isTargetResource || isAemCore) {
        highSignalLines.push(line);
        // If it's an error, capture the next 5 lines of stack trace
        if (isError) captureStackTrace = 5;
      } else if (captureStackTrace > 0) {
        highSignalLines.push(`  ${line.trim()}`);
        captureStackTrace--;
      }
    }

    const filteredLogs = highSignalLines.slice(-30); // Last 30 high-signal entries
    
    return {
      resourceType,
      logs: filteredLogs,
      timestamp: new Date().toISOString(),
      signalCount: filteredLogs.length
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function getCfModels({ sitePath = '/conf/global' } = {}) {
  try {
    const { authorUrl } = await getAemConfig();
    // Try site-specific conf first, fall back to global
    const confPaths = [sitePath, '/conf/global'].filter((v, i, a) => a.indexOf(v) === i);
    const models = [];
    for (const conf of confPaths) {
      const url = `${authorUrl}${conf}/settings/dam/cfm/models.1.json`;
      const res = await fetch(url, { credentials: 'include', headers: { 'Accept': 'application/json' } });
      if (!res.ok) continue;
      const data = await res.json();
      for (const [key, val] of Object.entries(data)) {
        if (key.startsWith('jcr:') || typeof val !== 'object' || val === null) continue;
        // Models can be cq:Template (AEMaaCS) or dam:CFModel (AEM 6.5)
        const pt = val['jcr:primaryType'];
        const jcrTitle = val['jcr:content']?.['jcr:title'] || val['jcr:title'] || key;
        if (pt === 'dam:CFModel' || pt === 'cq:Template') {
          models.push({ name: key, title: jcrTitle, path: `${conf}/settings/dam/cfm/models/${key}` });
        }
      }
      if (models.length > 0) break;
    }
    return { models };
  } catch (e) {
    return { error: e.message, models: [] };
  }
}

async function createContentFragment({ folderPath, name, title, modelPath, properties }) {
  try {
    const { authorUrl } = await getAemConfig();
    const csrf = await getCsrfToken(authorUrl);

    const body = {
      'entity-type': 'contentFragment',
      'properties': {
        'cq:model': modelPath,
        'title': title,
        ...properties
      }
    };

    const headers = { 'Content-Type': 'application/json' };
    if (csrf) headers['CSRF-Token'] = csrf;

    const response = await fetch(`${authorUrl}/api/assets/${folderPath}/*`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(body)
    });

    assertSession(response);
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`AEM API error: ${response.status} - ${error}`);
    }

    return await response.json();
  } catch (e) {
    return { error: e.message };
  }
}

chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true });

async function compareEnvironments({ path, stageUrl }) {
  try {
    assertSafeAemUrl(stageUrl);
    const { authorUrl, username, password } = await getAemConfig();
    const localUrl = `${authorUrl}${path}.infinity.json`;
    const remoteUrl = `${stageUrl}${path}.infinity.json`;

    const remoteHeaders = {};
    if (username && password) {
      remoteHeaders['Authorization'] = 'Basic ' + btoa(`${username}:${password}`);
    }

    const [localRes, remoteRes] = await Promise.all([
      fetch(localUrl, { credentials: 'include' }),
      fetch(remoteUrl, { headers: remoteHeaders })
    ]);

    if (!localRes.ok) throw new Error(`Local fetch failed: ${localRes.statusText}`);
    if (!remoteRes.ok) throw new Error(`Stage fetch failed: ${remoteRes.statusText}`);

    const localJson = await localRes.json();
    const remoteJson = await remoteRes.json();

    return { diff: diffJCR(localJson, remoteJson) };
  } catch (e) {
    return { error: e.message };
  }
}

const DIFF_SKIP_KEYS = new Set([
  'jcr:lastModified', 'jcr:lastModifiedBy', 'cq:lastModified', 'cq:lastModifiedBy',
  'jcr:uuid', 'jcr:created', 'jcr:createdBy', 'jcr:baseVersion', 'jcr:versionHistory',
  'jcr:predecessors', 'jcr:isCheckedOut'
]);

function diffJCR(local, remote, depth = 0) {
  const diff = {};
  const localObj = local || {};
  const remoteObj = remote || {};
  const allKeys = new Set([...Object.keys(localObj), ...Object.keys(remoteObj)]);

  for (const key of allKeys) {
    if (DIFF_SKIP_KEYS.has(key)) continue;

    const localVal = localObj[key];
    const remoteVal = remoteObj[key];
    const localIsNode = localVal !== null && typeof localVal === 'object' && !Array.isArray(localVal);
    const remoteIsNode = remoteVal !== null && typeof remoteVal === 'object' && !Array.isArray(remoteVal);

    if (localIsNode || remoteIsNode) {
      if (depth < 3) {
        const subDiff = diffJCR(localIsNode ? localVal : {}, remoteIsNode ? remoteVal : {}, depth + 1);
        if (Object.keys(subDiff).length > 0) {
          diff[key] = { type: 'node', children: subDiff };
        }
      }
      continue;
    }

    const localStr = JSON.stringify(localVal);
    const remoteStr = JSON.stringify(remoteVal);

    if (!(key in remoteObj)) {
      diff[key] = { type: 'added', val: localVal };
    } else if (!(key in localObj)) {
      diff[key] = { type: 'removed', val: remoteVal };
    } else if (localStr !== remoteStr) {
      diff[key] = { type: 'changed', old: remoteVal, new: localVal };
    }
  }

  return diff;
}