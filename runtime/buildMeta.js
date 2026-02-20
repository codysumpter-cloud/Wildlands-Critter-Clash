export async function loadBuildMeta(path = 'runtime/build_meta.json') {
  try {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) return null;
    const meta = await res.json();
    if (!meta || typeof meta !== 'object') return null;

    const shaShort = typeof meta.shaShort === 'string' ? meta.shaShort : null;
    const sha = typeof meta.sha === 'string' ? meta.sha : null;
    const tag = typeof meta.tag === 'string' ? meta.tag : null;

    return { shaShort, sha, tag };
  } catch {
    return null;
  }
}

export function isDevEnabled() {
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('dev') === '1') {
      localStorage.setItem('WCC_DEV', '1');
      return true;
    }
    return localStorage.getItem('WCC_DEV') === '1';
  } catch {
    return false;
  }
}

export async function mountBuildMetaOverlay({
  fetchPath = 'runtime/build_meta.json',
  target = document.body
} = {}) {
  if (!isDevEnabled()) return;

  const meta = await loadBuildMeta(fetchPath);
  const el = document.createElement('div');
  el.id = 'dev-build-overlay';
  el.style.position = 'fixed';
  el.style.left = '8px';
  el.style.bottom = '8px';
  el.style.padding = '6px 8px';
  el.style.font = '12px monospace';
  el.style.background = 'rgba(0,0,0,0.55)';
  el.style.color = '#fff';
  el.style.zIndex = '9999';
  el.style.borderRadius = '6px';
  el.style.pointerEvents = 'none';

  const sha = meta?.shaShort || meta?.sha || 'local';
  const tag = meta?.tag ? ` ${meta.tag}` : '';
  el.textContent = `Build: ${sha}${tag}`;

  target.appendChild(el);
}
