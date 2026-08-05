/**
 * Project Nemesis — UI Module v3 (ui.js)
 * =========================================
 * All DOM manipulation, HUD state management, and visual feedback.
 * Updated for the v3 professional layout.
 */

export class NemesisUI {

  // ─── Boot Sequence ─────────────────────────────────────────────────────────

  static setProgress(pct) {
    const bar = document.querySelector('.boot-progress-bar');
    if (bar) bar.style.width = `${pct}%`;
  }

  static addBootLine(msg, type = '') {
    const list = document.querySelector('.boot-log');
    if (!list) return;
    const line = document.createElement('div');
    line.className = `boot-line ${type}`;
    line.textContent = `> ${msg}`;
    list.appendChild(line);
    list.scrollTop = list.scrollHeight;
  }

  static dismissOverlay() {
    const overlay = document.getElementById('connection-overlay');
    if (overlay) {
      NemesisUI.addBootLine('ALL SYSTEMS OPERATIONAL', 'ok');
      setTimeout(() => overlay.classList.add('hidden'), 900);
    }
  }

  // ─── Clock ─────────────────────────────────────────────────────────────────

  static startClock() {
    const el = document.getElementById('utc-clock');
    const upEl = document.getElementById('system-uptime');
    const startTime = Date.now();
    if (!el) return;

    const tick = () => {
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      el.textContent =
        `${now.getUTCFullYear()}-${pad(now.getUTCMonth()+1)}-${pad(now.getUTCDate())}` +
        `T${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}Z`;

      // System uptime
      if (upEl) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const h = Math.floor(elapsed / 3600);
        const m = Math.floor((elapsed % 3600) / 60);
        const s = elapsed % 60;
        upEl.textContent = `T+${pad(h)}:${pad(m)}:${pad(s)}`;
      }
    };

    tick();
    setInterval(tick, 1000);
  }

  // ─── System Log ────────────────────────────────────────────────────────────

  static log(msg, level = '') {
    const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    logFn(`[NEMESIS] ${msg}`);

    const list = document.getElementById('log-list');
    if (!list) return;

    const now = new Date();
    const ts = `${String(now.getUTCHours()).padStart(2,'0')}:` +
               `${String(now.getUTCMinutes()).padStart(2,'0')}:` +
               `${String(now.getUTCSeconds()).padStart(2,'0')}Z`;

    const li = document.createElement('li');
    li.className = `log-entry ${level}`;
    li.innerHTML = `<span class="log-time">${ts}</span><span class="log-msg">${msg}</span>`;
    list.prepend(li);
    while (list.children.length > 50) list.removeChild(list.lastChild);
  }

  // ─── Counter Updates ───────────────────────────────────────────────────────

  static _activityHistory = new Array(30).fill(0);
  static _lastSparklineUpdate = 0;

  static updateCounter(key, value) {
    const el = document.querySelector(`[data-counter="${key}"], #${key}`);
    if (el) el.textContent = value;

    // Track update frequency for sparkline
    if (key === 'update-count') {
      NemesisUI._tickSparkline();
    }
  }

  static _tickSparkline() {
    const now = Date.now();
    if (now - NemesisUI._lastSparklineUpdate < 2000) return; // throttle to 2s
    NemesisUI._lastSparklineUpdate = now;

    // Shift left, add new value (random jitter to simulate intensity)
    NemesisUI._activityHistory.shift();
    NemesisUI._activityHistory.push(4 + Math.random() * 18);

    const svg = document.getElementById('activity-sparkline');
    if (!svg) return;

    const bars = NemesisUI._activityHistory.length;
    const barW = 200 / bars;
    svg.innerHTML = NemesisUI._activityHistory.map((v, i) => {
      const h = Math.max(1, v);
      const opacity = 0.3 + (i / bars) * 0.7;
      return `<rect class="dp-sparkline-bar" x="${i * barW}" y="${24 - h}" width="${barW - 1}" height="${h}" opacity="${opacity.toFixed(2)}" rx="0.5" />`;
    }).join('');
  }

  // ─── Nav Column Badge Updates ──────────────────────────────────────────────

  static updateNavCount(elementId, value) {
    const el = document.getElementById(elementId);
    if (el) el.textContent = value;
  }

  // ─── Connection Status ─────────────────────────────────────────────────────

  static setConnectionStatus(status) {
    const el = document.getElementById('connection-status');
    if (!el) return;

    el.textContent = status;
    el.className = 'tb-stat-val';
    el.setAttribute('data-status', status);

    if (status === 'ONLINE')            el.classList.add('green');
    else if (status === 'ERROR')        el.classList.add('red');
    else if (status === 'PARTIAL')      el.classList.add('amber');
    else if (status === 'RECONNECTING') el.classList.add('red');

    // Also update the nav footer WS status
    const ws = document.getElementById('nc-ws-status');
    if (ws) {
      ws.textContent = status;
      ws.className = status === 'ONLINE' ? 'green' : status === 'PARTIAL' ? 'amber' : status === 'ERROR' ? 'red' : 'amber';
    }
  }

  // ─── Satellite List ────────────────────────────────────────────────────────

  static populateSatList(satellites) {
    const list = document.getElementById('sat-list');
    if (!list || !satellites || !satellites.length) return;

    const sorted = [...satellites]
      .sort((a, b) => b.alt_km - a.alt_km)
      .slice(0, 40);

    const idsKey = sorted.map(s => s.id).join(',');
    if (list._lastIdsKey === idsKey && list.children.length === sorted.length) {
      // In-place update without DOM rebuild or reflow
      for (let i = 0; i < sorted.length; i++) {
        const item = list.children[i];
        const altSpan = item.querySelector('.sat-alt');
        const newAlt = `${Math.round(sorted[i].alt_km)}km`;
        if (altSpan && altSpan.textContent !== newAlt) altSpan.textContent = newAlt;
      }
      return;
    }
    list._lastIdsKey = idsKey;

    list.innerHTML = sorted.map(sat => `
      <li class="sat-item" data-id="${sat.id}" onclick="window.__nemesisFocus && window.__nemesisFocus(${sat.id})">
        <div class="sat-dot" style="background:${sat.color || '#00ddf0'}; box-shadow:0 0 4px ${sat.color || '#00ddf0'}"></div>
        <span class="sat-name" title="${sat.name}">${sat.name}</span>
        <span class="sat-alt">${Math.round(sat.alt_km)}km</span>
      </li>
    `).join('');
  }

  static updateSelectedSat(sat) {
    document.querySelectorAll('.sat-item.selected').forEach(el => el.classList.remove('selected'));
    const el = document.querySelector(`.sat-item[data-id="${sat.id}"]`);
    if (el) {
      el.classList.add('selected');
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    NemesisUI.updateCounter('detail-name', sat.name);
    NemesisUI.updateCounter('detail-id', sat.id);
    NemesisUI.updateCounter('detail-lat', sat.lat.toFixed(3) + '°');
    NemesisUI.updateCounter('detail-lon', sat.lon.toFixed(3) + '°');
    NemesisUI.updateCounter('detail-alt', sat.alt_km.toFixed(1) + ' km');

    // Update lock pill
    const pill = document.getElementById('dp-lock-pill');
    if (pill) {
      pill.textContent = 'LOCKED';
      pill.className = 'dp-status-pill lock';
    }

    NemesisUI.fetchOverpass(sat.id);
    NemesisUI.triggerCCTV(`Target Locked: ${sat.name}`);
    NemesisUI.triggerTargetLock();
  }

  static clearSelectedSat() {
    const pill = document.getElementById('dp-lock-pill');
    if (pill) {
      pill.textContent = 'STANDBY';
      pill.className = 'dp-status-pill standby';
    }
  }

  static triggerTargetLock() {
    const crosshair = document.getElementById('crosshair');
    if (!crosshair) return;

    // Audio cue
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(280, audioCtx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
    } catch(e) {}

    crosshair.classList.remove('hidden');
    crosshair.classList.add('active');
    setTimeout(() => {
      crosshair.classList.remove('active');
      crosshair.classList.add('hidden');
    }, 1400);
  }

  static async fetchOverpass(noradId) {
    const container = document.getElementById('overpass-container');
    const dataEl    = document.getElementById('overpass-data');
    if (!container || !dataEl) return;

    container.style.display = 'block';
    dataEl.innerHTML = '<span style="color:var(--cyan-dim)">Acquiring geolocation...</span>';

    if (!navigator.geolocation) {
      dataEl.innerHTML = '<span style="color:var(--red)">Geolocation not supported.</span>';
      return;
    }

    navigator.geolocation.getCurrentPosition(async (pos) => {
      dataEl.innerHTML = '<span style="color:var(--cyan-dim)">Computing orbital passes...</span>';
      try {
        const response = await fetch('http://localhost:8000/api/satellites/overpass', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            norad_id: parseInt(noradId),
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            hours_ahead: 24
          })
        });

        if (!response.ok) throw new Error('Overpass API error');
        const data = await response.json();

        if (!data.passes || data.passes.length === 0) {
          dataEl.innerHTML = '<div class="dp-row"><span class="dp-lbl">NEXT PASS</span><span class="dp-val">None in 24h</span></div>';
          return;
        }

        const p = data.passes[0];
        dataEl.innerHTML = `
          <div class="dp-row"><span class="dp-lbl">T-MINUS</span><span class="dp-val amber">${Math.max(0, Math.floor(p.countdown_seconds / 60))} min</span></div>
          <div class="dp-row"><span class="dp-lbl">MAX ELEV</span><span class="dp-val">${Math.round(p.max_elevation_deg)}°</span></div>
          <div class="dp-row"><span class="dp-lbl">RISE UTC</span><span class="dp-val cyan">${new Date(p.rise_time_utc).toUTCString().slice(17,25)}Z</span></div>
          <div class="dp-row"><span class="dp-lbl">PASSES</span><span class="dp-val">${data.pass_count} in 24h</span></div>
        `;
      } catch (err) {
        dataEl.innerHTML = '<span style="color:var(--red)">Pass calculation failed.</span>';
      }
    }, () => {
      dataEl.innerHTML = '<span style="color:var(--amber)">Geolocation denied.</span>';
    });
  }

  // ─── News Feed ─────────────────────────────────────────────────────────────

  static populateNewsFeed(links) {
    const list = document.getElementById('news-list');
    if (!list) return;

    const articles = [];
    const seenUrls = new Set();

    links.forEach(link => {
      if (link.articles) {
        link.articles.forEach(art => {
          if (!seenUrls.has(art.url)) {
            seenUrls.add(art.url);
            const s = typeof link.source === 'object' ? link.source.label : link.source;
            const t = typeof link.target === 'object' ? link.target.label : link.target;
            const entities = [...new Set([s, t].filter(Boolean))];
            try {
              articles.push({
                title: art.title,
                url: art.url,
                domain: new URL(art.url).hostname.replace('www.', ''),
                entities
              });
            } catch(e) {}
          }
        });
      }
    });

    if (articles.length === 0) return;
    list.innerHTML = articles.slice(0, 10).map(art => `
      <li class="news-item" onclick="window.open('${art.url}', '_blank')">
        <div class="news-meta">
          <span>SOURCE: ${art.domain.toUpperCase()}</span>
          <span>LIVE</span>
        </div>
        <div class="news-title">${art.title}</div>
        <div class="news-entities">
          ${art.entities.map(e => `<span class="entity-tag">${e.substring(0,15)}</span>`).join('')}
        </div>
      </li>
    `).join('');
  }

  static renderNewsCards(articles) {
    const feed = document.getElementById('live-intel-feed');
    if (!feed || !articles?.length) return;

    const sourceColor = (src) => {
      const s = (src || '').toLowerCase();
      if (s.includes('bbc'))       return '#ff4040';
      if (s.includes('reuters'))   return '#ff8000';
      if (s.includes('guardian'))  return '#0099ff';
      if (s.includes('france24'))  return '#4488ff';
      if (s.includes('aljazeera') || s.includes('al jazeera')) return '#00bb77';
      if (s.includes('dw'))        return '#ffcc00';
      if (s.includes('npr'))       return '#8844ff';
      if (s.includes('sky'))       return '#cc4400';
      return 'rgba(0,190,210,0.5)';
    };

    const severityClass = (title) => {
      const t = (title || '').toLowerCase();
      if (t.includes('kill') || t.includes('attack') || t.includes('strike') ||
          t.includes('war')  || t.includes('missile') || t.includes('explosion'))
        return 'severity-critical';
      if (t.includes('tension') || t.includes('threat') || t.includes('sanction') || t.includes('conflict'))
        return 'severity-high';
      return 'severity-medium';
    };

    feed.innerHTML = articles.slice(0, 8).map(a => `
      <div class="news-card ${severityClass(a.title || '')}" onclick="window.open('${a.url || '#'}','_blank')">
        <div class="news-card-source">
          <span style="color:${sourceColor(a.source)}">${a.source || 'OSINT'}</span>
          <span class="live-tag">LIVE</span>
          ${a.location ? `<span class="news-card-geo">◈ ${a.location}</span>` : ''}
        </div>
        <div class="news-card-headline">${a.title || 'Intel feed active'}</div>
        <div class="news-card-meta">
          <span>${new Date().toUTCString().slice(17, 25)} Z</span>
          <span style="color:${sourceColor(a.source)}">${a.source || 'OSINT'}</span>
        </div>
      </div>
    `).join('');
  }

  // ─── CCTV Trigger ──────────────────────────────────────────────────────────

  static triggerCCTV(targetText) {
    const video = document.getElementById('cctv-video');
    const text  = document.querySelector('.cctv-text');
    if (!video || !text) return;
    video.style.display = 'block';
    video.play().catch(() => {});
    text.innerHTML = `LIVE FEED<br>${targetText.toUpperCase()}`;
  }

  // ─── Ticker ────────────────────────────────────────────────────────────────

  static initTicker() {
    const ITEMS = [
      { tag: 'SIGINT',  msg: 'Anomalous RF emissions detected — Grid 47N / 033E — investigating' },
      { tag: 'IMINT',   msg: 'New high-resolution imagery acquired — Eastern Seaboard CONUS' },
      { tag: 'TECHINT', msg: 'Analysing foreign debris trajectory — near GEO belt 36,000 km' },
      { tag: 'OSINT',   msg: 'GNSS constellation nominal — 31 SVs in view — no jamming detected' },
      { tag: 'MASINT',  msg: 'Thermal plume detected — Kamchatka region — source unconfirmed' },
      { tag: 'HUMINT',  msg: 'Tracking 110 geopolitical entities via global data streams' },
      { tag: 'SIGINT',  msg: 'GPS spoofing signature detected — Black Sea AOR — advisory issued' },
      { tag: 'ELINT',   msg: 'Next reconnaissance pass in 22:15 — 52.5°N / 13.4°E' },
      { tag: 'SATINT',  msg: 'ISS orbital inclination: 51.6° — current altitude: 408 km' },
    ];

    const track = document.querySelector('.ticker-track');
    if (!track) return;

    const html = [...ITEMS, ...ITEMS]
      .map(i => `<span class="ticker-item"><span>[${i.tag}]</span>${i.msg}</span>`)
      .join('');

    track.innerHTML = html;

    requestAnimationFrame(() => {
      const duration = Math.max(40, Math.round(track.scrollWidth / 45));
      track.style.animationDuration = `${duration}s`;
    });
  }

  // ─── Tooltip Tracking ──────────────────────────────────────────────────────

  static initTooltipTracking() {
    const tooltip = document.getElementById('sat-tooltip');
    if (!tooltip) return;

    document.addEventListener('mousemove', (e) => {
      if (tooltip.style.display === 'none') return;
      const offset = 18;
      const x = e.clientX + offset;
      const y = e.clientY + offset;
      const maxX = window.innerWidth  - tooltip.offsetWidth  - 8;
      const maxY = window.innerHeight - tooltip.offsetHeight - 8;
      tooltip.style.left = `${Math.min(x, maxX)}px`;
      tooltip.style.top  = `${Math.min(y, maxY)}px`;
    });
  }

  // ─── Bottom Asset Table ────────────────────────────────────────────────────

  /**
   * Render the bottom live asset table with the top N most relevant assets.
   * @param {object} data  — { satellites: [], flights: [], ships: [] }
   */
  static updateAssetTable({ satellites = [], flights = [], ships = [] } = {}) {
    const rows = document.getElementById('asset-rows');
    if (!rows) return;

    // Take top 5 satellites (highest alt), top 3 flights, top 2 ships
    const sats    = [...satellites].sort((a,b) => b.alt_km - a.alt_km).slice(0, 5);
    const flights_ = [...flights].filter(f => !f.on_ground).slice(0, 3);
    const ships_  = [...ships].slice(0, 2);

    const all = [
      ...sats.map(s => ({
        type:  'SAT',
        id:    String(s.id),
        name:  s.name,
        lat:   typeof s.lat === 'number' ? s.lat.toFixed(3) + '°' : '—',
        lon:   typeof s.lon === 'number' ? s.lon.toFixed(3) + '°' : '—',
        alt:   typeof s.alt_km === 'number' ? s.alt_km.toFixed(0) + ' km' : '—',
        vel:   s.velocity_kms ? s.velocity_kms.toFixed(2) + ' km/s' : '7.78 km/s',
        status: 'NOM',
        rowClass: 'at-sat',
      })),
      ...flights_.map(f => ({
        type:  'FLT',
        id:    f.callsign || f.icao24 || '—',
        name:  f.callsign || f.icao24 || 'Unknown Flight',
        lat:   typeof f.lat === 'number' ? f.lat.toFixed(3) + '°' : '—',
        lon:   typeof f.lon === 'number' ? f.lon.toFixed(3) + '°' : '—',
        alt:   f.altitude_baro ? (f.altitude_baro / 1000).toFixed(1) + ' km' : '—',
        vel:   f.velocity ? (f.velocity * 3.6).toFixed(0) + ' km/h' : '—',
        status: 'ACQ',
        rowClass: 'at-flight',
      })),
      ...ships_.map(s => ({
        type:  'SHP',
        id:    s.mmsi || '—',
        name:  s.name || s.vessel_name || 'Unknown Vessel',
        lat:   typeof s.lat === 'number' ? s.lat.toFixed(3) + '°' : '—',
        lon:   typeof s.lon === 'number' ? s.lon.toFixed(3) + '°' : '—',
        alt:   '0 km',
        vel:   s.speed ? s.speed.toFixed(1) + ' kn' : '—',
        status: 'NOM',
        rowClass: 'at-ship',
      })),
    ];

    if (all.length === 0) return;   // keep placeholder

    const pillClass = { ACQ: 'acq', DOS: 'dos', NOM: 'nom' };

    rows.innerHTML = all.map(a => `
      <div class="at-row ${a.rowClass}">
        <span class="at-col at-type">${a.type}</span>
        <span class="at-col at-id">${a.id}</span>
        <span class="at-col at-name" title="${a.name}">${a.name}</span>
        <span class="at-col at-lat">${a.lat}</span>
        <span class="at-col at-lon">${a.lon}</span>
        <span class="at-col at-alt">${a.alt}</span>
        <span class="at-col at-vel">${a.vel}</span>
        <span class="at-col at-status"><span class="at-pill ${pillClass[a.status] || 'nom'}">${a.status}</span></span>
      </div>
    `).join('');
  }

  // ─── Boot animation ────────────────────────────────────────────────────────

  static async runBootSequence() {
    const overlay = document.getElementById('connection-overlay');
    if (!overlay) return;

    // ── Inject cinematic VFX layers ──
    if (!overlay.querySelector('.boot-hex-grid')) {
      const hexGrid = document.createElement('div');
      hexGrid.className = 'boot-hex-grid';
      overlay.insertBefore(hexGrid, overlay.firstChild);

      const scanline = document.createElement('div');
      scanline.className = 'boot-scanline';
      overlay.insertBefore(scanline, overlay.firstChild);
    }

    // ── Phase 1: System Identification — Typewriter ──
    const titleEl = overlay.querySelector('.boot-title');
    if (titleEl) {
      titleEl.textContent = '';
      titleEl.classList.add('typewriter');
      const titleText = 'PROJECT NEMESIS';
      for (let i = 0; i <= titleText.length; i++) {
        titleEl.textContent = titleText.substring(0, i);
        titleEl.style.width = 'auto';
        await NemesisUI._delay(45);
      }
      await NemesisUI._delay(300);
      titleEl.classList.remove('typewriter');
      titleEl.style.borderRight = 'none';
    }

    // ── Phase 2: Subsystem Diagnostics ──
    const DIAGNOSTICS = [
      { module: 'CORE',     desc: 'Initializing Nemesis Core v7.0',        status: 'ok',   pct: 5  },
      { module: 'RENDER',   desc: 'Loading WebGL / Three.js renderer',     status: 'ok',   pct: 12 },
      { module: 'TLE',      desc: 'Fetching CelesTrak TLE catalogue',      status: 'ok',   pct: 22 },
      { module: 'SGP4',     desc: 'Computing SGP4 orbital mechanics',      status: 'ok',   pct: 32 },
      { module: 'OPENSKY',  desc: 'Establishing OpenSky ADS-B feed',       status: 'ok',   pct: 42 },
      { module: 'AIS',      desc: 'Connecting maritime AIS transponders',   status: 'ok',   pct: 50 },
      { module: 'OSINT',    desc: 'Loading OSINT / RSS intelligence feed',  status: 'ok',   pct: 58 },
      { module: 'NLP',      desc: 'Bootstrapping spaCy NER graph engine',  status: 'warn', pct: 64 },
      { module: 'RF',       desc: 'Scanning RF anomaly detection band',    status: 'ok',   pct: 72 },
      { module: 'WS',       desc: 'Establishing WebSocket uplinks',        status: 'ok',   pct: 78 },
      { module: 'WEATHER',  desc: 'Syncing NOAA SWPC solar weather',       status: 'ok',   pct: 84 },
      { module: 'HUD',      desc: 'Calibrating HUD overlays + VFX',       status: 'ok',   pct: 90 },
    ];

    const logEl = overlay.querySelector('.boot-log');
    if (logEl) logEl.innerHTML = ''; // clear old content

    for (const diag of DIAGNOSTICS) {
      NemesisUI.setProgress(diag.pct);

      const statusIcon = diag.status === 'ok' ? '✓' : diag.status === 'warn' ? '⚠' : '✗';

      if (logEl) {
        const line = document.createElement('div');
        line.className = 'boot-diag-line';
        line.innerHTML = `
          <span class="boot-diag-status ${diag.status}">${statusIcon}</span>
          <span style="color:var(--cyan-dim);min-width:52px">[${diag.module}]</span>
          <span>${diag.desc}</span>
        `;
        logEl.appendChild(line);
        logEl.scrollTop = logEl.scrollHeight;
      }

      await NemesisUI._delay(140 + Math.random() * 100);
    }

    // ── Phase 3: Data Link Handshake ──
    NemesisUI.setProgress(93);
    if (logEl) {
      const handshake = document.createElement('div');
      handshake.className = 'boot-diag-line';
      handshake.innerHTML = `
        <span class="boot-diag-status ok">⟁</span>
        <span style="color:var(--cyan-dim);min-width:52px">[LINK]</span>
        <span>Data link established — 6 channels active</span>
      `;
      logEl.appendChild(handshake);
      logEl.scrollTop = logEl.scrollHeight;
    }
    await NemesisUI._delay(350);

    // ── Phase 4: Final warm-up ──
    NemesisUI.setProgress(97);
    if (logEl) {
      const ready = document.createElement('div');
      ready.className = 'boot-diag-line';
      ready.innerHTML = `
        <span class="boot-diag-status ok">◉</span>
        <span style="color:var(--green);min-width:52px">[READY]</span>
        <span style="color:var(--green)">All subsystems nominal — platform ready</span>
      `;
      logEl.appendChild(ready);
      logEl.scrollTop = logEl.scrollHeight;
    }
    await NemesisUI._delay(200);
  }

  static _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
