/* ══════════════════════════════════════════════════════
   Docker Buddy — Single-Page App
   ══════════════════════════════════════════════════════ */

// ── Utils ────────────────────────────────────────────────────────────────────

function $(sel, ctx = document) { return ctx.querySelector(sel); }
function $$(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }

function fmtSize(mb) {
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
  return mb + ' MB';
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

function fmtDateTime(iso) {
  if (!iso || iso.startsWith('0001')) return '—';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString();
}

function fmtAgo(iso) {
  if (!iso || iso.startsWith('0001')) return '';
  const secs = Math.round((Date.now() - new Date(iso)) / 1000);
  if (isNaN(secs)) return '';
  if (secs < 60) return 'just now';
  const units = [['d', 86400], ['h', 3600], ['m', 60]];
  for (const [u, n] of units) if (secs >= n) return `${Math.floor(secs / n)}${u} ago`;
  return '';
}

function statusColor(state) {
  if (!state) return 'gray';
  const s = state.toLowerCase();
  if (s.includes('running') || s.includes('up')) return 'green';
  if (s.includes('exit') || s.includes('stop')) return 'red';
  if (s.includes('restarting') || s.includes('paused') || s.includes('degraded')) return 'orange';
  return 'gray';
}

function statusLabel(state) {
  if (!state) return 'unknown';
  const s = state.toLowerCase();
  if (s.includes('running') || s.includes('up')) return 'running';
  if (s.includes('exit') || s.includes('stop')) return 'stopped';
  if (s.includes('restarting')) return 'restarting';
  if (s.includes('paused')) return 'paused';
  return state;
}

// ── Toast ─────────────────────────────────────────────────────────────────────

const Toast = {
  show(msg, type = 'info', duration = 4000) {
    const c = $('#toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    t.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
    c.appendChild(t);
    setTimeout(() => t.remove(), duration);
  },
  success(m) { this.show(m, 'success'); },
  error(m)   { this.show(m, 'error'); },
  info(m)    { this.show(m, 'info'); },
};

// ── Modal ─────────────────────────────────────────────────────────────────────

const Modal = {
  _el: null,

  open(html) {
    let overlay = $('#modal-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'modal-overlay';
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `<div class="modal">${html}</div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) Modal.close();
      });
    } else {
      $('.modal', overlay).innerHTML = html;
    }
    this._el = overlay;
    requestAnimationFrame(() => overlay.classList.add('open'));
    return $('.modal', overlay);
  },

  close() {
    const overlay = $('#modal-overlay');
    if (overlay) {
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 200);
    }
  },
};

// ── Router ────────────────────────────────────────────────────────────────────

const Router = {
  routes: {},

  on(pattern, handler) {
    this.routes[pattern] = handler;
  },

  navigate(path) {
    history.pushState({}, '', path);
    this._dispatch(path);
  },

  _dispatch(path) {
    for (const [pattern, handler] of Object.entries(this.routes)) {
      const re = new RegExp('^' + pattern.replace(/:[^/]+/g, '([^/]+)') + '$');
      const m = path.match(re);
      if (m) {
        const paramNames = [...pattern.matchAll(/:([^/]+)/g)].map(x => x[1]);
        const params = {};
        paramNames.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
        handler(params);
        return;
      }
    }
  },

  start() {
    window.addEventListener('popstate', () => this._dispatch(location.pathname));
    this._dispatch(location.pathname);
  },
};

// ── Nav highlight ─────────────────────────────────────────────────────────────

function setActiveNav(id) {
  $$('.nav-item, .rail-item').forEach(el => el.classList.remove('active'));
  $$(`[data-nav="${id}"]`).forEach(el => el.classList.add('active'));
}

// ── PAGES ─────────────────────────────────────────────────────────────────────

// ── Dashboard ─────────────────────────────────────────────────────────────────

async function renderDashboard() {
  setActiveNav('dashboard');
  setTopbar('Dockyard', 'Overview of your Docker environment');

  const body = $('#page-body');
  body.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading…</div>`;

  let images = [], stacks = [];
  try {
    [images, stacks] = await Promise.all([API.images.list(), API.stacks.list()]);
  } catch (e) {
    body.innerHTML = errorState(e.message);
    return;
  }

  const running = stacks.filter(s => (s.Status || '').toLowerCase().includes('running')).length;

  body.innerHTML = `
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-label">Total Images</div>
        <div class="stat-value">${images.length}</div>
        <div class="stat-sub">local Docker images</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Stacks</div>
        <div class="stat-value">${stacks.length}</div>
        <div class="stat-sub">${running} running</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Stopped</div>
        <div class="stat-value">${stacks.length - running}</div>
        <div class="stat-sub">inactive stacks</div>
      </div>
    </div>

    <div class="section-block">
      <div class="section-header">
        <span class="section-title">Active Stacks <span class="tag tag-default" style="margin-left:4px">${stacks.length}</span></span>
        <button class="btn btn-primary btn-sm" onclick="Router.navigate('/stacks')">
          View all stacks
        </button>
      </div>
      ${stacks.length === 0 ? `
      <div class="card empty-card">
        <div class="empty-state">
          <div class="empty-state-icon">📦</div>
          <h3>No stacks found</h3>
          <p>Start a Docker Compose or Swarm stack to see it here.</p>
        </div>
      </div>` : `
      <div class="stack-grid">
        ${stacks.map(s => stackCard(s)).join('')}
      </div>`}
    </div>
  `;
}

function stackCard(s) {
  const color = statusColor(s.Status);
  const label = statusLabel(s.Status);
  const svcCount = (s.Status || '').match(/\((\d+)\)/)?.[1] || '?';
  const isSwarm = s.Type === 'swarm';
  return `
    <div class="stack-card" onclick="Router.navigate('/stacks/${encodeURIComponent(s.Name)}')">
      <div class="stack-card-name">
        ${escHtml(s.Name)}
        ${isSwarm ? '<span class="tag tag-accent" style="margin-left:6px;font-size:10px">swarm</span>' : ''}
      </div>
      <div>
        <span class="status-dot">
          <span class="dot dot-${color}"></span>
          <span class="text-${color === 'gray' ? 'muted' : color}">${label}</span>
        </span>
      </div>
      <div class="stack-card-meta">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        ${svcCount} service${svcCount === '1' ? '' : 's'}
        ${isSwarm && s.ServicesDown ? `<span class="text-orange">· ${s.ServicesDown} down</span>` : ''}
      </div>
    </div>`;
}

// ── Images Page ───────────────────────────────────────────────────────────────

async function renderImages() {
  setActiveNav('images');
  setTopbar('Images', 'All Docker images on this host');

  const body = $('#page-body');
  body.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading images…</div>`;

  let images;
  try { images = await API.images.list(); }
  catch (e) { body.innerHTML = errorState(e.message); return; }

  if (images.length === 0) {
    body.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">🖼️</div>
      <h3>No images found</h3><p>Pull some Docker images first.</p>
    </div>`;
    return;
  }

  const untaggedCount = images.filter(i => i.untagged).length;

  body.innerHTML = `
    <div class="table-wrap">
      <div class="table-toolbar">
        <span class="table-toolbar-title">Images <span class="tag tag-default" style="margin-left:6px">${images.length}</span>
          ${untaggedCount ? `<span class="tag tag-orange" style="margin-left:4px" title="Listed after the tagged images">${untaggedCount} untagged</span>` : ''}
        </span>
        <input class="search-input" id="img-search" placeholder="Search images…" />
        <div class="dropdown-wrap" id="add-img-wrap">
          <button class="btn btn-primary btn-sm" onclick="toggleAddImageMenu(event)">
            + Add Image
          </button>
          <div class="dropdown-menu" id="add-img-menu" style="display:none">
            <div class="dropdown-item" onclick="closeAddMenu();openLoadTarModal()">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              Load from TAR
            </div>
            <div class="dropdown-divider"></div>
            <div class="dropdown-item" onclick="closeAddMenu();openPullImageModal()">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
              Pull Images
            </div>
          </div>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Repository</th>
            <th>Tags</th>
            <th>Size</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody id="img-tbody">
          ${images.map(imgRow).join('')}
        </tbody>
      </table>
    </div>`;

  $('#img-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    $$('#img-tbody tr').forEach(tr => {
      tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
}

const IMAGE_HINT_SOURCE = {
  digest: 'registry',
  container: 'in use as',
  label: 'label',
  layers: 'older build?',
};

function imgRow(img) {
  const usedBy = img.used_by || [];
  const usage = usedBy.length
    ? `<span class="tag tag-green" style="font-size:10px" title="${escHtml(usedBy.join('\n'))}">in use · ${usedBy.length}</span>`
    : '';

  let repoCell;
  if (img.untagged) {
    const hint = img.hint;
    repoCell = hint
      ? `<span class="mono" title="${escHtml(hint.detail)}">${escHtml(hint.name)}</span>
         <span class="tag tag-default" style="font-size:10px;margin-left:4px" title="${escHtml(hint.detail)}">${IMAGE_HINT_SOURCE[hint.source] || hint.source}</span>`
      : `<span class="text-muted mono" title="No tag, registry digest, label, or matching tagged image">unknown image</span>`;
  } else {
    const repoShort = img.repository.length > 50 ? '…' + img.repository.slice(-48) : img.repository;
    repoCell = `<span class="mono" title="${escHtml(img.repository)}">${escHtml(repoShort)}</span>`;
  }

  const tags = img.untagged
    ? `<span class="tag tag-orange" title="This image has no tag — usually replaced by a newer pull/build of the same tag">untagged</span>`
    : img.tags.map(t => `<span class="tag tag-accent">${escHtml(t)}</span>`).join('');

  return `
    <tr${img.untagged ? ' class="row-untagged"' : ''}>
      <td>
        ${repoCell}
        <br><span class="text-muted mono" style="font-size:10px">${escHtml(img.id)}</span>
        ${usage ? ` ${usage}` : ''}
      </td>
      <td>${tags || '<span class="text-muted">—</span>'}</td>
      <td><span class="text-muted">${fmtSize(img.size_mb)}</span></td>
      <td><span class="text-muted">${fmtDate(img.created)}</span></td>
    </tr>`;
}

// ── Containers Page ───────────────────────────────────────────────────────────

async function renderContainers() {
  setActiveNav('containers');
  setTopbar('Containers', 'All Docker containers on this host');

  const body = $('#page-body');
  body.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading containers…</div>`;

  let containers;
  try { containers = await API.containers.list(); }
  catch (e) { body.innerHTML = errorState(e.message); return; }

  if (containers.length === 0) {
    body.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📦</div>
      <h3>No containers found</h3><p>Run a container to see it here.</p>
    </div>`;
    return;
  }

  body.innerHTML = `
    <div class="table-wrap">
      <div class="table-toolbar">
        <span class="table-toolbar-title">Containers <span class="tag tag-default" style="margin-left:6px">${containers.length}</span></span>
        <input class="search-input" id="ctr-search" placeholder="Search containers…" />
        <button class="btn btn-ghost btn-sm" onclick="renderContainers()">⟳ Refresh</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Image</th>
            <th>Status</th>
            <th>Ports</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="ctr-tbody">
          ${containers.map(containerRow).join('')}
        </tbody>
      </table>
    </div>`;

  $('#ctr-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    $$('#ctr-tbody tr').forEach(tr => {
      tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
}

function containerRow(c) {
  const color = statusColor(c.state);
  const label = statusLabel(c.state);
  const isRunning = color === 'green';
  return `
    <tr>
      <td>
        <span class="mono">${escHtml(c.name)}</span>
        <br><span class="text-muted mono" style="font-size:10px">${escHtml(c.id)}</span>
      </td>
      <td><span class="mono text-muted" title="${escHtml(c.image)}">${escHtml(c.image)}</span></td>
      <td>
        <span class="status-dot">
          <span class="dot dot-${color}"></span>
          <span class="text-${color === 'gray' ? 'muted' : color}">${label}</span>
        </span>
      </td>
      <td><span class="text-muted">${c.ports.length ? escHtml(c.ports.join(', ')) : '—'}</span></td>
      <td>
        <div class="flex gap-2" style="justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" onclick="openContainerLogs('${escHtml(c.id)}', '${escHtml(c.name)}')">
            Logs
          </button>
          <button class="btn btn-ghost btn-sm" onclick="openContainerEnv('${escHtml(c.id)}', '${escHtml(c.name)}')">
            Env
          </button>
          ${isRunning
            ? `<button class="btn btn-danger btn-sm" onclick="confirmStopContainer('${escHtml(c.id)}', '${escHtml(c.name)}')">Stop</button>`
            : `<button class="btn btn-primary btn-sm" onclick="doStartContainer('${escHtml(c.id)}', '${escHtml(c.name)}')">Start</button>`
          }
        </div>
      </td>
    </tr>`;
}

async function openContainerLogs(id, name) {
  const modal = Modal.open(`
    <div class="modal-header">
      <span class="modal-title">Logs — ${escHtml(name)}</span>
      <button class="btn-icon" onclick="Modal.close()">✕</button>
    </div>
    <div class="modal-body">
      <div class="pull-output" id="ctr-log-view" style="max-height:420px">Loading logs…</div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="openContainerLogs('${escHtml(id)}','${escHtml(name)}')">⟳ Refresh</button>
      <button class="btn btn-primary" onclick="Modal.close()">Close</button>
    </div>
  `);

  try {
    const res = await API.containers.logs(id);
    const view = $('#ctr-log-view');
    if (view) {
      view.textContent = res.logs || '(no output)';
      view.scrollTop = view.scrollHeight;
    }
  } catch (e) {
    const view = $('#ctr-log-view');
    if (view) view.textContent = `Failed to load logs: ${e.message}`;
  }
}

// Masked until "Show secrets" is ticked: secret-looking names, plus any value with
// credentials embedded in a URL (postgres://user:pass@host). Names that are just
// endpoints (…_TOKEN_URL) or counts (…_TOKENS) aren't secrets on their own.
const SECRET_KEY_RE = /pass(wd|word)?|secret|token|credential|dsn|(^|_)(api|access|private|secret|signing|encryption|master)_?key$|_key$|^key$/i;
const NOT_SECRET_KEY_RE = /_(url|uri|endpoint|tokens)$/i;
const URL_CREDENTIALS_RE = /:\/\/[^/\s:@]+:[^@\s]+@/;

function isSecretEnv(e) {
  return URL_CREDENTIALS_RE.test(e.value) || (SECRET_KEY_RE.test(e.key) && !NOT_SECRET_KEY_RE.test(e.key));
}

async function openContainerEnv(id, name) {
  Modal.open(`
    <div class="modal-header env-view">
      <span class="modal-title">Env — ${escHtml(name)}</span>
      <button class="btn-icon" onclick="Modal.close()">✕</button>
    </div>
    <div class="modal-body">
      <div class="flex items-center gap-2 mb-3">
        <input class="search-input" id="env-search" placeholder="Search variables…" style="flex:1" />
        <label class="flex items-center gap-2 text-muted" style="font-size:12px;cursor:pointer;white-space:nowrap">
          <input type="checkbox" id="env-reveal" /> Show secrets
        </label>
      </div>
      <div class="env-list" id="env-list"><div class="text-muted">Loading…</div></div>
    </div>
    <div class="modal-footer">
      <span class="text-muted mr-auto" id="env-count" style="font-size:12px;margin-right:auto"></span>
      <button class="btn btn-primary" onclick="Modal.close()">Close</button>
    </div>
  `);

  let env;
  try { env = (await API.containers.env(id)).env; }
  catch (e) { $('#env-list').innerHTML = `<div style="color:var(--red)">Failed to load env: ${escHtml(e.message)}</div>`; return; }

  window._envVars = env;
  const render = () => renderEnvList($('#env-search').value.trim().toLowerCase(), $('#env-reveal').checked);
  $('#env-search').addEventListener('input', render);
  $('#env-reveal').addEventListener('change', render);
  render();
  $('#env-search').focus();
}

function renderEnvList(q, reveal) {
  const env = window._envVars || [];
  // Hidden values stay unsearchable so a search can't be used to probe them
  const shown = env.filter(e => !q || e.key.toLowerCase().includes(q)
    || ((reveal || !isSecretEnv(e)) && e.value.toLowerCase().includes(q)));
  $('#env-count').textContent = q ? `${shown.length} of ${env.length} variables` : `${env.length} variables`;
  $('#env-list').innerHTML = shown.length ? shown.map(e => {
    const i = env.indexOf(e);
    const masked = !reveal && e.value && isSecretEnv(e);
    return `
      <div class="env-row">
        <span class="env-key mono">${escHtml(e.key)}</span>
        <span class="env-val mono${masked ? ' text-muted' : ''}">${masked ? '••••••••' : escHtml(e.value) || '<span class="text-muted">(empty)</span>'}</span>
        <button class="btn-icon" title="Copy value" onclick="copyEnvValue(${i})">⧉</button>
      </div>`;
  }).join('') : `<div class="text-muted">No variables match.</div>`;
}

async function copyEnvValue(i) {
  const e = (window._envVars || [])[i];
  if (!e) return;
  try { await navigator.clipboard.writeText(e.value); Toast.success(`Copied ${escHtml(e.key)}`); }
  catch { Toast.error('Clipboard not available'); }
}

function confirmStopContainer(id, name) {
  Modal.open(`
    <div class="modal-header">
      <span class="modal-title">Stop Container</span>
      <button class="btn-icon" onclick="Modal.close()">✕</button>
    </div>
    <div class="modal-body">
      <p style="font-size:13px">Stop <strong>${escHtml(name)}</strong>? It will no longer be running until started again.</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-danger" id="stop-ctr-btn" onclick="doStopContainer('${escHtml(id)}', '${escHtml(name)}')">Stop Container</button>
    </div>
  `);
}

async function doStopContainer(id, name) {
  const btn = $('#stop-ctr-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Stopping…'; }
  try {
    await API.containers.stop(id);
    Toast.success(`Stopped ${name}`);
    Modal.close();
    renderContainers();
  } catch (e) {
    Toast.error(e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Stop Container'; }
  }
}

async function doStartContainer(id, name) {
  try {
    await API.containers.start(id);
    Toast.success(`Started ${name}`);
    renderContainers();
  } catch (e) {
    Toast.error(e.message);
  }
}

// ── Stacks List Page ──────────────────────────────────────────────────────────

async function renderStacks() {
  setActiveNav('stacks');
  setTopbar('Stacks', 'Docker Compose & Swarm stacks on this host');

  const body = $('#page-body');
  body.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading stacks…</div>`;

  let stacks;
  try { stacks = await API.stacks.list(); }
  catch (e) { body.innerHTML = errorState(e.message); return; }

  if (stacks.length === 0) {
    body.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📦</div>
      <h3>No stacks found</h3>
      <p>Run <code>docker compose up -d</code> or <code>docker stack deploy</code> to start a stack.</p>
    </div>`;
    return;
  }

  body.innerHTML = `
    <div class="flex items-center gap-2 mb-5">
      <span style="font-size:15px;font-weight:700;">All Stacks</span>
      <span class="tag tag-default">${stacks.length}</span>
    </div>
    <div class="stack-grid">
      ${stacks.map(s => stackCard(s)).join('')}
    </div>`;
}

// ── Stack Detail Page ─────────────────────────────────────────────────────────

async function renderStackDetail({ name }) {
  setActiveNav('stacks');
  setTopbar('Stack', name, [
    { label: 'Stacks', href: '/stacks' },
    { label: name },
  ]);

  const body = $('#page-body');
  body.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading stack…</div>`;

  let stack;
  try { stack = await API.stacks.get(name); }
  catch (e) { body.innerHTML = errorState(e.message); return; }

  // Collect service names from compose data and running containers
  const serviceImages = stack.service_images || {};
  const serviceNames = Object.keys(serviceImages);

  // Map running container data by service name
  const svcStatus = {};
  (stack.services || []).forEach(s => {
    const sn = s.Service || s.Name;
    if (sn) svcStatus[sn] = s;
  });

  // Merge: all services from compose + any running containers
  const allServices = [...new Set([...serviceNames, ...Object.keys(svcStatus)])];

  const color = statusColor(stack.status);
  const isSwarm = stack.type === 'swarm';
  const runningCount = allServices.filter(sn => isServiceRunning(svcStatus[sn])).length;

  body.innerHTML = `
    <div class="flex items-center gap-2 mb-5">
      <button class="btn btn-ghost btn-sm" onclick="Router.navigate('/stacks')">
        ← Back
      </button>
      <div class="flex items-center gap-2" style="margin-left:8px">
        <span class="dot dot-${color}"></span>
        <span style="font-size:16px;font-weight:700;">${escHtml(name)}</span>
        <span class="tag tag-default">${escHtml(stack.status || 'unknown')}</span>
        ${isSwarm ? '<span class="tag tag-accent">swarm</span>' : ''}
      </div>
      <div class="ml-auto flex gap-2">
        ${isSwarm ? '' : `
        <a href="${API.stacks.downloadComposeUrl(name)}" download="${escHtml(name)}-compose.yml"
           class="btn btn-ghost btn-sm">
          ↓ Download Compose
        </a>`}
        <button class="btn btn-primary btn-sm" onclick="openDeployCompose('${escHtml(name)}', '${escHtml(stack.type)}')">
          ⇪ Deploy New Compose
        </button>
      </div>
    </div>

    <div class="card mb-5">
      <div class="card-header">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
        <h3>Services <span class="tag tag-default" style="margin-left:4px" id="svc-count">${allServices.length}</span></h3>
        ${allServices.length ? `
          <div class="seg-control ml-auto" id="svc-filter">
            <button data-filter="all">All <span class="seg-count">${allServices.length}</span></button>
            <button data-filter="running">Running <span class="seg-count">${runningCount}</span></button>
            <button data-filter="down">Not running <span class="seg-count">${allServices.length - runningCount}</span></button>
          </div>
          <input class="search-input" id="svc-search" placeholder="Search services, images…" />` : ''}
      </div>
      ${allServices.length === 0
        ? `<div class="empty-state" style="padding:28px"><p>No services found.</p></div>`
        : `<div id="svc-list">${allServices.map(sn => serviceRow(name, sn, serviceImages[sn] || '', svcStatus[sn])).join('')}</div>
           <div class="empty-state" id="svc-no-match" style="padding:28px;display:none"><p>No services match.</p></div>`
      }
    </div>

    ${stack.config_file ? `
    <div class="card">
      <div class="card-header">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <h3>Compose File</h3>
        <span class="ml-auto mono text-muted" style="font-size:11px">${escHtml(stack.config_file)}</span>
      </div>
    </div>` : ''}
  `;

  if (!allServices.length) return;

  let filter = 'all';
  try { filter = localStorage.getItem('svc-filter') || 'all'; } catch {}

  const applyServiceFilters = () => {
    const q = $('#svc-search').value.trim().toLowerCase();
    let shown = 0;
    $$('#svc-list .service-row').forEach(row => {
      const running = row.dataset.running === '1';
      const match = row.dataset.search.includes(q)
        && (filter === 'all' || (filter === 'running') === running);
      row.style.display = match ? '' : 'none';
      if (match) shown++;
    });
    $$('#svc-filter button').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
    const filtered = q || filter !== 'all';
    $('#svc-count').textContent = filtered ? `${shown} / ${allServices.length}` : allServices.length;
    $('#svc-no-match').style.display = shown ? 'none' : '';
  };

  $$('#svc-filter button').forEach(b => b.addEventListener('click', () => {
    filter = b.dataset.filter;
    try { localStorage.setItem('svc-filter', filter); } catch {}
    applyServiceFilters();
  }));
  $('#svc-search').addEventListener('input', applyServiceFilters);
  applyServiceFilters();
}

// Fully up: every desired replica running (swarm) or the container running (compose)
function isServiceRunning(status) {
  if (!status) return false;
  if (status.Replicas !== undefined) return status.Desired > 0 && status.Running >= status.Desired;
  return statusColor(status.State || status.Status || '') === 'green';
}

function serviceRow(stackName, svcName, currentImage, status) {
  const color = status ? statusColor(status.State || status.Status || '') : 'gray';
  // Swarm services carry their replica count in State, e.g. "running (1/1)"
  const label = status
    ? (status.Replicas ? status.State : statusLabel(status.State || status.Status || ''))
    : 'not deployed';
  const ports = status?.Publishers?.map(p => `${p.PublishedPort || ''}:${p.TargetPort}`).filter(Boolean).join(', ') || '';

  const searchText = [svcName, currentImage, label, ports].join(' ').toLowerCase();

  return `
    <div class="service-row service-row-link" data-search="${escHtml(searchText)}" data-running="${isServiceRunning(status) ? 1 : 0}"
      onclick="Router.navigate('/stacks/${encodeURIComponent(stackName)}/services/${encodeURIComponent(svcName)}')">
      <div>
        <div class="service-name">${escHtml(svcName)}</div>
        <div class="status-dot" style="margin-top:3px">
          <span class="dot dot-${color}"></span>
          <span class="text-muted" style="font-size:11px">${label}</span>
          ${ports ? `<span class="tag tag-default" style="margin-left:4px;font-size:10px">${escHtml(ports)}</span>` : ''}
        </div>
      </div>
      <div class="service-image" title="${escHtml(currentImage)}">${escHtml(currentImage || '—')}</div>
      <button class="btn btn-ghost btn-sm"
        onclick="event.stopPropagation();confirmRestartService('${escHtml(stackName)}', '${escHtml(svcName)}', ${status?.Replicas !== undefined})">
        ⟲ Restart
      </button>
      <button class="btn btn-ghost btn-sm"
        onclick="event.stopPropagation();openUpdateImage('${escHtml(stackName)}', '${escHtml(svcName)}', '${escHtml(currentImage)}')">
        Update Image
      </button>
      <span class="text-muted" style="font-size:16px">›</span>
    </div>`;
}

// ── Service Detail Page ───────────────────────────────────────────────────────

async function renderServiceDetail({ name, service }) {
  setActiveNav('stacks');
  const stackPath = `/stacks/${encodeURIComponent(name)}`;
  setTopbar('Service', service, [
    { label: 'Stacks', href: '/stacks' },
    { label: name, href: stackPath },
    { label: service },
  ]);

  const body = $('#page-body');
  body.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading service…</div>`;

  let svc;
  try { svc = await API.stacks.service(name, service); }
  catch (e) { body.innerHTML = errorState(e.message); return; }

  const containers = svc.containers || [];
  const latest = containers.find(c => c.state === 'running') || containers[0];
  const details = Object.entries(svc.details || {}).filter(([, v]) => v !== '' && v != null);
  const image = svc.details?.Image || '';
  const headColor = latest ? statusColor(latest.state) : 'gray';

  body.innerHTML = `
    <div class="flex items-center gap-2 mb-5">
      <button class="btn btn-ghost btn-sm" onclick="Router.navigate('${stackPath}')">← Back</button>
      <div class="flex items-center gap-2" style="margin-left:8px">
        <span class="dot dot-${headColor}"></span>
        <span style="font-size:16px;font-weight:700;">${escHtml(service)}</span>
        ${svc.details?.Replicas ? `<span class="tag tag-default">${escHtml(svc.details.Replicas)}</span>` : ''}
        ${svc.type === 'swarm' ? '<span class="tag tag-accent">swarm</span>' : ''}
      </div>
      <div class="ml-auto flex gap-2">
        <button class="btn btn-ghost btn-sm" onclick="renderServiceDetail({ name: '${escHtml(name)}', service: '${escHtml(service)}' })">⟳ Refresh</button>
        <button class="btn btn-ghost btn-sm" onclick="confirmRestartService('${escHtml(name)}', '${escHtml(service)}', ${svc.type === 'swarm'})">⟲ Restart</button>
        <button class="btn btn-primary btn-sm" onclick="openUpdateImage('${escHtml(name)}', '${escHtml(service)}', '${escHtml(image)}')">Update Image</button>
      </div>
    </div>

    <div class="card mb-5">
      <div class="card-header"><h3>Details</h3></div>
      <div class="kv-grid">
        ${details.map(([k, v]) => `
          <div class="kv-key">${escHtml(k)}</div>
          <div class="kv-val mono">${escHtml(['Created', 'Updated'].includes(k) ? `${fmtDateTime(v)}  (${fmtAgo(v)})` : v)}</div>
        `).join('')}
      </div>
    </div>

    <div class="card mb-5">
      <div class="card-header">
        <h3>Latest Container</h3>
        ${latest ? `
          <span class="status-dot" style="margin-left:6px">
            <span class="dot dot-${statusColor(latest.state)}"></span>
            <span class="text-muted" style="font-size:12px">${escHtml(latest.state)} · started ${escHtml(fmtAgo(latest.created) || '—')}</span>
          </span>
          <span class="ml-auto mono text-muted" style="font-size:11px">${escHtml(latest.container_id.slice(0, 12) || 'no container')}</span>` : ''}
      </div>
      <div style="padding:14px 18px">
        ${!latest ? `<p class="text-muted">This service has no containers.</p>`
          : !latest.exists ? `<p class="text-muted">The latest container is not on this node anymore${latest.message ? ` — ${escHtml(latest.message)}` : ''}.</p>`
          : `
          <div class="flex items-center gap-2 mb-3">
            <span class="mono text-muted" style="font-size:12px;flex:1" title="${escHtml(latest.image)}">${escHtml(latest.image)}</span>
            <select class="form-select" id="svc-log-tail" style="width:auto;padding:5px 8px"
              onchange="loadServiceLogs('${escHtml(latest.container_id)}')">
              <option value="100">Last 100 lines</option>
              <option value="300" selected>Last 300 lines</option>
              <option value="1000">Last 1000 lines</option>
              <option value="5000">Last 5000 lines</option>
            </select>
            <button class="btn btn-ghost btn-sm" onclick="loadServiceLogs('${escHtml(latest.container_id)}')">⟳ Refresh logs</button>
            <button class="btn btn-ghost btn-sm" onclick="openContainerEnv('${escHtml(latest.container_id)}', '${escHtml(latest.name + ' · ' + latest.container_id.slice(0, 12))}')">Env</button>
          </div>
          <div class="pull-output" id="svc-log-view" style="max-height:460px">Loading logs…</div>`}
      </div>
    </div>

    <div class="table-wrap">
      <div class="table-toolbar">
        <span class="table-toolbar-title">Container History <span class="tag tag-default" style="margin-left:6px">${containers.length}</span></span>
      </div>
      <table>
        <thead>
          <tr><th>State</th><th>Container</th><th>Image</th><th>Created</th><th>Exit / Message</th><th></th></tr>
        </thead>
        <tbody>
          ${containers.length ? containers.map(c => historyRow(c, c === latest)).join('')
            : `<tr><td colspan="6" class="text-muted" style="text-align:center;padding:24px">No containers.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  if (latest?.exists) loadServiceLogs(latest.container_id);
}

function historyRow(c, isLatest) {
  const color = statusColor(c.state);
  const shortId = c.container_id.slice(0, 12);
  const exit = c.exit_code != null && c.state !== 'running' ? `exit ${c.exit_code}` : '';
  const msg = [exit, c.message && c.message !== c.state ? c.message : ''].filter(Boolean).join(' · ');
  return `
    <tr${isLatest ? ' class="row-highlight"' : ''}>
      <td>
        <span class="status-dot">
          <span class="dot dot-${color}"></span>
          <span class="text-${color === 'gray' ? 'muted' : color}">${escHtml(c.state || 'unknown')}</span>
        </span>
        ${isLatest ? '<span class="tag tag-accent" style="margin-left:6px;font-size:10px">latest</span>' : ''}
      </td>
      <td><span class="mono">${escHtml(shortId || '—')}</span>${c.task_id ? `<br><span class="text-muted mono" style="font-size:10px">task ${escHtml(c.task_id)}</span>` : ''}</td>
      <td><span class="mono text-muted" title="${escHtml(c.image)}">${escHtml(c.image)}</span></td>
      <td title="${escHtml(fmtDateTime(c.created))}">${escHtml(fmtAgo(c.created) || fmtDateTime(c.created))}</td>
      <td><span class="text-muted" style="font-size:12px" title="${escHtml(msg)}">${escHtml(msg || '—')}</span></td>
      <td style="text-align:right">
        ${c.exists
          ? `<div class="flex gap-2" style="justify-content:flex-end">
              <button class="btn btn-ghost btn-sm" onclick="openContainerLogs('${escHtml(c.container_id)}', '${escHtml(c.name + ' · ' + shortId)}')">Logs</button>
              <button class="btn btn-ghost btn-sm" onclick="openContainerEnv('${escHtml(c.container_id)}', '${escHtml(c.name + ' · ' + shortId)}')">Env</button>
            </div>`
          : `<span class="text-muted" style="font-size:11px" title="Container was removed from this node">removed</span>`}
      </td>
    </tr>`;
}

async function loadServiceLogs(containerId) {
  const view = $('#svc-log-view');
  if (!view) return;
  const tail = $('#svc-log-tail')?.value || 300;
  view.textContent = 'Loading logs…';
  try {
    const res = await API.containers.logs(containerId, tail);
    view.textContent = res.logs || '(no output)';
    view.scrollTop = view.scrollHeight;
  } catch (e) {
    view.textContent = `Failed to load logs: ${e.message}`;
  }
}

// ── Restart service ───────────────────────────────────────────────────────────

function confirmRestartService(stackName, serviceName, isSwarm) {
  const cmd = isSwarm
    ? `docker service update --force ${stackName}_${serviceName}`
    : `docker restart <${stackName} ${serviceName} containers>`;
  Modal.open(`
    <div class="modal-header">
      <span class="modal-title">Restart ${escHtml(serviceName)}</span>
      <button class="btn-icon" onclick="Modal.close()">✕</button>
    </div>
    <div class="modal-body" id="restart-body">
      <p style="font-size:13px;margin-bottom:10px">
        Restart <strong>${escHtml(serviceName)}</strong> in <strong>${escHtml(stackName)}</strong>?
        ${isSwarm
          ? 'Swarm replaces its containers with fresh ones using the same image and config. A single-replica service is briefly unavailable.'
          : 'Its containers are stopped and started again.'}
      </p>
      <div class="pull-output" style="max-height:none">$ ${escHtml(cmd)}</div>
    </div>
    <div class="modal-footer" id="restart-footer">
      <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-danger" id="restart-go">⟲ Restart</button>
    </div>
  `);
  $('#restart-go').onclick = () => doRestartService(stackName, serviceName);
}

async function doRestartService(stackName, serviceName) {
  const body = $('#restart-body');
  const footer = $('#restart-footer');
  body.innerHTML = `<div class="loading-state"><div class="spinner"></div>Restarting ${escHtml(serviceName)} — waiting for the new containers to come up…</div>`;
  footer.innerHTML = '';
  try {
    const res = await API.stacks.restartService(stackName, serviceName);
    Toast.success(`Restarted ${escHtml(serviceName)}`);
    Modal.close();
    Router._dispatch(location.pathname);
  } catch (e) {
    body.innerHTML = `
      <div style="color:var(--red);font-weight:600;margin-bottom:8px">✕ Restart failed</div>
      <div class="pull-output" style="color:#f87171;max-height:300px">${escHtml(e.message)}</div>`;
    footer.innerHTML = `<button class="btn btn-primary" onclick="Modal.close();Router._dispatch(location.pathname)">Close</button>`;
    Toast.error(`Restart of ${escHtml(serviceName)} failed`);
  }
}

// ── Modals ────────────────────────────────────────────────────────────────────

async function openUpdateImage(stackName, serviceName, currentImage) {
  Modal.open(`
    <div class="modal-header">
      <span class="modal-title">Update Service Image</span>
      <button class="btn-icon" onclick="Modal.close()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Stack / Service</label>
        <div class="mono" style="color:var(--text-muted)">${escHtml(stackName)} / ${escHtml(serviceName)}</div>
      </div>
      <div class="form-group">
        <label class="form-label">Current Image</label>
        <div class="mono" style="color:var(--text-muted)">${escHtml(currentImage || '—')}</div>
      </div>

      <div class="tab-bar">
        <div class="tab active" data-tab="pick" onclick="switchTab(event,'pick')">Pick from Images</div>
        <div class="tab" data-tab="manual" onclick="switchTab(event,'manual')">Type Manually</div>
      </div>

      <div id="tab-pick">
        <div class="form-group">
          <input class="form-input" id="img-filter" placeholder="Filter images…" oninput="filterImageOptions(this.value)" />
        </div>
        <div class="image-select-grid" id="img-option-list">
          <div class="loading-state"><div class="spinner"></div></div>
        </div>
      </div>

      <div id="tab-manual" style="display:none">
        <div class="form-group">
          <label class="form-label">Image:Tag</label>
          <input class="form-input" id="manual-image-input" placeholder="e.g. nginx:1.25-alpine"
            value="${escHtml(currentImage || '')}" />
        </div>
      </div>

      <div id="selected-image-preview" style="display:none;margin-top:8px">
        <label class="form-label">Selected</label>
        <div class="mono" id="selected-image-text" style="color:#4f6cf7"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-primary" id="deploy-btn" onclick="deployImageUpdate('${escHtml(stackName)}','${escHtml(serviceName)}')">
        Deploy
      </button>
    </div>
  `);

  window._selectedImage = currentImage || '';

  // Load images for picker
  try {
    const images = await API.images.list();
    window._allImages = images;
    renderImageOptions(images);
  } catch (e) {
    $('#img-option-list').innerHTML = `<div class="text-muted" style="padding:12px">${e.message}</div>`;
  }
}

function switchTab(event, tab) {
  $$('.tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  $('#tab-pick').style.display = tab === 'pick' ? '' : 'none';
  $('#tab-manual').style.display = tab === 'manual' ? '' : 'none';
}

function renderImageOptions(images) {
  const list = $('#img-option-list');
  if (!list) return;
  if (images.length === 0) {
    list.innerHTML = `<div class="text-muted" style="padding:12px">No images found.</div>`;
    return;
  }
  list.innerHTML = images.filter(img => !img.untagged).map(img => {
    return img.tags.map(t => {
      const full = `${img.repository}:${t}`;
      const sel = full === window._selectedImage ? 'selected' : '';
      return `<div class="image-option ${sel}" onclick="selectImageOption(this, '${escHtml(full)}')" data-full="${escHtml(full)}">
        <span class="image-option-name">${escHtml(full)}</span>
        <span class="image-option-size">${fmtSize(img.size_mb)}</span>
      </div>`;
    }).join('');
  }).join('');
}

function filterImageOptions(q) {
  $$('#img-option-list .image-option').forEach(el => {
    el.style.display = el.dataset.full.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
  });
}

function selectImageOption(el, full) {
  $$('#img-option-list .image-option').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  window._selectedImage = full;
  const preview = $('#selected-image-preview');
  if (preview) {
    preview.style.display = '';
    $('#selected-image-text').textContent = full;
  }
}

async function deployImageUpdate(stackName, serviceName) {
  const manualVisible = $('#tab-manual') && $('#tab-manual').style.display !== 'none';
  const image = manualVisible
    ? ($('#manual-image-input').value.trim())
    : window._selectedImage;

  if (!image) { Toast.error('Select or enter an image first.'); return; }

  const btn = $('#deploy-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Deploying…'; }

  try {
    const res = await API.stacks.updateServiceImage(stackName, serviceName, image);
    Modal.close();
    Toast.success(`Deployed ${serviceName} → ${image}`);
    // Show download option (swarm stacks have no compose file to download)
    if (res.type !== 'swarm') setTimeout(() => showPostDeployBanner(stackName), 300);
    // Refresh whichever page we're on (stack or service detail)
    setTimeout(() => Router._dispatch(location.pathname), 800);
  } catch (e) {
    Toast.error(e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Deploy'; }
  }
}

function showPostDeployBanner(stackName) {
  const body = $('#page-body');
  const banner = document.createElement('div');
  banner.style.cssText = `
    background:#eef1ff;border:1px solid rgba(79,108,247,0.35);
    border-radius:8px;padding:14px 18px;margin-bottom:16px;
    display:flex;align-items:center;gap:12px;font-size:13px;
  `;
  banner.innerHTML = `
    <span style="color:#4f6cf7;font-weight:600;">✓ Deployment complete</span>
    <span class="text-muted flex-1">Stack updated successfully.</span>
    <a href="${API.stacks.downloadComposeUrl(stackName)}" download="${escHtml(stackName)}-compose.yml"
       class="btn btn-primary btn-sm">↓ Download Updated Compose</a>
    <button class="btn-icon" onclick="this.parentElement.remove()">✕</button>
  `;
  body.insertBefore(banner, body.firstChild);
}

// ── Deploy new compose (upload or pick a file on the server) ──────────────────

const deployState = { stack: '', type: '', preview: null, browsePath: '', prune: false };

function openDeployCompose(stackName, stackType) {
  Object.assign(deployState, { stack: stackName, type: stackType, preview: null, prune: false });
  let lastDir = '';
  try { lastDir = localStorage.getItem(`deploy-dir:${stackName}`) || ''; } catch {}

  Modal.open(`
    <div class="modal-header deploy-view">
      <span class="modal-title">Deploy New Compose — ${escHtml(stackName)}</span>
      <button class="btn-icon" onclick="Modal.close()">✕</button>
    </div>
    <div class="modal-body" id="deploy-body">
      <div class="tab-bar">
        <div class="tab active" onclick="switchDeployTab(event,'upload')">Upload from this computer</div>
        <div class="tab" onclick="switchDeployTab(event,'browse')">Browse server</div>
      </div>

      <div id="deploy-tab-upload">
        <div class="drop-zone" id="drop-zone" onclick="$('#compose-file-input').click()">
          <div class="drop-zone-icon">📄</div>
          <div>Click or drag a compose file here</div>
          <div class="text-muted" style="font-size:11px;margin-top:4px">
            .yml / .yaml — relative paths in it resolve against the stack's original folder when known
          </div>
        </div>
        <input type="file" id="compose-file-input" accept=".yml,.yaml" style="display:none"
          onchange="if (this.files[0]) previewDeploy({ file: this.files[0] })" />
      </div>

      <div id="deploy-tab-browse" style="display:none">
        <div class="flex gap-2 mb-3">
          <button class="btn btn-ghost btn-sm" id="fs-up" title="Parent folder">↑</button>
          <input class="form-input mono" id="fs-path" style="flex:1;padding:6px 10px;font-size:12px"
            onkeydown="if(event.key==='Enter') browseServer(this.value)" />
          <button class="btn btn-ghost btn-sm" onclick="browseServer('')">Home</button>
          <button class="btn btn-ghost btn-sm" onclick="browseServer('/data')">/data</button>
        </div>
        <div class="fs-list" id="fs-list"><div class="text-muted" style="padding:12px">Loading…</div></div>
        <div class="text-muted" style="font-size:11px;margin-top:6px">
          Showing folders and .yml / .yaml files. The file is deployed in place, so its relative paths keep working.
        </div>
      </div>
    </div>
    <div class="modal-footer" id="deploy-footer">
      <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
    </div>
  `);

  deployState.browsePath = lastDir;
  const dz = $('#drop-zone');
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) previewDeploy({ file: f });
  });
}

function switchDeployTab(event, tab) {
  $$('#deploy-body .tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  $('#deploy-tab-upload').style.display = tab === 'upload' ? '' : 'none';
  $('#deploy-tab-browse').style.display = tab === 'browse' ? '' : 'none';
  if (tab === 'browse' && !$('#fs-list').dataset.loaded) browseServer(deployState.browsePath);
}

async function browseServer(path) {
  const list = $('#fs-list');
  if (!list) return;
  list.innerHTML = `<div class="text-muted" style="padding:12px">Loading…</div>`;
  let res;
  try { res = await API.fs.browse(path); }
  catch (e) {
    list.innerHTML = `<div style="padding:12px;color:var(--red)">${escHtml(e.message)}</div>`;
    return;
  }
  list.dataset.loaded = '1';
  deployState.browsePath = res.path;
  try { localStorage.setItem(`deploy-dir:${deployState.stack}`, res.path); } catch {}

  $('#fs-path').value = res.path;
  const up = $('#fs-up');
  up.disabled = !res.parent;
  up.onclick = () => res.parent && browseServer(res.parent);
  $$('#deploy-body .tab')[1].textContent = `Browse ${res.host}`;

  window._fsEntries = res.entries;
  list.innerHTML = res.entries.length ? res.entries.map((e, i) => `
    <div class="fs-row" onclick="openFsEntry(${i})">
      <span>${e.type === 'dir' ? '📁' : '📄'}</span>
      <span class="fs-name${e.type === 'file' ? ' mono' : ''}">${escHtml(e.name)}</span>
      <span class="text-muted" style="font-size:11px">${e.type === 'file' ? `${(e.size / 1024).toFixed(1)} KB · ` : ''}${new Date(e.modified * 1000).toLocaleDateString()}</span>
    </div>`).join('')
    : `<div class="text-muted" style="padding:12px">No folders or compose files here.</div>`;
}

function openFsEntry(i) {
  const e = (window._fsEntries || [])[i];
  if (!e) return;
  if (e.type === 'dir') browseServer(e.path);
  else previewDeploy({ path: e.path });
}

async function previewDeploy(source) {
  const body = $('#deploy-body');
  const footer = $('#deploy-footer');
  body.innerHTML = `<div class="loading-state"><div class="spinner"></div>Checking compose file against ${escHtml(deployState.stack)}…</div>`;
  footer.innerHTML = '';

  try { deployState.preview = await API.stacks.previewDeploy(deployState.stack, source); }
  catch (e) {
    body.innerHTML = `
      <div style="color:var(--red);font-weight:600;margin-bottom:8px">✕ Can't use this file</div>
      <div class="pull-output" style="color:#f87171;max-height:300px">${escHtml(e.message)}</div>`;
    footer.innerHTML = `<button class="btn btn-ghost" id="deploy-back">← Pick another file</button>`;
    $('#deploy-back').onclick = () => openDeployCompose(deployState.stack, deployState.type);
    return;
  }
  renderDeployPreview();
}

function deploySummary(p) {
  const count = (c) => p.services.filter(s => s.change === c).length;
  return {
    changed: count('changed'),
    added: count('added'),
    unchanged: count('unchanged'),
    missing: p.images.filter(i => !i.present),
    newImages: p.images.filter(i => i.new_to_stack),
  };
}

function renderDeployPreview() {
  const p = deployState.preview;
  const body = $('#deploy-body');
  const footer = $('#deploy-footer');
  const sum = deploySummary(p);
  const isSwarm = p.type === 'swarm';
  const pruneFlag = isSwarm ? '--prune' : '--remove-orphans';
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  const svcRow = (s) => `
    <div class="deploy-svc">
      <span class="deploy-svc-name">${escHtml(s.name)}</span>
      <span class="mono deploy-svc-img">
        ${s.change === 'changed'
          ? `<span class="text-muted">${escHtml(s.current_image)}</span> → <strong>${escHtml(s.image)}</strong>`
          : escHtml(s.image || '(no image — build)')}
      </span>
    </div>`;

  // Not-pulled first, then images new to the stack, then the rest
  const images = [...p.images].sort((a, b) =>
    (a.present - b.present) || (b.new_to_stack - a.new_to_stack) || a.image.localeCompare(b.image));
  const imageRow = (i) => `
    <div class="deploy-img">
      <span title="${i.present ? 'Already on this host' : 'Not on this host yet'}">${i.present ? '✅' : '⬇️'}</span>
      <span class="mono deploy-svc-img">${escHtml(i.image)}</span>
      <span>
        ${i.new_to_stack ? '<span class="tag tag-accent" style="font-size:10px">new to stack</span>' : ''}
        ${i.present ? '' : '<span class="tag tag-orange" style="font-size:10px">not pulled</span>'}
      </span>
      <span class="text-muted" style="font-size:11px" title="${escHtml(i.services.join(', '))}">${escHtml(i.services.length > 2 ? `${i.services.slice(0, 2).join(', ')} +${i.services.length - 2}` : i.services.join(', '))}</span>
    </div>`;

  body.innerHTML = `
    <div class="mb-3" style="font-size:12px">
      <span class="text-muted">${p.source === 'upload' ? 'Uploaded, saved on the server as' : 'Server file'}</span>
      <div class="mono" style="margin-top:2px;word-break:break-all">${escHtml(p.path)}</div>
    </div>

    <div class="flex gap-2 mb-3" style="flex-wrap:wrap">
      <span class="tag ${sum.changed ? 'tag-orange' : 'tag-default'}">${plural(sum.changed, 'image change')}</span>
      <span class="tag ${sum.added ? 'tag-green' : 'tag-default'}">${plural(sum.added, 'new service')}</span>
      <span class="tag ${sum.newImages.length ? 'tag-accent' : 'tag-default'}">${plural(sum.newImages.length, 'new image')}</span>
      <span class="tag ${sum.missing.length ? 'tag-red' : 'tag-green'}">${sum.missing.length ? `${sum.missing.length} not pulled` : 'all images pulled'}</span>
      <span class="tag ${p.not_in_file.length ? 'tag-red' : 'tag-default'}">${p.not_in_file.length} running but not in file</span>
      <span class="tag tag-default">${sum.unchanged} unchanged</span>
    </div>

    ${sum.missing.length ? `
      <div class="deploy-notice">
        <strong>${plural(sum.missing.length, 'image')} ${sum.missing.length === 1 ? "isn't" : "aren't"} pulled on this host yet.</strong>
        Pull ${sum.missing.length === 1 ? 'it' : 'them'} first to catch registry or auth errors before anything changes —
        otherwise docker pulls during the deploy and a failed pull leaves services half-updated.
      </div>` : ''}

    <div class="deploy-group">
      <div class="deploy-group-title">Images in this file (${p.images.length})</div>
      ${images.length ? images.map(imageRow).join('') : '<div class="deploy-svc text-muted">No images — every service builds locally.</div>'}
    </div>

    ${sum.changed ? `<div class="deploy-group"><div class="deploy-group-title">Image changes</div>${p.services.filter(s => s.change === 'changed').map(svcRow).join('')}</div>` : ''}
    ${sum.added ? `<div class="deploy-group"><div class="deploy-group-title">New services</div>${p.services.filter(s => s.change === 'added').map(svcRow).join('')}</div>` : ''}
    ${p.not_in_file.length ? `
      <div class="deploy-group">
        <div class="deploy-group-title">Running but not in this file</div>
        <div style="padding:8px 12px;font-size:12px" class="mono">${p.not_in_file.map(escHtml).join(', ')}</div>
        <label class="flex items-center gap-2" style="padding:0 12px 10px;font-size:12px;cursor:pointer">
          <input type="checkbox" id="deploy-prune" ${deployState.prune ? 'checked' : ''} onchange="deployState.prune = this.checked" />
          <span>Remove these services (<code>${pruneFlag}</code>) — otherwise they keep running untouched</span>
        </label>
      </div>` : ''}
    ${sum.unchanged ? `
      <details class="deploy-group">
        <summary class="deploy-group-title" style="cursor:pointer">Unchanged (${sum.unchanged})</summary>
        ${p.services.filter(s => s.change === 'unchanged').map(svcRow).join('')}
      </details>` : ''}
    ${p.warnings ? `
      <details class="deploy-group" open>
        <summary class="deploy-group-title" style="cursor:pointer;color:var(--orange)">Warnings from docker</summary>
        <div class="pull-output" style="color:#fbbf24;border-radius:0;max-height:140px">${escHtml(p.warnings)}</div>
      </details>` : ''}
    <details class="deploy-group">
      <summary class="deploy-group-title" style="cursor:pointer">View file${p.truncated ? ' (truncated)' : ''}</summary>
      <div class="pull-output" style="color:#e5e7eb;border-radius:0;max-height:320px">${escHtml(p.content)}</div>
    </details>
  `;

  footer.innerHTML = `
    <button class="btn btn-ghost" id="deploy-back" style="margin-right:auto">← Pick another file</button>
    ${sum.missing.length ? `
      <button class="btn btn-ghost" id="deploy-nopull" title="Let docker pull during the deploy">Deploy without pulling</button>
      <button class="btn btn-ghost" id="deploy-pullonly">↓ Pull ${sum.missing.length} only</button>
      <button class="btn btn-primary" id="deploy-go">↓ Pull ${sum.missing.length} &amp; Deploy</button>`
    : `<button class="btn btn-primary" id="deploy-go">⇪ Deploy to ${escHtml(p.stack)}</button>`}
  `;
  $('#deploy-back').onclick = () => openDeployCompose(deployState.stack, deployState.type);
  $('#deploy-go').onclick = () => confirmDeploy(sum.missing.length > 0);
  if (sum.missing.length) {
    $('#deploy-nopull').onclick = () => confirmDeploy(false);
    $('#deploy-pullonly').onclick = () => pullMissingImages(false);
  }
}

function confirmDeploy(withPull) {
  const p = deployState.preview;
  const sum = deploySummary(p);
  const prune = !!deployState.prune;
  const steps = [
    withPull && `Pull <strong>${sum.missing.length}</strong> image${sum.missing.length === 1 ? '' : 's'} that ${sum.missing.length === 1 ? "isn't" : "aren't"} on this host`,
    sum.changed && `Update the image of <strong>${sum.changed}</strong> service${sum.changed === 1 ? '' : 's'}`,
    sum.added && `Create <strong>${sum.added}</strong> new service${sum.added === 1 ? '' : 's'}`,
    p.not_in_file.length && (prune
      ? `<span style="color:var(--red)">Remove <strong>${p.not_in_file.length}</strong> running service${p.not_in_file.length === 1 ? '' : 's'} not in the file</span>`
      : `Leave <strong>${p.not_in_file.length}</strong> service${p.not_in_file.length === 1 ? '' : 's'} not in the file running`),
    `Apply the rest of the file to <strong>${sum.unchanged}</strong> unchanged service${sum.unchanged === 1 ? '' : 's'} (only those whose config differs restart)`,
  ].filter(Boolean);

  const footer = $('#deploy-footer');
  footer.innerHTML = `
    <div class="deploy-confirm">
      <div style="font-weight:600;margin-bottom:6px">Deploy to <span class="mono">${escHtml(p.stack)}</span>? This will:</div>
      <ul>${steps.map(s => `<li>${s}</li>`).join('')}</ul>
    </div>
    <button class="btn btn-ghost" id="deploy-cancel">Cancel</button>
    <button class="btn ${prune && p.not_in_file.length ? 'btn-danger' : 'btn-primary'}" id="deploy-confirm">
      Yes, ${withPull ? 'pull &amp; deploy' : 'deploy'}
    </button>
  `;
  $('#deploy-cancel').onclick = renderDeployPreview;
  $('#deploy-confirm').onclick = () => withPull ? pullMissingImages(true) : runDeploy();
}

async function pullMissingImages(thenDeploy) {
  const p = deployState.preview;
  const missing = p.images.filter(i => !i.present);
  const body = $('#deploy-body');
  const footer = $('#deploy-footer');
  body.innerHTML = `
    <div style="margin-bottom:12px;font-size:13px;font-weight:600">
      Pulling ${missing.length} image${missing.length === 1 ? '' : 's'}${thenDeploy ? ` — then deploying ${escHtml(p.stack)}` : ''}…
    </div>
    <div class="tar-file-list">
      ${missing.map((m, i) => `
        <div class="tar-file-item">
          <span id="dpull-icon-${i}" style="font-size:16px">⏳</span>
          <span class="tar-file-name mono">${escHtml(m.image)}</span>
          <span class="tar-file-size" id="dpull-status-${i}">waiting…</span>
        </div>`).join('')}
    </div>
    <div id="dpull-errors"></div>
  `;
  footer.innerHTML = '';

  const errors = [];
  for (let i = 0; i < missing.length; i++) {
    const icon = $(`#dpull-icon-${i}`);
    const status = $(`#dpull-status-${i}`);
    status.textContent = 'pulling…';
    try {
      await API.images.pull(missing[i].image);
      icon.textContent = '✅';
      status.textContent = 'pulled';
      status.style.color = 'var(--green)';
    } catch (e) {
      errors.push(`${missing[i].image}\n  ${e.message.trim()}`);
      icon.textContent = '❌';
      status.textContent = 'failed';
      status.title = e.message;
      status.style.color = 'var(--red)';
    }
  }

  if (!errors.length) {
    Toast.success(`Pulled ${missing.length} image${missing.length === 1 ? '' : 's'}`);
    if (thenDeploy) return runDeploy();
    return previewDeploy({ path: p.path });   // re-check: everything should now show as pulled
  }

  $('#dpull-errors').innerHTML = `
    <div style="color:var(--red);font-weight:600;margin:14px 0 8px">✕ ${errors.length} pull${errors.length === 1 ? '' : 's'} failed — nothing has been deployed</div>
    <div class="pull-output" style="color:#f87171;max-height:240px">${escHtml(errors.join('\n\n'))}</div>`;
  footer.innerHTML = `
    <button class="btn btn-ghost" id="dpull-back" style="margin-right:auto">← Back to preview</button>
    ${thenDeploy ? '<button class="btn btn-ghost" id="dpull-anyway" title="Docker will try to pull them again during the deploy">Deploy anyway</button>' : ''}
  `;
  $('#dpull-back').onclick = () => previewDeploy({ path: p.path });
  if (thenDeploy) $('#dpull-anyway').onclick = runDeploy;
  Toast.error('Some images failed to pull');
}

async function runDeploy() {
  const p = deployState.preview;
  if (!p) return;
  const prune = !!deployState.prune;
  const body = $('#deploy-body');
  const footer = $('#deploy-footer');
  body.innerHTML = `<div class="loading-state"><div class="spinner"></div>Deploying ${escHtml(p.stack)}… this can take a few minutes.</div>`;
  footer.innerHTML = '';

  try {
    const res = await API.stacks.deploy(p.stack, p.path, prune);
    body.innerHTML = `
      <div style="color:var(--green);font-weight:600;margin-bottom:8px">✓ Deployed ${escHtml(p.stack)}</div>
      <div class="mono text-muted" style="font-size:11px;margin-bottom:8px;word-break:break-all">$ ${escHtml(res.command)}</div>
      <div class="pull-output" style="max-height:320px">${escHtml(res.output || '(no output)')}</div>`;
    footer.innerHTML = `<button class="btn btn-primary" onclick="Modal.close();Router._dispatch(location.pathname)">✓ Done — Refresh</button>`;
    Toast.success(`Deployed ${escHtml(p.stack)}`);
  } catch (e) {
    body.innerHTML = `
      <div style="color:var(--red);font-weight:600;margin-bottom:8px">✕ Deploy failed</div>
      <div class="pull-output" style="color:#f87171;max-height:320px">${escHtml(e.message)}</div>`;
    footer.innerHTML = `
      <button class="btn btn-ghost" onclick="Modal.close();Router._dispatch(location.pathname)">Close</button>
      <button class="btn btn-primary" id="deploy-retry">← Back to preview</button>`;
    $('#deploy-retry').onclick = () => previewDeploy({ path: p.path });
    Toast.error('Deploy failed');
  }
}

// ── Add Image dropdown ────────────────────────────────────────────────────────

function toggleAddImageMenu(e) {
  e.stopPropagation();
  const menu = $('#add-img-menu');
  if (!menu) return;
  const open = menu.style.display !== 'none';
  menu.style.display = open ? 'none' : 'block';
  if (!open) {
    const close = (ev) => { if (!$('#add-img-wrap')?.contains(ev.target)) { menu.style.display = 'none'; document.removeEventListener('click', close); } };
    document.addEventListener('click', close);
  }
}

function closeAddMenu() {
  const menu = $('#add-img-menu');
  if (menu) menu.style.display = 'none';
}

// ── Load from TAR modal ───────────────────────────────────────────────────────

function openLoadTarModal() {
  Modal.open(`
    <div class="modal-header">
      <span class="modal-title">Load Image from TAR</span>
      <button class="btn-icon" onclick="Modal.close()">✕</button>
    </div>
    <div class="modal-body" id="tar-modal-body">
      <p class="text-muted" style="font-size:13px;margin-bottom:16px">
        Choose how you want to load the Docker image TAR file.
      </p>
      <div class="source-options">
        <div class="source-card" onclick="triggerTarFilePicker()">
          <div class="source-card-icon">📄</div>
          <div class="source-card-label">Select TAR File</div>
          <div class="source-card-sub">Pick a single .tar file</div>
        </div>
        <div class="source-card" onclick="triggerFolderPicker()">
          <div class="source-card-icon">📁</div>
          <div class="source-card-label">Scan Folder</div>
          <div class="source-card-sub">Find all .tar files in a folder</div>
        </div>
      </div>
      <input type="file" id="tar-file-input" accept=".tar" style="display:none" onchange="onTarFileSelected(this)" />
      <input type="file" id="tar-folder-input" webkitdirectory style="display:none" onchange="onFolderSelected(this)" />
    </div>
    <div class="modal-footer" id="tar-modal-footer">
      <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
    </div>
  `);
}

function triggerTarFilePicker() {
  $('#tar-file-input')?.click();
}

function triggerFolderPicker() {
  $('#tar-folder-input')?.click();
}

function onTarFileSelected(input) {
  const file = input.files[0];
  if (!file) return;
  window._tarFiles = [file];
  const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
  $('#tar-modal-body').innerHTML = `
    <p class="text-muted" style="font-size:13px;margin-bottom:14px">
      Review the selected TAR file before loading.
    </p>
    <div class="confirm-file-box">
      <div class="confirm-file-icon">📦</div>
      <div>
        <div class="confirm-file-name">${escHtml(file.name)}</div>
        <div class="confirm-file-size">${sizeMb} MB</div>
      </div>
    </div>
  `;
  $('#tar-modal-footer').innerHTML = `
    <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
    <button class="btn btn-primary" onclick="loadTarFiles()">Load Image →</button>
  `;
}

function onFolderSelected(input) {
  const allFiles = [...input.files];
  const tarFiles = allFiles.filter(f => f.name.toLowerCase().endsWith('.tar'));
  window._tarFiles = tarFiles;

  if (tarFiles.length === 0) {
    $('#tar-modal-body').innerHTML = `
      <div class="empty-state" style="padding:32px">
        <div class="empty-state-icon">🔍</div>
        <h3>No TAR files found</h3>
        <p>The selected folder contains no .tar files.</p>
      </div>`;
    return;
  }

  renderFolderTarList(tarFiles);
}

function renderFolderTarList(tarFiles) {
  const folder = tarFiles[0]?.webkitRelativePath?.split('/')[0] || 'folder';
  const listHtml = tarFiles.map((f, i) => {
    const sizeMb = (f.size / (1024 * 1024)).toFixed(1);
    return `
      <div class="tar-file-item">
        <input type="checkbox" id="tar-chk-${i}" checked onchange="updateTarLoadBtn()" />
        <label class="tar-file-name" for="tar-chk-${i}">${escHtml(f.name)}</label>
        <span class="tar-file-size">${sizeMb} MB</span>
      </div>`;
  }).join('');

  $('#tar-modal-body').innerHTML = `
    <div class="flex items-center gap-2 mb-4" style="justify-content:space-between">
      <span class="text-muted" style="font-size:12px">Found <strong>${tarFiles.length}</strong> TAR file${tarFiles.length > 1 ? 's' : ''} in <em>${escHtml(folder)}</em></span>
      <div class="flex gap-2">
        <button class="btn btn-ghost btn-sm" onclick="setAllTarChecks(true)">Select All</button>
        <button class="btn btn-ghost btn-sm" onclick="setAllTarChecks(false)">Deselect All</button>
      </div>
    </div>
    <div class="tar-file-list">${listHtml}</div>
  `;
  $('#tar-modal-footer').innerHTML = `
    <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
    <button class="btn btn-primary" id="tar-load-btn" onclick="loadTarFiles()">
      Load Selected (${tarFiles.length})
    </button>
  `;
}

function setAllTarChecks(checked) {
  $$('#tar-modal-body input[type=checkbox]').forEach(cb => { cb.checked = checked; });
  updateTarLoadBtn();
}

function updateTarLoadBtn() {
  const checked = $$('#tar-modal-body input[type=checkbox]:checked').length;
  const btn = $('#tar-load-btn');
  if (btn) {
    btn.textContent = checked > 0 ? `Load Selected (${checked})` : 'Load Selected';
    btn.disabled = checked === 0;
  }
}

async function loadTarFiles() {
  const tarFiles = window._tarFiles || [];
  if (!tarFiles.length) return;

  // Single file — pick only that one; folder — pick checked ones
  const checkboxes = $$('#tar-modal-body input[type=checkbox]');
  const toLoad = checkboxes.length > 0
    ? tarFiles.filter((_, i) => checkboxes[i]?.checked)
    : tarFiles;

  if (toLoad.length === 0) { Toast.error('No files selected.'); return; }

  // Show progress view
  const body = $('#tar-modal-body');
  const footer = $('#tar-modal-footer');
  body.innerHTML = `
    <div style="margin-bottom:12px;font-size:13px;font-weight:600">Loading ${toLoad.length} image${toLoad.length > 1 ? 's' : ''}…</div>
    <div id="tar-progress-list" class="tar-file-list">
      ${toLoad.map((f, i) => `
        <div class="tar-file-item" id="tar-prog-${i}">
          <span id="tar-icon-${i}" style="font-size:16px">⏳</span>
          <span class="tar-file-name">${escHtml(f.name)}</span>
          <span class="tar-file-size" id="tar-status-${i}">waiting…</span>
        </div>`).join('')}
    </div>
  `;
  if (footer) footer.innerHTML = '';

  let failed = 0;
  for (let i = 0; i < toLoad.length; i++) {
    const icon = $(`#tar-icon-${i}`);
    const status = $(`#tar-status-${i}`);
    if (icon) icon.textContent = '⏳';
    if (status) status.textContent = 'loading…';
    try {
      const res = await API.images.loadTar(toLoad[i]);
      if (icon) icon.textContent = '✅';
      if (status) { status.textContent = 'done'; status.style.color = 'var(--green)'; }
    } catch (e) {
      failed++;
      if (icon) icon.textContent = '❌';
      if (status) { status.textContent = e.message.slice(0, 40); status.style.color = 'var(--red)'; }
    }
  }

  if (footer) footer.innerHTML = `<button class="btn btn-primary" onclick="Modal.close();renderImages()">
    ${failed === 0 ? '✓ Done — Refresh Images' : 'Close'}
  </button>`;
}

// ── Pull Image modal ──────────────────────────────────────────────────────────

function openPullImageModal() {
  Modal.open(`
    <div class="modal-header">
      <span class="modal-title">Pull Docker Images</span>
      <button class="btn-icon" onclick="Modal.close()">✕</button>
    </div>
    <div class="modal-body" id="pull-modal-body">
      <div class="form-group">
        <label class="form-label">Images or <code>docker pull</code> commands — one per line</label>
        <textarea class="form-input" id="pull-image-name" rows="6" spellcheck="false"
          style="resize:vertical;font-family:'SF Mono','Fira Code',monospace"
          placeholder="nginx:latest&#10;docker pull ubuntu:22.04&#10;docker pull --platform linux/amd64 ghcr.io/user/repo:tag"
          oninput="$('#pull-parse-errors').style.display='none'"
          onkeydown="if(event.key==='Enter' && (event.metaKey||event.ctrlKey)) doPullImage()"></textarea>
      </div>
      <div id="pull-parse-errors" class="pull-output" style="display:none;color:#f87171;margin-bottom:10px"></div>
      <div style="font-size:11.5px;color:var(--text-muted);margin-top:-6px">
        Press ⌘/Ctrl+Enter or click Pull — tag defaults to <code>latest</code> if omitted.
        <code>--platform</code> is honoured; blank lines and <code>#</code> comments are skipped.
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-primary" id="pull-btn" onclick="doPullImage()">
        ↓ Pull
      </button>
    </div>
  `);
  setTimeout(() => $('#pull-image-name')?.focus(), 80);
}

// Each line is either bare image refs (`nginx:latest`, space-separated is fine) or a
// pasted pull command (`docker pull [--platform p] img`, `docker image pull …`),
// optionally with `sudo`, a `$ ` prompt, or several commands joined by && / ;
const IMAGE_REF_RE = /^[a-z0-9][a-z0-9._\-\/:@]*$/i;
const PULL_FLAGS_IGNORED = ['-q', '--quiet', '--disable-content-trust'];

function parsePullLines(text) {
  const pulls = [];
  const errors = [];
  const add = (image, platform, line) => {
    image = image.replace(/^['"]|['"]$/g, '');
    if (!IMAGE_REF_RE.test(image)) errors.push(`"${line}" — "${image}" doesn't look like an image`);
    else pulls.push({ image, platform });
  };

  (text || '').split('\n').forEach(raw => {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) return;

    line.split(/&&|;/).map(c => c.trim()).filter(Boolean).forEach(cmd => {
      let tokens = cmd.replace(/^\$\s*/, '').split(/\s+/);
      if (tokens[0] === 'sudo') tokens = tokens.slice(1);

      if (tokens[0] !== 'docker') {
        // Bare image refs
        tokens.forEach(t => t.startsWith('-')
          ? errors.push(`"${line}" — flag "${t}" needs a docker pull command`)
          : add(t, '', line));
        return;
      }

      const sub = tokens[1] === 'image' ? tokens.slice(2) : tokens.slice(1);
      if (sub[0] !== 'pull') { errors.push(`"${line}" — only docker pull commands are supported`); return; }

      let platform = '';
      const images = [];
      for (let i = 1; i < sub.length; i++) {
        const t = sub[i];
        if (t === '--platform') platform = sub[++i] || '';
        else if (t.startsWith('--platform=')) platform = t.slice('--platform='.length);
        else if (t === '-a' || t === '--all-tags') { errors.push(`"${line}" — --all-tags isn't supported, list the tags you want`); return; }
        else if (PULL_FLAGS_IGNORED.some(f => t === f || t.startsWith(f + '='))) continue;
        else if (t.startsWith('-')) { errors.push(`"${line}" — unsupported flag "${t}"`); return; }
        else images.push(t);
      }
      if (images.length !== 1) { errors.push(`"${line}" — expected one image after docker pull`); return; }
      add(images[0], platform, line);
    });
  });

  // De-duplicate identical image + platform pairs, keeping order
  const seen = new Set();
  const unique = pulls.filter(p => {
    const k = `${p.image}|${p.platform}`;
    return seen.has(k) ? false : seen.add(k);
  });
  return { pulls: unique, errors };
}

function pullLabel(p) {
  return p.platform ? `${p.image} (${p.platform})` : p.image;
}

async function doPullImage() {
  const { pulls, errors } = parsePullLines($('#pull-image-name')?.value);
  if (errors.length) {
    const box = $('#pull-parse-errors');
    box.textContent = `Fix ${errors.length === 1 ? 'this line' : 'these lines'} first:\n` + errors.join('\n');
    box.style.display = '';
    return;
  }
  if (!pulls.length) { Toast.error('Enter an image name first.'); return; }
  if (pulls.length > 1) return doPullImages(pulls);
  const pull = pulls[0];
  const name = pullLabel(pull);

  const btn = $('#pull-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner" style="width:14px;height:14px"></div> Pulling…'; }

  const body = $('#pull-modal-body');
  if (body) body.innerHTML = `
    <div class="flex items-center gap-2 mb-3" style="font-size:13px;font-weight:600">
      <div class="spinner" style="width:15px;height:15px"></div>
      Pulling <code>${escHtml(name)}</code>…
    </div>
    <div class="text-muted" style="font-size:12px">This may take a moment depending on image size.</div>
  `;

  try {
    const res = await API.images.pull(pull.image, pull.platform);
    const footer = document.querySelector('#modal-overlay .modal-footer');
    const modalBody = $('#pull-modal-body');
    if (modalBody) modalBody.innerHTML = `
      <div class="flex items-center gap-2 mb-3" style="color:var(--green);font-size:13px;font-weight:600">
        ✓ Successfully pulled <code>${escHtml(name)}</code>
      </div>
      <div class="pull-output">${escHtml(res.output)}</div>
    `;
    if (footer) footer.innerHTML = `
      <button class="btn btn-primary" onclick="Modal.close();renderImages()">✓ Done — Refresh Images</button>
    `;
    Toast.success(`Pulled ${name}`);
  } catch (e) {
    const modalBody = $('#pull-modal-body');
    if (modalBody) modalBody.innerHTML = `
      <div class="flex items-center gap-2 mb-3" style="color:var(--red);font-size:13px;font-weight:600">
        ✕ Pull failed
      </div>
      <div class="pull-output" style="color:#f87171">${escHtml(e.message)}</div>
    `;
    const footer = document.querySelector('#modal-overlay .modal-footer');
    if (footer) footer.innerHTML = `
      <button class="btn btn-ghost" onclick="Modal.close()">Close</button>
      <button class="btn btn-primary" onclick="openPullImageModal()">Try Again</button>
    `;
    Toast.error(`Pull failed: ${e.message.slice(0, 60)}`);
  }
}

async function doPullImages(pulls) {
  const names = pulls.map(pullLabel);
  const body = $('#pull-modal-body');
  const footer = document.querySelector('#modal-overlay .modal-footer');
  body.innerHTML = `
    <div style="margin-bottom:12px;font-size:13px;font-weight:600">Pulling ${names.length} images…</div>
    <div class="tar-file-list">
      ${names.map((n, i) => `
        <div class="tar-file-item">
          <span id="pull-icon-${i}" style="font-size:16px">⏳</span>
          <span class="tar-file-name">${escHtml(n)}</span>
          <span class="tar-file-size" id="pull-status-${i}">waiting…</span>
        </div>`).join('')}
    </div>
  `;
  if (footer) footer.innerHTML = '';

  let failed = 0;
  for (let i = 0; i < names.length; i++) {
    const icon = $(`#pull-icon-${i}`);
    const status = $(`#pull-status-${i}`);
    if (status) status.textContent = 'pulling…';
    try {
      await API.images.pull(pulls[i].image, pulls[i].platform);
      if (icon) icon.textContent = '✅';
      if (status) { status.textContent = 'done'; status.style.color = 'var(--green)'; }
    } catch (e) {
      failed++;
      if (icon) icon.textContent = '❌';
      if (status) {
        status.textContent = e.message.slice(0, 40);
        status.title = e.message;
        status.style.color = 'var(--red)';
      }
    }
  }

  const pulled = names.length - failed;
  if (failed === 0) Toast.success(`Pulled ${pulled} images`);
  else Toast.error(`${failed} of ${names.length} pulls failed`);
  if (footer) footer.innerHTML = `<button class="btn btn-primary" onclick="Modal.close();renderImages()">
    ${failed === 0 ? '✓ Done — Refresh Images' : `Close — ${pulled} of ${names.length} pulled`}
  </button>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setTopbar(title, sub, crumbs) {
  const el = $('#topbar-content');
  if (!el) return;
  if (crumbs) {
    el.innerHTML = `
      <div class="breadcrumb">
        <a href="/" onclick="event.preventDefault();Router.navigate('/')">Home</a>
        ${crumbs.map((c, i) => {
          if (i === crumbs.length - 1)
            return `<span class="breadcrumb-sep">›</span><span class="breadcrumb-current">${escHtml(c.label)}</span>`;
          return `<span class="breadcrumb-sep">›</span>
                  <a href="${c.href || '#'}" onclick="event.preventDefault();Router.navigate('${c.href}')">${escHtml(c.label)}</a>`;
        }).join('')}
      </div>`;
  } else {
    el.innerHTML = `
      <span class="topbar-title">${escHtml(title)}</span>
      ${sub ? `<span class="topbar-sub">— ${escHtml(sub)}</span>` : ''}`;
  }
}

function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function errorState(msg) {
  return `<div class="empty-state">
    <div class="empty-state-icon">⚠️</div>
    <h3>Error</h3><p>${escHtml(msg)}</p>
  </div>`;
}

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Wire nav + rail item clicks
  $$('[data-nav]').forEach(el => {
    el.addEventListener('click', () => {
      const nav = el.dataset.nav;
      if (nav === 'dashboard') Router.navigate('/');
      else Router.navigate('/' + nav);
    });
  });

  // Routes
  Router.on('/',             () => renderDashboard());
  Router.on('/images',       () => renderImages());
  Router.on('/containers',   () => renderContainers());
  Router.on('/stacks',       () => renderStacks());
  Router.on('/stacks/:name', (p) => renderStackDetail(p));
  Router.on('/stacks/:name/services/:service', (p) => renderServiceDetail(p));

  Router.start();
});
