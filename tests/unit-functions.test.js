/**
 * Unit tests for pure functions extracted from background.js.
 * These run without a live AEM instance or loaded extension — just a browser page
 * for the `page.evaluate` sandbox.
 */
const { test, expect, chromium } = require('@playwright/test');

// Inline the pure functions so the test file is self-contained and doesn't need
// to import the service-worker script (which has top-level chrome.* calls).

const DIFF_SKIP_KEYS_SRC = `
  const DIFF_SKIP_KEYS = new Set([
    'jcr:lastModified', 'jcr:lastModifiedBy', 'cq:lastModified', 'cq:lastModifiedBy',
    'jcr:uuid', 'jcr:created', 'jcr:createdBy', 'jcr:baseVersion', 'jcr:versionHistory',
    'jcr:predecessors', 'jcr:isCheckedOut'
  ]);
`;

const DIFF_JCR_SRC = `
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
`;

const BLAST_RADIUS_SRC = `
  function calculateBlastRadius(path, msmData) {
    const affectedPaths = [];
    affectedPaths.push(path + '.html');
    const segments = path.split('/').filter(Boolean);
    if (segments.length > 3) {
      const parentPath = '/' + segments.slice(0, 3).join('/');
      affectedPaths.push(parentPath + '/* (Statfile Invalidation)');
    }
    if (msmData.liveCopies && msmData.liveCopies.length > 0) {
      msmData.liveCopies.forEach(lc => {
        affectedPaths.push(lc.path + '.html (Propagated)');
      });
    }
    return {
      paths: affectedPaths,
      count: affectedPaths.length,
      severity: affectedPaths.length > 10 ? 'high' : 'low'
    };
  }
`;

async function evalFn(page, fnName, ...args) {
  return page.evaluate(
    ({ src, name, args }) => {
      // eslint-disable-next-line no-new-func
      const fn = new Function(`${src}; return ${name}`);
      return fn()(...args);
    },
    { src: DIFF_SKIP_KEYS_SRC + DIFF_JCR_SRC + BLAST_RADIUS_SRC, name: fnName, args }
  );
}

test.describe('diffJCR — pure unit tests', () => {
  let browser;
  let page;

  test.beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await browser.close();
  });

  test('identical objects return empty diff', async () => {
    const diff = await evalFn(page, 'diffJCR',
      { 'jcr:title': 'Hello', 'sling:resourceType': 'wknd/components/page' },
      { 'jcr:title': 'Hello', 'sling:resourceType': 'wknd/components/page' }
    );
    expect(diff).toEqual({});
  });

  test('detects added property (present in local, absent in remote)', async () => {
    const diff = await evalFn(page, 'diffJCR',
      { 'jcr:title': 'Hello', 'newProp': 'value' },
      { 'jcr:title': 'Hello' }
    );
    expect(diff.newProp).toEqual({ type: 'added', val: 'value' });
  });

  test('detects removed property (absent in local, present in remote)', async () => {
    const diff = await evalFn(page, 'diffJCR',
      { 'jcr:title': 'Hello' },
      { 'jcr:title': 'Hello', 'oldProp': 'gone' }
    );
    expect(diff.oldProp).toEqual({ type: 'removed', val: 'gone' });
  });

  test('detects changed property value', async () => {
    const diff = await evalFn(page, 'diffJCR',
      { 'jcr:title': 'New Title' },
      { 'jcr:title': 'Old Title' }
    );
    expect(diff['jcr:title']).toEqual({ type: 'changed', old: 'Old Title', new: 'New Title' });
  });

  test('skips jcr:lastModified and other volatile keys', async () => {
    const diff = await evalFn(page, 'diffJCR',
      { 'jcr:title': 'Same', 'jcr:lastModified': '2024-01-01', 'jcr:uuid': 'aaa' },
      { 'jcr:title': 'Same', 'jcr:lastModified': '2025-06-01', 'jcr:uuid': 'bbb' }
    );
    expect(diff).toEqual({});
  });

  test('recurses into sub-nodes and surfaces child diffs', async () => {
    const diff = await evalFn(page, 'diffJCR',
      { 'jcr:content': { 'jcr:title': 'New' } },
      { 'jcr:content': { 'jcr:title': 'Old' } }
    );
    expect(diff['jcr:content'].type).toBe('node');
    expect(diff['jcr:content'].children['jcr:title']).toEqual({ type: 'changed', old: 'Old', new: 'New' });
  });

  test('stops recursion at depth 3', async () => {
    const deep = { a: { b: { c: { d: { changed: 'yes' } } } } };
    const deepOld = { a: { b: { c: { d: { changed: 'no' } } } } };
    const diff = await evalFn(page, 'diffJCR', deep, deepOld);
    // Depth 3 node 'd' should be silently skipped
    const childrenAtDepth3 = diff?.a?.children?.b?.children?.c?.children;
    expect(childrenAtDepth3).toBeUndefined();
  });

  test('handles empty local gracefully', async () => {
    const diff = await evalFn(page, 'diffJCR', {}, { 'sling:resourceType': 'wknd/page' });
    expect(diff['sling:resourceType']).toEqual({ type: 'removed', val: 'wknd/page' });
  });

  test('handles empty remote gracefully', async () => {
    const diff = await evalFn(page, 'diffJCR', { 'sling:resourceType': 'wknd/page' }, {});
    expect(diff['sling:resourceType']).toEqual({ type: 'added', val: 'wknd/page' });
  });
});

test.describe('calculateBlastRadius — pure unit tests', () => {
  let browser;
  let page;

  test.beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await browser.close();
  });

  test('always includes direct page invalidation path', async () => {
    const result = await evalFn(page, 'calculateBlastRadius',
      '/content/wknd/en/home', { liveCopies: [] }
    );
    expect(result.paths).toContain('/content/wknd/en/home.html');
  });

  test('adds statfile invalidation for paths deeper than 3 segments', async () => {
    const result = await evalFn(page, 'calculateBlastRadius',
      '/content/wknd/en/deep/page', { liveCopies: [] }
    );
    expect(result.paths.some(p => p.includes('Statfile Invalidation'))).toBe(true);
  });

  test('does NOT add statfile invalidation for shallow paths', async () => {
    const result = await evalFn(page, 'calculateBlastRadius',
      '/content/wknd', { liveCopies: [] }
    );
    expect(result.paths.some(p => p.includes('Statfile Invalidation'))).toBe(false);
  });

  test('adds live copy paths when msmData has liveCopies', async () => {
    const result = await evalFn(page, 'calculateBlastRadius',
      '/content/wknd/en/home',
      { liveCopies: [{ path: '/content/wknd/fr/home' }, { path: '/content/wknd/de/home' }] }
    );
    expect(result.paths).toContain('/content/wknd/fr/home.html (Propagated)');
    expect(result.paths).toContain('/content/wknd/de/home.html (Propagated)');
  });

  test('severity is high when more than 10 affected paths', async () => {
    const liveCopies = Array.from({ length: 12 }, (_, i) => ({ path: `/content/wknd/loc${i}/home` }));
    const result = await evalFn(page, 'calculateBlastRadius',
      '/content/wknd/en/home', { liveCopies }
    );
    expect(result.severity).toBe('high');
  });

  test('severity is low for few affected paths', async () => {
    const result = await evalFn(page, 'calculateBlastRadius',
      '/content/wknd/en/home', { liveCopies: [] }
    );
    expect(result.severity).toBe('low');
  });

  test('count matches paths array length', async () => {
    const result = await evalFn(page, 'calculateBlastRadius',
      '/content/wknd/en/home',
      { liveCopies: [{ path: '/content/wknd/fr/home' }] }
    );
    expect(result.count).toBe(result.paths.length);
  });
});
