/**
 * Unit tests for diffJCR and calculateBlastRadius.
 * Imports directly from the source module so changes to the real functions
 * are always reflected here — no duplicated implementation.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

let diffJCR, calculateBlastRadius;

test.beforeAll(async () => {
  // Dynamic import bridges CommonJS test runner and the ES module source.
  const mod = await import(path.resolve(__dirname, '../src/background/diff-utils.mjs'));
  diffJCR = mod.diffJCR;
  calculateBlastRadius = mod.calculateBlastRadius;
});

test.describe('diffJCR', () => {
  test('identical objects return empty diff', () => {
    expect(diffJCR(
      { 'jcr:title': 'Hello', 'sling:resourceType': 'wknd/components/page' },
      { 'jcr:title': 'Hello', 'sling:resourceType': 'wknd/components/page' }
    )).toEqual({});
  });

  test('detects added property (present in local, absent in remote)', () => {
    const result = diffJCR({ 'jcr:title': 'Hello', newProp: 'value' }, { 'jcr:title': 'Hello' });
    expect(result.newProp).toEqual({ type: 'added', val: 'value' });
  });

  test('detects removed property (absent in local, present in remote)', () => {
    const result = diffJCR({ 'jcr:title': 'Hello' }, { 'jcr:title': 'Hello', oldProp: 'gone' });
    expect(result.oldProp).toEqual({ type: 'removed', val: 'gone' });
  });

  test('detects changed property value', () => {
    const result = diffJCR({ 'jcr:title': 'New Title' }, { 'jcr:title': 'Old Title' });
    expect(result['jcr:title']).toEqual({ type: 'changed', old: 'Old Title', new: 'New Title' });
  });

  test('skips jcr:lastModified and other volatile keys', () => {
    expect(diffJCR(
      { 'jcr:title': 'Same', 'jcr:lastModified': '2024-01-01', 'jcr:uuid': 'aaa' },
      { 'jcr:title': 'Same', 'jcr:lastModified': '2025-06-01', 'jcr:uuid': 'bbb' }
    )).toEqual({});
  });

  test('recurses into sub-nodes and surfaces child diffs', () => {
    const result = diffJCR(
      { 'jcr:content': { 'jcr:title': 'New' } },
      { 'jcr:content': { 'jcr:title': 'Old' } }
    );
    expect(result['jcr:content'].type).toBe('node');
    expect(result['jcr:content'].children['jcr:title']).toEqual({ type: 'changed', old: 'Old', new: 'New' });
  });

  test('stops recursion at depth 3 — 4th level changes are silently ignored', () => {
    const result = diffJCR(
      { a: { b: { c: { d: { changed: 'yes' } } } } },
      { a: { b: { c: { d: { changed: 'no' } } } } }
    );
    expect(result?.a?.children?.b?.children?.c?.children).toBeUndefined();
  });

  test('handles empty local gracefully', () => {
    const result = diffJCR({}, { 'sling:resourceType': 'wknd/page' });
    expect(result['sling:resourceType']).toEqual({ type: 'removed', val: 'wknd/page' });
  });

  test('handles empty remote gracefully', () => {
    const result = diffJCR({ 'sling:resourceType': 'wknd/page' }, {});
    expect(result['sling:resourceType']).toEqual({ type: 'added', val: 'wknd/page' });
  });
});

test.describe('calculateBlastRadius', () => {
  test('always includes direct page invalidation path', () => {
    const result = calculateBlastRadius('/content/wknd/en/home', { liveCopies: [] });
    expect(result.paths).toContain('/content/wknd/en/home.html');
  });

  test('adds statfile invalidation for paths deeper than 3 segments', () => {
    const result = calculateBlastRadius('/content/wknd/en/deep/page', { liveCopies: [] });
    expect(result.paths.some(p => p.includes('Statfile Invalidation'))).toBe(true);
  });

  test('does NOT add statfile invalidation for shallow paths', () => {
    const result = calculateBlastRadius('/content/wknd', { liveCopies: [] });
    expect(result.paths.some(p => p.includes('Statfile Invalidation'))).toBe(false);
  });

  test('adds live copy paths when msmData has liveCopies', () => {
    const result = calculateBlastRadius('/content/wknd/en/home', {
      liveCopies: [{ path: '/content/wknd/fr/home' }, { path: '/content/wknd/de/home' }]
    });
    expect(result.paths).toContain('/content/wknd/fr/home.html (Propagated)');
    expect(result.paths).toContain('/content/wknd/de/home.html (Propagated)');
  });

  test('severity is high when more than 10 affected paths', () => {
    const liveCopies = Array.from({ length: 12 }, (_, i) => ({ path: `/content/wknd/loc${i}/home` }));
    expect(calculateBlastRadius('/content/wknd/en/home', { liveCopies }).severity).toBe('high');
  });

  test('severity is medium for 4–10 affected paths', () => {
    const liveCopies = Array.from({ length: 4 }, (_, i) => ({ path: `/content/wknd/loc${i}/home` }));
    expect(calculateBlastRadius('/content/wknd/en/home', { liveCopies }).severity).toBe('medium');
  });

  test('severity is low for 3 or fewer affected paths', () => {
    expect(calculateBlastRadius('/content/wknd/en/home', { liveCopies: [] }).severity).toBe('low');
  });

  test('count matches paths array length', () => {
    const result = calculateBlastRadius('/content/wknd/en/home', {
      liveCopies: [{ path: '/content/wknd/fr/home' }]
    });
    expect(result.count).toBe(result.paths.length);
  });
});
