export const DIFF_SKIP_KEYS = new Set([
  'jcr:lastModified', 'jcr:lastModifiedBy', 'cq:lastModified', 'cq:lastModifiedBy',
  'jcr:uuid', 'jcr:created', 'jcr:createdBy', 'jcr:baseVersion', 'jcr:versionHistory',
  'jcr:predecessors', 'jcr:isCheckedOut'
]);

export function diffJCR(local, remote, depth = 0) {
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

export function calculateBlastRadius(path, msmData) {
  const affectedPaths = [];

  affectedPaths.push(`${path}.html`);

  const segments = path.split('/').filter(Boolean);
  if (segments.length > 3) {
    const parentPath = '/' + segments.slice(0, 3).join('/');
    affectedPaths.push(`${parentPath}/* (Statfile Invalidation)`);
  }

  if (msmData.liveCopies && msmData.liveCopies.length > 0) {
    msmData.liveCopies.forEach(lc => {
      affectedPaths.push(`${lc.path}.html (Propagated)`);
    });
  }

  const count = affectedPaths.length;
  const severity = count > 10 ? 'high' : count > 3 ? 'medium' : 'low';
  return { paths: affectedPaths, count, severity };
}
