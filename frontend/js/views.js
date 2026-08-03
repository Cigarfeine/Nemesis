/**
 * Project Nemesis — Tactical View System v2 (views.js)
 * Complete rewrite with full interactivity
 */

import { NemesisUI } from './ui.js';

export class NemesisViews {

  constructor() {
    this._current      = 'globe_3d';
    this._flights      = [];
    this._satellites   = [];
    this._ships        = [];
    this._radarFrame   = null;
    this._orbitalFrame = null;
    this._radarAngle   = 0;
    this._radarRange   = 500;
    this._radarCenter  = { lat: 20, lon: 10 };
    this._selectedBlip = null;
    this._leaflet2D    = null;
    this._flightMarkers = {};
    this._satMarkers    = {};
    this._shipMarkers   = {};
    this._orbitalStars  = null;

    // ── Map pro state ────────────────────────────────────
    this._mapFilters   = { satellites: true, flights: true, ships: true, hubs: true };
    this._clusterSats  = null;
    this._clusterFlts  = null;
    this._clusterShps  = null;
    this._heatLayer    = null;
    this._heatVisible  = false;
    this._gridLayer    = null;
    this._gridVisible  = false;
    this._measureMode  = false;
    this._measurePts   = [];
    this._measureLine  = null;
    this._mapCtxMenu   = null;
    this._lastRefresh  = null;
    this._refreshTimer = null;

    // ── Phase 3: Palantir Gaia features state ─────────────
    this._drawControl  = null;
    this._drawnItems   = null;
    this._bearingLayer = null;
    this._bearingVisible = false;
    this._proxRings    = null;
    this._proxRingMode = false;
    this._proxClickHandler = null;

    // ── Phase 4: Palantir Gotham visual fidelity state ────
    this._flightTrailHistory = {};  // icao24 → [{lat,lon,ts}, ...]
    this._trailLayer   = null;
    this._trailsVisible = false;
    this._followTarget = null;      // { icao24, callsign }
    this._borderGlowLayer = null;
    this._pendingMapCenter = null;  // Phase 5: Globe→Map coordinate sync
    this._selectedEntityId = null;
  }

  // ─── Init ──────────────────────────────────────────────────
  init() {
    this._buildContainers();
    this._buildToggleBar();
    this._bindKeys();
    // Phase VII: Sparklines + panels
    setTimeout(() => this._initSparklines(), 2000);
  }

  // ─── Data updates ──────────────────────────────────────────
  updateFlights(f)   { this._flights    = f || []; this._syncActiveView(); }
  updateSatellites(s){ this._satellites = s || []; this._syncActiveView(); }
  updateShips(s)     { this._ships      = s || []; this._syncActiveView(); }

  // Sync current view when new data arrives
  _syncActiveView() {
    if (this._current === 'radar')    this._refreshRadarBlips();
    if (this._current === 'map_2d')   this._refreshLeafletMarkers();
    if (this._current === 'maritime') this._refreshShipMarkers();
    // Phase 3: Update live overlays
    if (this._bearingVisible && this._current === 'map_2d') this._renderBearingLines();
    if (this._current === 'map_2d' || this._current === 'maritime') this._updateViewportCount();
  }

  // ─── Containers ────────────────────────────────────────────
  _buildContainers() {
    // CSS owns all positioning. JS just creates the elements.

    // ── 2D MAP (Leaflet) ───────────────────────────────
    const map2d = document.createElement('div');
    map2d.id = 'view-map2d';
    document.body.appendChild(map2d);

    // ── ATC RADAR ───────────────────────────────────────
    const radar = document.createElement('div');
    radar.id = 'view-radar';
    radar.style.background = 'radial-gradient(ellipse at center,#000d1a 0%,#000305 100%)';
    radar.innerHTML = `
      <canvas id="radar-canvas"></canvas>
      <div id="radar-hud" style="
        position:absolute; top:68px; right:calc(var(--right-w, 280px) + 16px);
        width:240px; display:flex; flex-direction:column; gap:6px;
      "></div>
      <div id="radar-detail" style="
        position:absolute; bottom:calc(var(--bottom-h, 92px) + 16px); left:calc(var(--left-w, 200px) + 16px);
        width:280px; background:rgba(0,10,5,0.92);
        border:1px solid rgba(72,175,240,0.2);
        border-left:2px solid #48AFF0;
        padding:12px; display:none; z-index:10;
        font-family:'Share Tech Mono',monospace;
      "></div>
      <div id="radar-title-overlay" style="
        position:absolute; top:calc(var(--topbar-h, 48px) + 20px); left:calc(var(--left-w, 200px) + 20px);
        font-family:'Orbitron',monospace; font-size:10px; color:rgba(72,175,240,0.55);
        display:flex; flex-direction:column; gap:4px; z-index: 500; text-align: left; pointer-events:none;
      ">
        <div>NEMESIS ATC — TACTICAL RADAR</div>
        <div style="font-size:9px"><span id="radar-time-text">--:--:-- Z</span></div>
        <div style="font-size:9px"><span id="radar-tracks-text">TRACKS: 0 / 500NM</span></div>
      </div>
      <div id="radar-controls" style="
        position:absolute; top:68px; left:calc(var(--left-w, 200px) + 16px);
        display:flex; gap:8px; align-items:center;
        font-family:'Orbitron',monospace; font-size:9px;
      ">
        <span style="color:rgba(72,175,240,0.5)">RANGE:</span>
        ${[250,500,1000,2000].map(r=>`
          <button onclick="window.__nemesisViews.setRadarRange(${r})"
            id="rng-${r}" style="
            padding:4px 8px; background:transparent;
            border:1px solid rgba(72,175,240,0.2);
            color:rgba(72,175,240,0.5); font-size:8px;
            font-family:'Orbitron',sans-serif; cursor:pointer;
            letter-spacing:.1em;
          ">${r}NM</button>
        `).join('')}
        <span style="color:rgba(72,175,240,0.3);margin-left:8px;font-size:8px">
          CLICK BLIP FOR DETAIL
        </span>
      </div>
    `;
    document.body.appendChild(radar);

    // ── ORBITAL ──────────────────────────────────────────────
    const orbital = document.createElement('div');
    orbital.id = 'view-orbital';
    orbital.style.background = 'radial-gradient(ellipse at center,#000810 0%,#000205 100%)';
    orbital.innerHTML = `
      <canvas id="orbital-canvas"></canvas>
      <div id="orbital-detail" style="
        position:absolute; top:68px; right:calc(var(--right-w, 280px) + 16px);
        width:240px; font-family:'Share Tech Mono',monospace;
        display:flex; flex-direction:column; gap:6px;
      "></div>
      <div style="
        position:absolute; bottom:calc(var(--bottom-h, 92px) + 16px); left:calc(var(--left-w, 200px) + 16px);
        font-family:'Orbitron',sans-serif; font-size:8px;
        color:rgba(45,114,210,0.3); letter-spacing:.15em;
      ">CLICK SATELLITE TO INSPECT · SCROLL TO ZOOM</div>
    `;
    document.body.appendChild(orbital);

    // ── MARITIME ────────────────────────────────────────────
    const maritime = document.createElement('div');
    maritime.id = 'view-maritime';
    document.body.appendChild(maritime);

    window.__nemesisViews = this;
  }

  // ─── Toggle Bar ────────────────────────────────────────────
  _buildToggleBar() {
    const existing = document.getElementById('view-toggle-bar');
    if (existing) existing.remove();

    const bar = document.createElement('div');
    bar.id = 'view-toggle-bar';
    bar.style.cssText = `
      position:fixed; bottom:42px; left:50%;
      transform:translateX(-50%); z-index:400;
      display:flex; gap:2px;
      background:rgba(1,4,12,0.97);
      border:1px solid rgba(45,114,210,0.12);
      padding:5px; backdrop-filter:blur(12px);
      box-shadow:0 0 30px rgba(0,0,0,0.8),
                 0 0 20px rgba(45,114,210,0.05);
    `;

    const VIEWS = [
      { id:'globe_3d',  label:'◉ GLOBE 3D',    key:'G', color:'#2D72D2' },
      { id:'map_2d',    label:'⊞ MAP 2D',       key:'2', color:'#2D72D2' },
      { id:'radar',     label:'◎ ATC RADAR',    key:'T', color:'#48AFF0' },
      { id:'orbital',   label:'⊕ ORBITAL',      key:'O', color:'#2D72D2' },
      { id:'maritime',  label:'⚓ MARITIME',     key:'M', color:'#00aaff' },
    ];

    VIEWS.forEach(v => {
      const btn = document.createElement('button');
      btn.id = `vbtn-${v.id}`;
      btn.style.cssText = `
        padding:6px 14px;
        font-family:'Orbitron',sans-serif;
        font-size:9px; font-weight:700;
        letter-spacing:.18em;
        color:rgba(45,114,210,0.45);
        background:transparent;
        border:1px solid rgba(45,114,210,0.12);
        cursor:pointer; transition:all 0.18s;
        white-space:nowrap; position:relative;
      `;
      btn.innerHTML = `${v.label}&nbsp;<span style="opacity:.4;font-size:8px">[${v.key}]</span>`;
      btn.onclick = () => this.switchView(v.id);
      bar.appendChild(btn);
    });

    document.body.appendChild(bar);
    this._highlightBtn('globe_3d');
  }

  _highlightBtn(id) {
    document.querySelectorAll('[id^="vbtn-"]').forEach(btn => {
      const active = btn.id === `vbtn-${id}`;
      btn.style.color      = active ? '#000' : 'rgba(45,114,210,0.45)';
      btn.style.background = active ? '#2D72D2' : 'transparent';
      btn.style.borderColor= active ? '#2D72D2' : 'rgba(45,114,210,0.12)';
      btn.style.boxShadow  = active ? '0 0 14px rgba(45,114,210,0.4)' : 'none';
    });
  }

  // ─── View Switching ────────────────────────────────────────
  switchView(id) {
    this._current = id;
    this._highlightBtn(id);

    // Stop all animation loops
    if (this._radarFrame)   { cancelAnimationFrame(this._radarFrame);   this._radarFrame = null; }
    if (this._orbitalFrame) { cancelAnimationFrame(this._orbitalFrame); this._orbitalFrame = null; }

    // Remove .active from all view containers
    ['view-map2d','view-radar','view-orbital','view-maritime'].forEach(elId => {
      const e = document.getElementById(elId);
      if (e) e.classList.remove('active');
    });

    // Hide toolbars by default, specific views will enable them
    const globeHud = document.getElementById('globe-hud');
    if (globeHud) globeHud.style.display = 'none';
    const mapToolbar = document.getElementById('map-toolbar');
    if (mapToolbar) mapToolbar.classList.remove('visible');
    const timeline = document.getElementById('timeline-scrubber');
    if (timeline) timeline.style.display = (['map_2d','maritime'].includes(id)) ? 'flex' : 'none';
    const viewportCounter = document.getElementById('viewport-counter');
    if (viewportCounter) viewportCounter.classList.toggle('visible', ['map_2d','maritime'].includes(id));
    const drawSub = document.getElementById('draw-subtoolbar');
    if (drawSub && !['map_2d','maritime'].includes(id)) drawSub.classList.remove('visible');
    if (!['map_2d','maritime'].includes(id)) document.getElementById('geofence-results')?.remove();

    const globe = document.getElementById('globe-container');
    const hexOv = document.getElementById('hex-overlay');
    const scanR = document.getElementById('scan-ring');
    const scanA = document.getElementById('scan-arc');

    switch (id) {
      case 'globe_3d':
        if (globe) globe.style.opacity = '1';
        [hexOv,scanR,scanA].forEach(e => { if (e) e.style.opacity = '1'; });
        document.getElementById('map-toolbar')?.classList.remove('visible');
        document.getElementById('globe-hud') && (document.getElementById('globe-hud').style.display = 'flex');
        // Phase 5: Sync globe to map's last viewed position
        if (this._leaflet2D && window.__nemesisGlobe && window.__nemesisGlobe._globe) {
          const center = this._leaflet2D.getCenter();
          const mapZoom = this._leaflet2D.getZoom();
          // Convert Leaflet zoom to globe altitude (lower zoom = higher altitude)
          const alt = Math.max(0.1, 3.5 - (mapZoom * 0.35));
          window.__nemesisGlobe._globe.pointOfView(
            { lat: center.lat, lng: center.lng, altitude: alt }, 1200
          );
        }
        window.dispatchEvent(new CustomEvent('view:globe'));
        break;

      case 'map_2d': {
        if (globe) globe.style.opacity = '0.05';
        [hexOv,scanR,scanA].forEach(e => { if (e) e.style.opacity = '0'; });
        document.getElementById('globe-hud') && (document.getElementById('globe-hud').style.display = 'none');
        const m = document.getElementById('view-map2d');
        if (m) m.classList.add('active');
        // Phase 5: Sync map to globe's current position
        if (window.__nemesisGlobe && window.__nemesisGlobe._globe) {
          const pov = window.__nemesisGlobe._globe.pointOfView();
          this._pendingMapCenter = { lat: pov.lat, lng: pov.lng, alt: pov.altitude };
        }
        // Short delay so CSS display:block renders before Leaflet measures container
        setTimeout(() => this._initLeaflet2D(), 50);
        break;
      }

      case 'radar': {
        if (globe) globe.style.opacity = '0.03';
        [hexOv,scanR,scanA].forEach(e => { if (e) e.style.opacity = '0'; });
        const r = document.getElementById('view-radar');
        if (r) r.classList.add('active');
        requestAnimationFrame(() => this._startRadar());
        window.dispatchEvent(new CustomEvent('view:radar'));
        break;
      }

      case 'orbital': {
        if (globe) globe.style.opacity = '0.04';
        [hexOv,scanR,scanA].forEach(e => { if (e) e.style.opacity = '0'; });
        const o = document.getElementById('view-orbital');
        if (o) o.classList.add('active');
        requestAnimationFrame(() => this._startOrbital());
        window.dispatchEvent(new CustomEvent('view:orbital'));
        break;
      }

      case 'maritime': {
        if (globe) globe.style.opacity = '0.04';
        [hexOv,scanR,scanA].forEach(e => { if (e) e.style.opacity = '0'; });
        const ma = document.getElementById('view-maritime');
        if (ma) ma.classList.add('active');
        this._initMaritime();
        window.dispatchEvent(new CustomEvent('view:maritime'));
        break;
      }
    }

    NemesisUI.log(`View: ${id.replace('_',' ').toUpperCase()}`, 'ok');
  }

  // ═══════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════
  // 2D MAP — Professional Leaflet Tactical Map
  // ═══════════════════════════════════════════════════════════
  _initLeaflet2D() {
    if (!window.L) { NemesisUI.log('Leaflet not loaded', 'warn'); return; }
    const container = document.getElementById('view-map2d');
    if (!container) return;

    // Show toolbar only if appropriate view active
    const tb = document.getElementById('map-toolbar');
    if (tb) {
      if (['map_2d','maritime'].includes(this._current)) {
        tb.classList.add('visible');
      } else {
        tb.classList.remove('visible');
      }
    }

    if (this._leaflet2D) {
      this._leaflet2D.invalidateSize();
      // Phase 5: Apply pending center from globe sync
      if (this._pendingMapCenter) {
        const pc = this._pendingMapCenter;
        const zoom = Math.round(Math.max(2, Math.min(10, (3.5 - pc.alt) / 0.35)));
        this._leaflet2D.setView([pc.lat, pc.lng], zoom, { animate: true, duration: 0.5 });
        this._pendingMapCenter = null;
      }
      this._refreshLeafletMarkers();
      return;
    }

    // Container is now visible via CSS .active class — no style override needed
    // Phase 5: Use pending center from globe or default
    const initCenter = this._pendingMapCenter
      ? [this._pendingMapCenter.lat, this._pendingMapCenter.lng] : [20, 20];
    const initZoom = this._pendingMapCenter
      ? Math.round(Math.max(2, Math.min(10, (3.5 - this._pendingMapCenter.alt) / 0.35))) : 3;
    this._pendingMapCenter = null;

    this._leaflet2D = window.L.map(container, {
      center:             initCenter,
      zoom:               initZoom,
      zoomControl:        false,
      attributionControl: false,
      preferCanvas:       true,
    });

    // Custom zoom control top-right
    window.L.control.zoom({ position: 'topright' }).addTo(this._leaflet2D);

    // ── Base tile layers ────────────────────────────────
    const baseLayers = {
      // Palantir Gaia-style ultra-dark (default)
      'SIGINT DARK': window.L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
        { maxZoom:19, subdomains:'abcd', attribution:'', className:'sigint-dark-tiles' }
      ),

      // Dark tactical with labels
      'TACTICAL': window.L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        { maxZoom:19, subdomains:'abcd', attribution:'' }
      ),

      // Satellite imagery (Esri World Imagery — free, no key)
      'SATELLITE': window.L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { maxZoom:19, attribution:'' }
      ),

      // Topographic terrain
      'TOPOGRAPHIC': window.L.tileLayer(
        'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        { maxZoom:17, subdomains:'abc', attribution:'' }
      ),

      // OpenStreetMap (full roads + places)
      'STREETS': window.L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { maxZoom:19, subdomains:'abc', attribution:'' }
      ),
    };

    // Start with SIGINT DARK
    baseLayers['SIGINT DARK'].addTo(this._leaflet2D);

    // Subtle desaturation — the dark_nolabels tiles already look good,
    // just slightly darken and desaturate for a cleaner professional look
    const sigintStyle = document.createElement('style');
    sigintStyle.textContent = `
      .sigint-dark-tiles { filter: saturate(0.6) brightness(0.85); }
    `;
    document.head.appendChild(sigintStyle);

    // ── Phase 5: Ultra-subtle GeoJSON country border overlay ──
    // Palantir shows borders as barely-visible hints, not bright lines.
    // The dark_nolabels basemap has NO borders, so our overlay is the only source.
    fetch('assets/countries.geojson')
      .then(r => r.json())
      .then(geo => {
        // Single subtle layer — NOT double-stroke (was too noisy)
        this._borderGlowLayer = window.L.geoJSON(geo, {
          style: (feature) => {
            return {
              color: 'rgba(72,175,240,0.12)',
              weight: 0.6,
              fillColor: 'rgba(45,114,210,0.008)',
              fillOpacity: 1,
              interactive: false,
            };
          },
          className: 'border-glow-layer',
        }).addTo(this._leaflet2D);
      }).catch(() => {});

    // Style the layer control
    const layerControlStyle = document.createElement('style');
    layerControlStyle.textContent = `
      #view-map2d .leaflet-control-layers {
        background: rgba(2,8,20,0.97) !important;
        border: 1px solid rgba(45,114,210,0.2) !important;
        border-radius: 0 !important;
        color: #2D72D2 !important;
        font-family: 'Share Tech Mono', monospace !important;
        min-width: 180px !important;
        box-shadow: 0 0 30px rgba(0,0,0,0.8) !important;
      }
      #view-map2d .leaflet-control-layers-base label,
      #view-map2d .leaflet-control-layers-overlays label {
        color: rgba(0,200,220,0.8) !important;
        font-size: 10px !important;
        letter-spacing: .1em !important;
        padding: 3px 0 !important;
        display: block !important;
      }
      #view-map2d .leaflet-control-layers-separator {
        border-color: rgba(45,114,210,0.15) !important;
        margin: 4px 0 !important;
      }
      #view-map2d .leaflet-control-layers-toggle {
        background-color: rgba(2,8,20,0.97) !important;
        border: 1px solid rgba(45,114,210,0.2) !important;
        width: 36px !important;
        height: 36px !important;
      }
      #view-map2d .leaflet-control-layers-expanded {
        padding: 10px 14px !important;
      }
      #view-map2d .leaflet-control-layers-base {
        margin-bottom: 6px !important;
      }
      .leaflet-control-layers-base .layer-label {
        color: rgba(45,114,210,0.9) !important;
      }
    `;
    document.head.appendChild(layerControlStyle);

    // Add scale bar
    window.L.control.scale({
      position:  'bottomright',
      imperial:  false,
      maxWidth:  200,
    }).addTo(this._leaflet2D);

    // Tactical CSS
    const style = document.createElement('style');
    style.textContent = `
      #view-map2d .leaflet-tile-pane {
        filter: brightness(0.65) saturate(0.5) hue-rotate(150deg);
      }
      #view-map2d .leaflet-control-zoom a {
        background: rgba(2,8,20,0.95) !important;
        color: #2D72D2 !important;
        border-color: rgba(45,114,210,0.2) !important;
        font-family: 'Orbitron', sans-serif !important;
        width: 28px !important;
        height: 28px !important;
        line-height: 28px !important;
        font-size: 16px !important;
      }
      #view-map2d .leaflet-control-zoom a:hover {
        background: rgba(45,114,210,0.1) !important;
        box-shadow: 0 0 10px rgba(45,114,210,0.3) !important;
      }
      #view-map2d .leaflet-control-scale-line {
        background: rgba(2,8,20,0.8);
        border-color: rgba(45,114,210,0.3);
        color: #2D72D2;
        font-family: 'Share Tech Mono', monospace;
        font-size: 10px;
      }
      .sat-popup .leaflet-popup-content-wrapper,
      .flight-popup .leaflet-popup-content-wrapper,
      .ship-popup .leaflet-popup-content-wrapper {
        background: rgba(2,8,20,0.97) !important;
        border-radius: 0 !important;
        box-shadow: 0 0 20px rgba(45,114,210,0.15) !important;
        font-family: 'Share Tech Mono', monospace !important;
        font-size: 11px !important;
        color: #2D72D2 !important;
        min-width: 200px !important;
      }
      .flight-popup .leaflet-popup-content-wrapper {
        border: 1px solid rgba(255,179,0,0.3) !important;
        box-shadow: 0 0 20px rgba(255,179,0,0.15) !important;
      }
      .ship-popup .leaflet-popup-content-wrapper {
        border: 1px solid rgba(0,170,255,0.3) !important;
      }
      .sat-popup .leaflet-popup-content-wrapper {
        border: 1px solid rgba(45,114,210,0.3) !important;
      }
      .leaflet-popup-tip-container { display: none; }
      #view-map2d .leaflet-popup-close-button {
        color: #2D72D2 !important;
        font-size: 16px !important;
      }
    `;
    document.head.appendChild(style);

    // Click on map background to dismiss popups
    this._leaflet2D.on('click', () => {
      this._leaflet2D.closePopup();
    });

    // Right-click context menu
    this._leaflet2D.on('contextmenu', (e) => {
      const lat = e.latlng.lat.toFixed(4);
      const lon = e.latlng.lng.toFixed(4);
      window.L.popup({ className: 'sat-popup' })
        .setLatLng(e.latlng)
        .setContent(`
          <div style="color:#2D72D2;font-family:'Orbitron',sans-serif;
                      font-size:9px;letter-spacing:.15em;margin-bottom:8px">
            ◈ COORDINATES
          </div>
          <div style="color:rgba(45,114,210,0.7);line-height:2">
            LAT: <b style="color:#2D72D2">${lat}°</b><br>
            LON: <b style="color:#2D72D2">${lon}°</b>
          </div>
          <div style="margin-top:8px">
            <button onclick="window.__nemesisViews?.setRadarCenter(${lat},${lon})"
              style="padding:4px 8px;background:transparent;
                     border:1px solid rgba(45,114,210,0.3);
                     color:#2D72D2;font-size:9px;cursor:pointer;
                     font-family:'Orbitron',sans-serif;width:100%">
              SET AS RADAR CENTER
            </button>
          </div>
        `)
        .openOn(this._leaflet2D);
    });

    // Layer groups for easy toggle
    this._layerGroups = {
      satellites: window.L.layerGroup().addTo(this._leaflet2D),
      flights:    window.L.layerGroup().addTo(this._leaflet2D),
      ships:      window.L.layerGroup().addTo(this._leaflet2D),
      geoHubs:    window.L.layerGroup().addTo(this._leaflet2D),
    };

    // ── Earthquake layer (USGS live) ────────────────────
    this._layerGroups.earthquakes = window.L.layerGroup();

    const loadEarthquakes = async () => {
      try {
        const r = await fetch(
          'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson'
        );
        const data = await r.json();
        this._layerGroups.earthquakes.clearLayers();
        
        data.features.forEach(eq => {
          const mag   = eq.properties.mag || 0;
          const place = eq.properties.place || 'Unknown';
          const time  = new Date(eq.properties.time).toUTCString().slice(0,25);
          const [lon, lat] = eq.geometry.coordinates;
          
          const col  = mag >= 6 ? '#ff2d2d'
                     : mag >= 5 ? '#ff8800'
                     : mag >= 4 ? '#ffb300'
                     : '#ffff00';
          const size = Math.max(6, mag * 5);
          
          const icon = window.L.divIcon({
            html: `
              <div style="
                width:${size}px; height:${size}px;
                border-radius:50%;
                background:${col}44;
                border:2px solid ${col};
                box-shadow:0 0 ${size}px ${col};
                animation: eq-pulse 1.5s ease-in-out infinite;
              "></div>
              <style>
                @keyframes eq-pulse {
                  0%,100%{transform:scale(1);opacity:1}
                  50%{transform:scale(1.3);opacity:0.7}
                }
              </style>
            `,
            iconSize:   [size, size],
            iconAnchor: [size/2, size/2],
            className:  '',
          });
          
          window.L.marker([lat, lon], { icon })
            .bindPopup(`
              <div style="color:${col};font-family:'Orbitron',sans-serif;
                          font-size:11px;font-weight:700;margin-bottom:8px">
                ⚠ EARTHQUAKE M${mag.toFixed(1)}
              </div>
              <div style="color:rgba(255,200,100,0.8);line-height:2;font-size:10px">
                LOCATION: <b style="color:#fff">${place}</b><br>
                MAGNITUDE:<b style="color:${col}"> M${mag.toFixed(1)}</b><br>
                DEPTH:    <b style="color:#ffb300">${Math.round(eq.geometry.coordinates[2])} km</b><br>
                TIME:     <b style="color:#2D72D2">${time} UTC</b>
              </div>
            `, { className: 'flight-popup' })
            .addTo(this._layerGroups.earthquakes);
        });
        
        NemesisUI.log(`Earthquakes loaded: ${data.features.length} events (M2.5+ last 24h)`, 'ok');
      } catch(e) {
        console.warn('[Map] Earthquake load failed:', e);
      }
    };

    loadEarthquakes();
    setInterval(loadEarthquakes, 300000); // Refresh every 5 min


    // ── Wildfire layer (NASA FIRMS via EONET) ───────────
    this._layerGroups.wildfires = window.L.layerGroup();

    const loadWildfires = async () => {
      try {
        const r = await fetch(
          'https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=open&limit=50'
        );
        const data = await r.json();
        this._layerGroups.wildfires.clearLayers();
        
        (data.events || []).forEach(event => {
          const geo = event.geometry?.[0];
          if (!geo || !geo.coordinates) return;
          const [lon, lat] = geo.coordinates;
          
          const icon = window.L.divIcon({
            html: `<div style="font-size:18px;filter:drop-shadow(0 0 6px #ff4400)">🔥</div>`,
            iconSize:   [20, 20],
            iconAnchor: [10, 10],
            className:  '',
          });
          
          window.L.marker([lat, lon], { icon })
            .bindPopup(`
              <div style="color:#ff4400;font-family:'Orbitron',sans-serif;
                          font-size:11px;font-weight:700;margin-bottom:8px">
                🔥 ACTIVE WILDFIRE
              </div>
              <div style="color:rgba(255,150,100,0.8);line-height:2;font-size:10px">
                EVENT: <b style="color:#fff">${event.title}</b><br>
                DATE:  <b style="color:#ffb300">${geo.date?.slice(0,10)}</b>
              </div>
            `, { className: 'flight-popup' })
            .addTo(this._layerGroups.wildfires);
        });
        NemesisUI.log(`Wildfires: ${(data.events||[]).length} active`, 'ok');
      } catch(e) {}
    };
    loadWildfires();
    setInterval(loadWildfires, 600000);


    // ── Weather radar overlay (RainViewer) ──────────────
    this._layerGroups.weather = window.L.layerGroup();
    this._weatherLayer = null;

    const loadWeatherRadar = async () => {
      try {
        const r = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        const data = await r.json();
        const latest = data.radar?.past?.slice(-1)[0];
        if (!latest) return;
        
        if (this._weatherLayer) {
          this._layerGroups.weather.removeLayer(this._weatherLayer);
        }
        
        this._weatherLayer = window.L.tileLayer(
          `https://tilecache.rainviewer.com${latest.path}/256/{z}/{x}/{y}/2/1_1.png`,
          { opacity: 0.5, maxZoom: 15, attribution: '' }
        );
        this._weatherLayer.addTo(this._layerGroups.weather);
        NemesisUI.log('Weather radar updated', 'ok');
      } catch(e) {}
    };
    loadWeatherRadar();
    setInterval(loadWeatherRadar, 600000);


    // ── OpenSky density heatmap ──────────────────────────
    // Show flight density as circle markers sized by traffic
    this._layerGroups.flightDensity = window.L.layerGroup();


    // ── Major airports layer ─────────────────────────────
    this._layerGroups.airports = window.L.layerGroup();

    const MAJOR_AIRPORTS = [
      { name:'Heathrow',    iata:'LHR', lat:51.4775, lon:-0.4614,  country:'UK' },
      { name:'Dubai Intl',  iata:'DXB', lat:25.2528, lon:55.3644,  country:'UAE' },
      { name:'Singapore',   iata:'SIN', lat:1.3644,  lon:103.9915, country:'SG' },
      { name:'JFK',         iata:'JFK', lat:40.6413, lon:-73.7781, country:'USA' },
      { name:'Frankfurt',   iata:'FRA', lat:50.0379, lon:8.5622,   country:'DE' },
      { name:'Tokyo Narita',iata:'NRT', lat:35.7647, lon:140.3864, country:'JP' },
      { name:'Sydney',      iata:'SYD', lat:-33.9399,lon:151.1753, country:'AU' },
      { name:'Mumbai',      iata:'BOM', lat:19.0896, lon:72.8656,  country:'IN' },
      { name:'Doha',        iata:'DOH', lat:25.2609, lon:51.6138,  country:'QA' },
      { name:'Amsterdam',   iata:'AMS', lat:52.3105, lon:4.7683,   country:'NL' },
      { name:'Istanbul',    iata:'IST', lat:41.2609, lon:28.7418,  country:'TR' },
      { name:'Hong Kong',   iata:'HKG', lat:22.3080, lon:113.9185, country:'HK' },
      { name:'Los Angeles', iata:'LAX', lat:33.9425, lon:-118.4081,country:'USA' },
      { name:'Paris CDG',   iata:'CDG', lat:49.0097, lon:2.5479,   country:'FR' },
      { name:'Seoul Incheon',iata:'ICN',lat:37.4602, lon:126.4407, country:'KR' },
      { name:'Bangalore',   iata:'BLR', lat:13.1986, lon:77.7066,  country:'IN' },
      { name:'Delhi',       iata:'DEL', lat:28.5562, lon:77.1000,  country:'IN' },
      { name:'Cochin',      iata:'COK', lat:10.1520, lon:76.4019,  country:'IN' },
    ];

    MAJOR_AIRPORTS.forEach(ap => {
      const icon = window.L.divIcon({
        html: `
          <div style="
            width:10px; height:10px;
            background:rgba(45,114,210,0.15);
            border:1px solid rgba(45,114,210,0.5);
            border-radius:2px;
            transform:rotate(45deg);
            box-shadow:0 0 8px rgba(45,114,210,0.3);
          "></div>
        `,
        iconSize:   [10, 10],
        iconAnchor: [5, 5],
        className:  '',
      });
      
      window.L.marker([ap.lat, ap.lon], { icon })
        .bindTooltip(ap.iata, {
          permanent:  true,
          direction:  'right',
          offset:     [8, 0],
          className:  'airport-tooltip',
        })
        .bindPopup(`
          <div style="color:#2D72D2;font-family:'Orbitron',sans-serif;
                      font-size:11px;font-weight:700;margin-bottom:6px">
            ✈ ${ap.name}
          </div>
          <div style="color:rgba(0,200,220,0.7);line-height:2;font-size:10px">
            IATA:    <b style="color:#2D72D2">${ap.iata}</b><br>
            COUNTRY: <b style="color:#2D72D2">${ap.country}</b><br>
            LAT/LON: <b style="color:#7cff7c">${ap.lat}° / ${ap.lon}°</b>
          </div>
        `, { className: 'sat-popup' })
        .addTo(this._layerGroups.airports);
    });


    // ── Tectonic plates overlay ──────────────────────────
    this._layerGroups.tectonics = window.L.layerGroup();

    fetch('https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_plates.json')
      .then(r => r.json())
      .then(data => {
        window.L.geoJSON(data, {
          style: {
            color:     '#ff4400',
            weight:    1.5,
            opacity:   0.35,
            fillColor: 'transparent',
            fillOpacity: 0,
            dashArray: '4 8',
          },
        }).addTo(this._layerGroups.tectonics);
        NemesisUI.log('Tectonic plates loaded', 'ok');
      })
      .catch(() => {});


    // ── Shipping lanes (AIS density) ────────────────────
    this._layerGroups.shippingLanes = window.L.layerGroup();

    // Major shipping lane polylines
    const SHIPPING_LANES = [
      // Trans-Pacific
      { name:'Trans-Pacific', points:[[35,122],[30,140],[25,160],[20,180],[15,-160],[10,-140],[5,-120],[0,-100],[-5,-80]] },
      // Trans-Atlantic  
      { name:'Trans-Atlantic', points:[[51,-1],[48,-15],[44,-25],[40,-35],[36,-45],[32,-55],[28,-65],[25,-75],[20,-80]] },
      // Europe-Asia (Suez)
      { name:'Suez Route', points:[[51,-1],[45,5],[40,15],[35,25],[30,32],[25,38],[20,45],[15,52],[10,58],[5,65],[-5,75],[-15,90],[-20,105],[1,103],[22,114],[35,130]] },
      // Cape of Good Hope
      { name:'Cape Route', points:[[51,-1],[40,-10],[30,-15],[20,-20],[10,-15],[0,-10],[-10,-5],[-20,0],[-30,10],[-34,18],[-35,25],[-34,40],[-25,45],[-15,50],[-5,60],[5,70]] },
      // Malacca-Pacific
      { name:'Malacca', points:[[1,103],[4,106],[6,108],[10,110],[15,115],[20,118],[25,122]] },
    ];

    SHIPPING_LANES.forEach(lane => {
      window.L.polyline(lane.points, {
        color:     '#0044aa',
        weight:    3,
        opacity:   0.2,
        dashArray: '8 16',
      })
      .bindPopup(`
        <div style="color:#00aaff;font-family:'Orbitron',sans-serif;font-size:10px">
          ⚓ ${lane.name}
        </div>
      `, { className: 'ship-popup' })
      .addTo(this._layerGroups.shippingLanes);
    });


    // ── Internet cable layer ─────────────────────────────
    this._layerGroups.cables = window.L.layerGroup();

    fetch('https://raw.githubusercontent.com/telegeography/www.submarinecablemap.com/master/web/public/api/v3/cable/cable-geo.json')
      .then(r => r.json())
      .then(data => {
        window.L.geoJSON(data, {
          style: feature => ({
            color:     '#ff00ff',
            weight:    1,
            opacity:   0.25,
          }),
          onEachFeature: (feature, layer) => {
            layer.bindPopup(`
              <div style="color:#ff00ff;font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700">
                🔌 ${feature.properties?.name || 'Submarine Cable'}
              </div>
            `, { className: 'sat-popup' });
          }
        }).addTo(this._layerGroups.cables);
        NemesisUI.log('Submarine cables loaded', 'ok');
      })
      .catch(() => {});


    // ── Military zones (approximate) ────────────────────
    this._layerGroups.military = window.L.layerGroup();

    const MILITARY_ZONES = [
      { name:'South China Sea Dispute', lat:12, lon:114, radius:400000, color:'#ff2d2d' },
      { name:'Taiwan Strait',           lat:24.5, lon:119.5, radius:150000, color:'#ff2d2d' },
      { name:'Strait of Hormuz',        lat:26.5, lon:56.5, radius:100000, color:'#ff8800' },
      { name:'Black Sea',               lat:43, lon:35, radius:300000, color:'#ff8800' },
      { name:'Red Sea (Houthi)',        lat:15, lon:42, radius:500000, color:'#ff2d2d' },
      { name:'Baltic Sea (NATO)',       lat:58, lon:20, radius:400000, color:'#ffb300' },
      { name:'Arctic (Contested)',      lat:75, lon:0, radius:800000, color:'#ffb300' },
      { name:'Gaza Strip',              lat:31.4, lon:34.4, radius:30000, color:'#ff2d2d' },
      { name:'Ukraine Front',           lat:48.5, lon:37.5, radius:300000, color:'#ff2d2d' },
    ];

    MILITARY_ZONES.forEach(zone => {
      window.L.circle([zone.lat, zone.lon], {
        radius:      zone.radius,
        color:       zone.color,
        weight:      1,
        opacity:     0.4,
        fillColor:   zone.color,
        fillOpacity: 0.04,
        dashArray:   '6 10',
      })
      .bindPopup(`
        <div style="color:${zone.color};font-family:'Orbitron',sans-serif;
                    font-size:10px;font-weight:700;margin-bottom:6px">
          ⚠ ${zone.name}
        </div>
        <div style="color:rgba(255,100,100,0.7);font-size:10px">
          STRATEGIC ZONE — ELEVATED ACTIVITY
        </div>
      `, { className: 'flight-popup' })
      .addTo(this._layerGroups.military);
    });

    const baseLayerControl = {
      '<span style="color:#48AFF0;font-size:9px;letter-spacing:.1em">SIGINT DARK</span>':    baseLayers['SIGINT DARK'],
      '<span style="color:#2D72D2;font-size:9px;letter-spacing:.1em">TACTICAL</span>':       baseLayers['TACTICAL'],
      '<span style="color:#7cff7c;font-size:9px;letter-spacing:.1em">SATELLITE</span>':      baseLayers['SATELLITE'],
      '<span style="color:#ffb300;font-size:9px;letter-spacing:.1em">TOPOGRAPHIC</span>':    baseLayers['TOPOGRAPHIC'],
      '<span style="color:#ABB3BF;font-size:9px;letter-spacing:.1em">STREETS</span>':        baseLayers['STREETS'],
    };

    const overlayControl = {
      '<span style="color:#2D72D2;font-size:9px">◉ Satellites</span>':       this._layerGroups.satellites,
      '<span style="color:#ffb300;font-size:9px">✈ Flights</span>':          this._layerGroups.flights,
      '<span style="color:#00aaff;font-size:9px">⚓ Ships</span>':            this._layerGroups.ships,
      '<span style="color:#ff4444;font-size:9px">◈ Geo Hubs</span>':         this._layerGroups.geoHubs,
      '<span style="color:#ff2d2d;font-size:9px">⚠ Earthquakes</span>':      this._layerGroups.earthquakes,
      '<span style="color:#ff4400;font-size:9px">🔥 Wildfires</span>':        this._layerGroups.wildfires,
      '<span style="color:#4488ff;font-size:9px">🌧 Weather Radar</span>':    this._layerGroups.weather,
      '<span style="color:#2D72D2;font-size:9px">✈ Airports</span>':         this._layerGroups.airports,
      '<span style="color:#ff4400;font-size:9px">⬡ Tectonic Plates</span>':  this._layerGroups.tectonics,
      '<span style="color:#0044aa;font-size:9px">⚓ Shipping Lanes</span>':   this._layerGroups.shippingLanes,
      '<span style="color:#ff00ff;font-size:9px">🔌 Undersea Cables</span>':  this._layerGroups.cables,
      '<span style="color:#ff2d2d;font-size:9px">⚔ Military Zones</span>':   this._layerGroups.military,
    };

    window.L.control.layers(baseLayerControl, overlayControl, {
      position:  'topright',
      collapsed: true,
    }).addTo(this._leaflet2D);

    if (window.L.Control && window.L.control.minimap) {
      // Only if plugin loaded
    } else {
      // Simple coordinate display instead
      const coordDisplay = window.L.control({ position: 'bottomleft' });
      coordDisplay.onAdd = function() {
        const div = window.L.DomUtil.create('div');
        div.style.cssText = `
          background: rgba(2,8,20,0.92);
          border: 1px solid rgba(45,114,210,0.15);
          padding: 6px 10px;
          font-family: 'Share Tech Mono', monospace;
          font-size: 9px;
          color: rgba(0,200,220,0.6);
          letter-spacing: .1em;
          min-width: 200px;
        `;
        div.id = 'map-coord-display';
        div.innerHTML = 'MOVE CURSOR OVER MAP';
        return div;
      };
      coordDisplay.addTo(this._leaflet2D);
      
      // Tactical hover HUD
      const mgrsHUD = document.createElement('div');
      mgrsHUD.id = 'map-mgrs-hud';
      mgrsHUD.style.cssText = `
        position:absolute; pointer-events:none; z-index:9999;
        font-family:'Share Tech Mono',monospace; font-size:10px; color:#48AFF0;
        background:rgba(0,5,10,0.85); border:1px solid rgba(45,114,210,0.3);
        padding:8px; box-shadow:0 0 10px rgba(45,114,210,0.1);
        display:none; transition: opacity 0.1s;
        backdrop-filter: blur(2px);
      `;
      // Pseudo-bracket styling
      mgrsHUD.innerHTML = `
        <style>
          #map-mgrs-hud::before { content:''; position:absolute; top:-1px;left:-1px; width:8px;height:8px; border:2px solid #2D72D2; border-right:none; border-bottom:none; }
          #map-mgrs-hud::after { content:''; position:absolute; bottom:-1px;right:-1px; width:8px;height:8px; border:2px solid #2D72D2; border-left:none; border-top:none; }
        </style>
        <div id="mgrs-hud-content"></div>
      `;
      const mapExtCont = document.getElementById('view-map2d');
      if (mapExtCont) mapExtCont.appendChild(mgrsHUD);
      
      this._leaflet2D.on('mouseover', () => mgrsHUD.style.display = 'block');
      this._leaflet2D.on('mouseout', () => mgrsHUD.style.display = 'none');

      this._leaflet2D.on('mousemove', e => {
        const el = document.getElementById('map-coord-display');
        if (el) {
          el.innerHTML = `
            LAT <b style="color:#2D72D2">${e.latlng.lat.toFixed(4)}°</b>
            &nbsp;|&nbsp;
            LON <b style="color:#2D72D2">${e.latlng.lng.toFixed(4)}°</b>
            &nbsp;|&nbsp;
            ZOOM <b style="color:#ffb300">${this._leaflet2D.getZoom()}</b>
          `;
        }
        
        if (e.originalEvent && mapExtCont) {
          const rect = mapExtCont.getBoundingClientRect();
          mgrsHUD.style.display = 'block';
          // Fix standard mouse event page coordinates to map container relative coordinates
          mgrsHUD.style.left = (e.originalEvent.clientX - rect.left + 15) + 'px';
          mgrsHUD.style.top  = (e.originalEvent.clientY - rect.top + 15) + 'px';
          
          const lat = Math.abs(e.latlng.lat);
          const lng = Math.abs(e.latlng.lng);
          const latH = e.latlng.lat >= 0 ? 'N' : 'S';
          const lngH = e.latlng.lng >= 0 ? 'E' : 'W';
          
          const cont = document.getElementById('mgrs-hud-content');
          if (cont) {
            cont.innerHTML = `
              <div style="font-weight:bold;color:#fff;margin-bottom:3px;letter-spacing:0.1em;">TACTICAL REF</div>
              <div style="margin-bottom:2px">LAT: ${lat.toFixed(5)}° ${latH}</div>
              <div>LON: ${lng.toFixed(5)}° ${lngH}</div>
              <div style="color:rgba(45,114,210,0.5);margin-top:4px;border-top:1px solid rgba(45,114,210,0.15);padding-top:2px;">
                Z:${this._leaflet2D.getZoom()} | TRK: ACTIVE
              </div>
            `;
          }
        }
      });
    }

    // ── Context menu ────────────────────────────────────────
    this._initMapContextMenu();

    // ── Map toolbar ─────────────────────────────────────────
    this._buildMapToolbar();

    // ── Geo hubs ────────────────────────────────────────────
    this._loadGeoHubMarkers();

    // ── Mini-map ────────────────────────────────────────────
    if (window.L.Control && window.L.Control.MiniMap) {
      const miniTile = window.L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        { subdomains: 'abcd', attribution: '' }
      );
      new window.L.Control.MiniMap(miniTile, {
        toggleDisplay: true,
        minimized:     false,
        position:      'bottomright',
        width:         140,
        height:        100,
      }).addTo(this._leaflet2D);
    }

    // ── Coordinate display on mousemove ─────────────────────
    this._leaflet2D.on('mousemove', e => {
      const el = document.getElementById('map-cursor-coords');
      if (el) el.textContent = `${e.latlng.lat.toFixed(4)}°  ${e.latlng.lng.toFixed(4)}°  Z${this._leaflet2D.getZoom()}`;
    });

    // ── Heat layer init ─────────────────────────────────────
    this._initHeatLayer();

    // ── Start refresh age timer ─────────────────────────────
    this._refreshTimer = setInterval(() => this._updateMapRefreshAge(), 5000);

    // ── Timeline scrubber ───────────────────────────────────
    this._initTimelineScrubber();

    // ── Phase 3: Viewport counter + bearing lines ────────────
    this._initViewportCounter();
    setTimeout(() => this._updateViewportCount(), 1500);

    // ── Initial data ────────────────────────────────────────
    setTimeout(() => this._refreshLeafletMarkers(), 500);
    NemesisUI.log('2D tactical map — SIGINT DARK view active', 'ok');
  }

  // ── Build map toolbar ──────────────────────────────────────
  _buildMapToolbar() {
    const existing = document.getElementById('map-toolbar');
    if (existing) {
      if (['map_2d','maritime'].includes(this._current)) {
        existing.classList.add('visible');
      } else {
        existing.classList.remove('visible');
      }
      return;
    }

    const tb = document.createElement('div');
    tb.id = 'map-toolbar';
    tb.innerHTML = `
      <span class="maptb-label">OBJ</span>
      <button class="maptb-pill active" data-filter="satellites" id="mapf-sat">🛰 SATS <span id="mapf-sat-ct">—</span></button>
      <button class="maptb-pill active" data-filter="flights"   id="mapf-flt">✈ AIR <span id="mapf-flt-ct">—</span></button>
      <button class="maptb-pill active" data-filter="ships"     id="mapf-shp">⚓ SHIPS <span id="mapf-shp-ct">—</span></button>
      <button class="maptb-pill active" data-filter="hubs"      id="mapf-hub">◈ HUBS</button>
      <div class="maptb-sep"></div>
      <span class="maptb-label">TOOLS</span>
      <button class="maptb-tool" id="maptb-heat"    title="Toggle density heatmap">🔥 HEAT</button>
      <button class="maptb-tool" id="maptb-measure" title="Measure great-circle distance">📏 DIST</button>
      <button class="maptb-tool" id="maptb-grid"    title="Toggle coordinate grid">▦ GRID</button>
      <button class="maptb-tool" id="maptb-draw"    title="Draw geofence polygon/circle">✎ DRAW</button>
      <button class="maptb-tool" id="maptb-bearing" title="Toggle flight bearing lines">⤳ BEARINGS</button>
      <button class="maptb-tool" id="maptb-rings"   title="Proximity range rings">◎ RINGS</button>
      <button class="maptb-tool" id="maptb-trails"  title="Toggle flight breadcrumb trails">⋯ TRAILS</button>
      <button class="maptb-tool" id="maptb-datalink" title="Toggle satellite data links to ground stations">⟁ LINKS</button>
      <button class="maptb-tool" id="maptb-sigint" title="SIGINT RF waterfall spectrogram">📡 SIGINT</button>
      <button class="maptb-tool" id="maptb-osc" title="Telemetry waveform oscilloscope">〰 SCOPE</button>
      <div class="maptb-sep"></div>
      <input id="map-search-input" placeholder="⌕  Callsign / NORAD / vessel" autocomplete="off" />
      <div class="maptb-live">
        <span class="maptb-dot"></span>
        <span id="map-refresh-age">LIVE</span>
      </div>
    `;
    document.body.appendChild(tb);
    if (['map_2d','maritime'].includes(this._current)) {
      tb.classList.add('visible');
    }

    // Filter pills
    tb.querySelectorAll('.maptb-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const f = btn.dataset.filter;
        this._mapFilters[f] = !this._mapFilters[f];
        btn.classList.toggle('active', this._mapFilters[f]);
        this._refreshLeafletMarkers();
      });
    });

    document.getElementById('maptb-heat')?.addEventListener('click', e => {
      this._toggleHeatmap();
      e.currentTarget.classList.toggle('active');
    });
    document.getElementById('maptb-measure')?.addEventListener('click', e => {
      this._toggleMeasure();
      e.currentTarget.classList.toggle('active');
    });
    document.getElementById('maptb-grid')?.addEventListener('click', e => {
      this._toggleGrid();
      e.currentTarget.classList.toggle('active');
    });
    document.getElementById('maptb-draw')?.addEventListener('click', e => {
      this._toggleDrawMode();
      e.currentTarget.classList.toggle('active');
    });
    document.getElementById('maptb-bearing')?.addEventListener('click', e => {
      this._toggleBearingLines();
      e.currentTarget.classList.toggle('active');
    });
    document.getElementById('maptb-rings')?.addEventListener('click', e => {
      this._toggleProximityRings();
      e.currentTarget.classList.toggle('active');
    });
    // Phase 4: Trails toggle
    document.getElementById('maptb-trails')?.addEventListener('click', e => {
      this._trailsVisible = !this._trailsVisible;
      e.currentTarget.classList.toggle('active', this._trailsVisible);
      if (!this._trailsVisible && this._trailLayer) {
        this._trailLayer.clearLayers();
      }
      this._refreshLeafletMarkers();
      NemesisUI.log(`Flight trails: ${this._trailsVisible ? 'ON' : 'OFF'}`);
    });

    // Phase 6: Datalink topology toggle
    this._datalinkEnabled = true;
    document.getElementById('maptb-datalink')?.addEventListener('click', e => {
      this._datalinkEnabled = !this._datalinkEnabled;
      e.currentTarget.classList.toggle('active', this._datalinkEnabled);
      if (!this._datalinkEnabled && this._datalinkLayer) {
        this._datalinkLayer.clearLayers();
      }
      this._refreshLeafletMarkers();
      NemesisUI.log(`Data links: ${this._datalinkEnabled ? 'ON' : 'OFF'}`);
    });

    // Phase VII: SIGINT waterfall toggle
    document.getElementById('maptb-sigint')?.addEventListener('click', e => {
      this._toggleWaterfall();
      e.currentTarget.classList.toggle('sigint-active');
    });

    // Phase VII: Oscilloscope toggle
    document.getElementById('maptb-osc')?.addEventListener('click', e => {
      this._toggleOscilloscope();
      e.currentTarget.classList.toggle('osc-active');
    });

    // Phase 4: Follow mode global handler
    window.__nemesisMapFollow = (id, name, type) => {
      this._followTarget = { id, name, type };
      this._showFollowIndicator(name || id);
      NemesisUI.log(`FOLLOW: Tracking ${name || id}`, 'ok');
    };

    const si = document.getElementById('map-search-input');
    if (si) {
      si.addEventListener('input',   () => this._mapSearch(si.value));
      si.addEventListener('keydown', e => { if (e.key === 'Escape') { si.value = ''; this._clearMapSearch(); } });
    }
  }

  // ── Geo hub markers ───────────────────────────────────────
  _loadGeoHubMarkers() {
    if (!this._leaflet2D || !window.L || !this._layerGroups) return;
    fetch('http://localhost:8000/api/geo-hubs')
      .then(r => r.json())
      .then(data => {
        if (!this._mapFilters.hubs) return;
        const hubs = (data.hubs || []).filter(h => h.tier === 'critical' || h.tier === 'major');
        hubs.forEach(hub => {
          const isCrit = hub.tier === 'critical';
          const col    = isCrit ? '#ff4444' : '#ff8800';
          const sz     = isCrit ? 10 : 7;
          const icon   = window.L.divIcon({
            html: `
              <svg width="${sz*2}" height="${sz*2}" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                <polygon points="10,2 18,10 10,18 2,10" fill="${col}" fill-opacity="0.25" stroke="${col}" stroke-width="1.5"/>
                <circle  cx="10" cy="10" r="2.5" fill="${col}"/>
                ${ isCrit ? `<circle cx="10" cy="10" r="8" fill="none" stroke="${col}" stroke-width="0.7" opacity="0.5" stroke-dasharray="2 2"/>` : '' }
              </svg>`,
            iconSize:   [sz*2, sz*2],
            iconAnchor: [sz, sz],
            className:  '',
          });
          window.L.marker([hub.lat, hub.lon], { icon })
            .bindPopup(`
              <div class="asset-popup">
                <div class="asset-popup-title" style="color:${col}">
                  ${isCrit ? '⚠' : '◈'} ${hub.name}
                </div>
                <div class="asset-popup-row"><span class="asset-popup-lbl">TIER</span>
                  <span class="asset-popup-val" style="color:${col}">${(hub.tier||'').toUpperCase()}</span></div>
                <div class="asset-popup-row"><span class="asset-popup-lbl">TYPE</span>
                  <span class="asset-popup-val">${(hub.type||'').toUpperCase()}</span></div>
                <div class="asset-popup-row"><span class="asset-popup-lbl">LAT/LON</span>
                  <span class="asset-popup-val">${hub.lat?.toFixed(2)}° / ${hub.lon?.toFixed(2)}°</span></div>
              </div>
            `)
            .addTo(this._layerGroups?.hubs || this._leaflet2D);
        });
      }).catch(() => {});
  }

  // ── Heat layer ────────────────────────────────────────────
  _initHeatLayer() {
    if (!window.L.heatLayer || !this._leaflet2D) return;
    this._heatLayer = window.L.heatLayer([], {
      radius:  25,
      blur:    20,
      maxZoom: 8,
      gradient: { 0.0: 'rgba(17,20,24,0)', 0.15: '#0a1628', 0.35: '#0d3868', 0.5: '#2D72D2', 0.65: '#48AFF0', 0.8: '#D1980B', 0.95: '#CD4246', 1.0: '#ff6666' },
    });
  }

  _toggleHeatmap() {
    if (!this._heatLayer || !this._leaflet2D) return;
    this._heatVisible = !this._heatVisible;
    if (this._heatVisible) {
      // Populate with flight + ship positions
      const pts = [
        ...(this._flights || []).filter(f => f.lat && f.lon).map(f => [f.lat, f.lon, 0.5]),
        ...(this._ships   || []).filter(s => s.lat && s.lon).map(s => [s.lat, s.lon, 0.3]),
      ];
      this._heatLayer.setLatLngs(pts);
      this._heatLayer.addTo(this._leaflet2D);
      NemesisUI.log(`Heat map: ${pts.length} points`, 'ok');
    } else {
      this._leaflet2D.removeLayer(this._heatLayer);
    }
  }

  // ── Measure tool ─────────────────────────────────────────
  _toggleMeasure() {
    this._measureMode = !this._measureMode;
    this._measurePts  = [];
    const container   = document.getElementById('view-map2d');
    if (!container) return;
    container.classList.toggle('map-measure-active', this._measureMode);
    if (this._measureLine) { this._leaflet2D?.removeLayer(this._measureLine); this._measureLine = null; }

    if (this._measureMode) {
      NemesisUI.log('📏 Measure: click two points on the map');
      this._leaflet2D?.on('click', this._measureClickHandler = e => {
        this._measurePts.push([e.latlng.lat, e.latlng.lng]);
        if (this._measurePts.length === 2) {
          const [p1, p2] = this._measurePts;
          const dist = this._mapHaversine(p1[0], p1[1], p2[0], p2[1]);
          if (this._measureLine) this._leaflet2D.removeLayer(this._measureLine);
          this._measureLine = window.L.polyline(this._measurePts, {
            color:  '#ffd060',
            weight: 2,
            dashArray: '6 4',
            opacity: 0.85,
          }).addTo(this._leaflet2D);
          // Midpoint label
          const mid = [(p1[0]+p2[0])/2, (p1[1]+p2[1])/2];
          window.L.marker(mid, { icon: window.L.divIcon({
            html: `<div style="background:rgba(0,3,14,.95);border:1px solid rgba(255,208,0,.4);color:#ffd060;font:700 10px 'Orbitron',mono;padding:3px 8px;white-space:nowrap">${dist.toFixed(0)} km · ${(dist*0.539957).toFixed(0)} NM</div>`,
            className: '', iconAnchor: [40,12],
          })}).addTo(this._leaflet2D);
          NemesisUI.log(`📏 ${dist.toFixed(0)} km  (${(dist*0.539957).toFixed(0)} NM)`, 'ok');
          this._measurePts = [];
        }
      });
    } else {
      if (this._measureClickHandler) this._leaflet2D?.off('click', this._measureClickHandler);
    }
  }

  // ── Geofence Draw ─────────────────────────────────────────
  _toggleGeofence() {
    this._geofenceMode = !this._geofenceMode;
    this._geofencePts  = [];
    const container    = document.getElementById('view-map2d');
    if (!container) return;
    
    container.classList.toggle('map-setup-active', this._geofenceMode);
    
    if (this._geofencePoly) { this._leaflet2D?.removeLayer(this._geofencePoly); this._geofencePoly = null; }

    if (this._geofenceMode) {
      NemesisUI.log('🛡️ Geofence: click points to draw Area of Interest. Right click to close poly.');
      
      this._leaflet2D?.on('click', this._geofenceClickHandler = e => {
        this._geofencePts.push([e.latlng.lat, e.latlng.lng]);
        
        if (this._geofencePoly) this._leaflet2D.removeLayer(this._geofencePoly);
        
        this._geofencePoly = window.L.polygon(this._geofencePts, {
          color:  '#ff4444',
          weight: 2,
          fillColor: '#ff0000',
          fillOpacity: 0.1,
          dashArray: '5 5'
        }).addTo(this._leaflet2D);
      });
      
      this._leaflet2D?.on('contextmenu', this._geofenceCloseHandler = e => {
        if (this._geofencePts.length > 2) {
          NemesisUI.log('🛡️ Geofence established. Area secured.', 'alert');
          this._geofenceMode = false;
          container.classList.remove('map-setup-active');
          this._leaflet2D.off('click', this._geofenceClickHandler);
          this._leaflet2D.off('contextmenu', this._geofenceCloseHandler);
        }
      });
    } else {
      if (this._geofenceClickHandler) this._leaflet2D?.off('click', this._geofenceClickHandler);
      if (this._geofenceCloseHandler) this._leaflet2D?.off('contextmenu', this._geofenceCloseHandler);
    }
  }

  // ── Grid overlay ─────────────────────────────────────────
  _toggleGrid() {
    if (!this._leaflet2D || !window.L) return;
    this._gridVisible = !this._gridVisible;
    if (this._gridVisible) {
      // Approximate grid using polylines at 15° intervals
      const lines = [];
      for (let lat = -75; lat <= 75; lat += 15) {
        lines.push(window.L.polyline([[lat, -180], [lat, 180]], { color:'rgba(45,114,210,0.10)', weight:0.5, interactive: false }));
      }
      for (let lng = -180; lng <= 180; lng += 15) {
        lines.push(window.L.polyline([[-90, lng], [90, lng]], { color:'rgba(45,114,210,0.10)', weight:0.5, interactive: false }));
      }
      // Note: Leaflet doesn't support MGRS natively; use simple lat/lng graticule
      this._gridLayer = window.L.featureGroup(lines).addTo(this._leaflet2D);
      NemesisUI.log('Grid overlay ON');
    } else {
      if (this._gridLayer) { this._leaflet2D.removeLayer(this._gridLayer); this._gridLayer = null; }
    }
  }

  // ── Map search ───────────────────────────────────────────
  _mapSearch(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) { this._clearMapSearch(); return; }
    const allMarkers = {
      sats:  this._satellites || [],
      flts:  this._flights || [],
      ships: this._ships || [],
    };
    const match = [
      ...allMarkers.sats .filter(s => s.name?.toLowerCase().includes(q) || String(s.id).includes(q)),
      ...allMarkers.flts .filter(f => f.callsign?.toLowerCase().includes(q) || f.icao24?.toLowerCase().includes(q)),
      ...allMarkers.ships.filter(s => s.name?.toLowerCase().includes(q)   || String(s.mmsi).includes(q)),
    ][0];
    if (match && match.lat && match.lon) {
      this._leaflet2D?.flyTo([match.lat, match.lon], 6, { duration: 1.4 });
      NemesisUI.log(`Map: flew to ${match.name || match.callsign || query}`, 'ok');
    }
  }
  _clearMapSearch() {}

  // ═══════════════════════════════════════════════════════════
  // PHASE 3: GEOFENCE DRAWING TOOLS
  // ═══════════════════════════════════════════════════════════

  _toggleDrawMode() {
    if (!this._leaflet2D || !window.L.Draw) return;

    if (this._drawControl) {
      // Turn off draw mode
      this._leaflet2D.removeControl(this._drawControl);
      this._drawControl = null;
      document.getElementById('draw-subtoolbar')?.remove();
      return;
    }

    // Create drawn items layer
    if (!this._drawnItems) {
      this._drawnItems = new window.L.FeatureGroup();
      this._leaflet2D.addLayer(this._drawnItems);
    }

    // Add draw control
    this._drawControl = new window.L.Control.Draw({
      position: 'topleft',
      draw: {
        polygon: {
          shapeOptions: { color: '#2D72D2', weight: 2, fillOpacity: 0.08, fillColor: '#2D72D2', dashArray: '6 4' },
          allowIntersection: false,
        },
        circle: {
          shapeOptions: { color: '#48AFF0', weight: 2, fillOpacity: 0.06, fillColor: '#48AFF0', dashArray: '6 4' },
        },
        rectangle: {
          shapeOptions: { color: '#2D72D2', weight: 2, fillOpacity: 0.06, fillColor: '#2D72D2', dashArray: '6 4' },
        },
        polyline: false,
        marker: false,
        circlemarker: false,
      },
      edit: {
        featureGroup: this._drawnItems,
        remove: true,
      },
    });
    this._leaflet2D.addControl(this._drawControl);

    // Build sub-toolbar
    const sub = document.createElement('div');
    sub.id = 'draw-subtoolbar';
    sub.className = 'visible';
    sub.innerHTML = `
      <button class="draw-sub-btn" id="dsub-clear">✕ CLEAR ALL</button>
    `;
    document.body.appendChild(sub);

    document.getElementById('dsub-clear')?.addEventListener('click', () => {
      this._drawnItems?.clearLayers();
      document.getElementById('geofence-results')?.remove();
    });

    // Listen for draw:created
    if (!this._drawEventBound) {
      this._drawEventBound = true;
      this._leaflet2D.on(window.L.Draw.Event.CREATED, (e) => {
        const layer = e.layer;
        this._drawnItems.addLayer(layer);
        this._analyzeGeofence(layer, e.layerType);
      });
    }
  }

  _analyzeGeofence(layer, type) {
    // Count entities inside the drawn shape
    let satsInside = 0, flightsInside = 0, shipsInside = 0;
    const bounds = layer.getBounds ? layer.getBounds() : null;
    const isCircle = type === 'circle';
    const center = isCircle ? layer.getLatLng() : null;
    const radius = isCircle ? layer.getRadius() : 0;

    const isInside = (lat, lon) => {
      if (!lat || !lon) return false;
      if (isCircle) {
        return center.distanceTo(window.L.latLng(lat, lon)) <= radius;
      }
      if (bounds) {
        return bounds.contains(window.L.latLng(lat, lon));
      }
      // Polygon point-in-polygon check using layer.getBounds as fallback
      if (layer.getBounds) {
        return layer.getBounds().contains(window.L.latLng(lat, lon));
      }
      return false;
    };

    (this._satellites || []).forEach(s => { if (isInside(s.lat, s.lon)) satsInside++; });
    (this._flights || []).forEach(f => { if (isInside(f.latitude, f.longitude)) flightsInside++; });
    (this._ships || []).forEach(s => { if (isInside(s.lat, s.lon)) shipsInside++; });

    const total = satsInside + flightsInside + shipsInside;

    // Calculate area
    let areaKm2 = 0;
    let perimeterKm = 0;
    if (isCircle) {
      areaKm2 = Math.PI * Math.pow(radius / 1000, 2);
      perimeterKm = 2 * Math.PI * (radius / 1000);
    } else if (layer.getLatLngs) {
      const latlngs = layer.getLatLngs()[0] || layer.getLatLngs();
      // Approximate area using shoelace on projected coords
      if (latlngs.length >= 3) {
        let area = 0;
        for (let i = 0; i < latlngs.length; i++) {
          const j = (i + 1) % latlngs.length;
          const xi = latlngs[i].lng * Math.cos(latlngs[i].lat * Math.PI / 180) * 111.32;
          const yi = latlngs[i].lat * 110.574;
          const xj = latlngs[j].lng * Math.cos(latlngs[j].lat * Math.PI / 180) * 111.32;
          const yj = latlngs[j].lat * 110.574;
          area += xi * yj - xj * yi;
        }
        areaKm2 = Math.abs(area) / 2;
        // Perimeter
        for (let i = 0; i < latlngs.length; i++) {
          const j = (i + 1) % latlngs.length;
          perimeterKm += latlngs[i].distanceTo(latlngs[j]) / 1000;
        }
      }
    }

    this._showGeofenceResults({ satsInside, flightsInside, shipsInside, total, areaKm2, perimeterKm, type, layer });
  }

  _showGeofenceResults({ satsInside, flightsInside, shipsInside, total, areaKm2, perimeterKm, type }) {
    document.getElementById('geofence-results')?.remove();

    const card = document.createElement('div');
    card.id = 'geofence-results';
    card.innerHTML = `
      <div class="gf-header">
        <span class="gf-title">◈ GEOFENCE ANALYSIS</span>
        <button class="gf-close" id="gf-close">✕</button>
      </div>
      <div class="gf-body">
        <div class="gf-stat">
          <span class="gf-stat-lbl">TYPE</span>
          <span class="gf-stat-val">${type.toUpperCase()}</span>
        </div>
        <div class="gf-stat">
          <span class="gf-stat-lbl">AREA</span>
          <span class="gf-stat-val">${areaKm2 < 1 ? (areaKm2 * 1e6).toFixed(0) + ' m²' : areaKm2.toFixed(1) + ' km²'}</span>
        </div>
        <div class="gf-stat">
          <span class="gf-stat-lbl">PERIMETER</span>
          <span class="gf-stat-val">${perimeterKm.toFixed(1)} km</span>
        </div>
        <div style="margin-top:8px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.04)">
          <div class="gf-stat" style="border:none">
            <span class="gf-stat-lbl">ENTITIES INSIDE</span>
            <span class="gf-stat-val highlight">${total}</span>
          </div>
          <div class="gf-entity-row">
            <span class="gf-entity-icon">🛰 <span style="color:#5F6B7C;font-size:9px">SATS</span></span>
            <span class="gf-entity-count">${satsInside}</span>
          </div>
          <div class="gf-entity-row">
            <span class="gf-entity-icon">✈ <span style="color:#5F6B7C;font-size:9px">FLIGHTS</span></span>
            <span class="gf-entity-count">${flightsInside}</span>
          </div>
          <div class="gf-entity-row">
            <span class="gf-entity-icon">⚓ <span style="color:#5F6B7C;font-size:9px">SHIPS</span></span>
            <span class="gf-entity-count">${shipsInside}</span>
          </div>
        </div>
      </div>
      <div class="gf-actions">
        <button class="gf-action-btn" id="gf-zoom">ZOOM TO</button>
        <button class="gf-action-btn" id="gf-clear">CLEAR</button>
      </div>
    `;
    document.body.appendChild(card);

    document.getElementById('gf-close')?.addEventListener('click', () => card.remove());
    document.getElementById('gf-clear')?.addEventListener('click', () => {
      this._drawnItems?.clearLayers();
      card.remove();
    });
    document.getElementById('gf-zoom')?.addEventListener('click', () => {
      if (this._drawnItems && this._drawnItems.getLayers().length > 0) {
        this._leaflet2D?.fitBounds(this._drawnItems.getBounds(), { padding: [40, 40] });
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 3: FLIGHT BEARING LINES
  // ═══════════════════════════════════════════════════════════

  _toggleBearingLines() {
    if (!this._leaflet2D) return;
    this._bearingVisible = !this._bearingVisible;

    if (!this._bearingVisible) {
      if (this._bearingLayer) {
        this._leaflet2D.removeLayer(this._bearingLayer);
        this._bearingLayer = null;
      }
      return;
    }
    this._renderBearingLines();
  }

  _renderBearingLines() {
    if (!this._leaflet2D || !this._bearingVisible) return;

    if (this._bearingLayer) {
      this._leaflet2D.removeLayer(this._bearingLayer);
    }
    this._bearingLayer = window.L.layerGroup();

    (this._flights || []).forEach(f => {
      if (!f.latitude || !f.longitude || f.on_ground) return;
      const heading = f.true_track || 0;
      const speed = f.velocity || 0;
      const len = Math.min(Math.max(speed * 0.008, 0.3), 3); // degrees, proportional to speed

      const rad = (heading - 90) * Math.PI / 180;
      const endLat = f.latitude + Math.sin((heading) * Math.PI / 180) * len;
      const endLon = f.longitude + Math.cos((90 - heading) * Math.PI / 180) * len;

      const line = window.L.polyline(
        [[f.latitude, f.longitude], [endLat, endLon]],
        {
          color: '#48AFF0',
          weight: 1.5,
          opacity: 0.5,
          dashArray: '4 6',
          className: 'bearing-line',
        }
      );
      this._bearingLayer.addLayer(line);
    });

    this._bearingLayer.addTo(this._leaflet2D);
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 3: PROXIMITY RANGE RINGS
  // ═══════════════════════════════════════════════════════════

  _toggleProximityRings() {
    if (!this._leaflet2D) return;
    this._proxRingMode = !this._proxRingMode;

    if (!this._proxRingMode) {
      // Remove existing rings
      if (this._proxRings) {
        this._leaflet2D.removeLayer(this._proxRings);
        this._proxRings = null;
      }
      if (this._proxClickHandler) {
        this._leaflet2D.off('click', this._proxClickHandler);
        this._proxClickHandler = null;
      }
      this._leaflet2D.getContainer().style.cursor = '';
      return;
    }

    this._leaflet2D.getContainer().style.cursor = 'crosshair';
    this._proxClickHandler = (e) => this._placeProximityRings(e.latlng);
    this._leaflet2D.on('click', this._proxClickHandler);
  }

  _placeProximityRings(center) {
    if (!this._leaflet2D) return;

    // Remove old rings
    if (this._proxRings) {
      this._leaflet2D.removeLayer(this._proxRings);
    }
    this._proxRings = window.L.layerGroup();

    const NM_TO_M = 1852;
    const bands = [
      { nm: 25,  color: 'rgba(45,114,210,0.30)', fill: 'rgba(45,114,210,0.03)' },
      { nm: 50,  color: 'rgba(45,114,210,0.22)', fill: 'rgba(45,114,210,0.02)' },
      { nm: 100, color: 'rgba(72,175,240,0.18)', fill: 'rgba(72,175,240,0.01)' },
      { nm: 200, color: 'rgba(72,175,240,0.12)', fill: 'rgba(72,175,240,0.008)' },
    ];

    // Count entities per band
    const countInBand = (innerM, outerM) => {
      let sats = 0, flights = 0, ships = 0;
      const check = (lat, lon) => {
        if (!lat || !lon) return null;
        const d = center.distanceTo(window.L.latLng(lat, lon));
        return d > innerM && d <= outerM;
      };
      (this._satellites || []).forEach(s => { if (check(s.lat, s.lon)) sats++; });
      (this._flights || []).forEach(f => { if (check(f.latitude, f.longitude)) flights++; });
      (this._ships || []).forEach(s => { if (check(s.lat, s.lon)) ships++; });
      return { sats, flights, ships, total: sats + flights + ships };
    };

    let prevRadius = 0;
    bands.forEach(band => {
      const radiusM = band.nm * NM_TO_M;
      const ring = window.L.circle(center, {
        radius: radiusM,
        color: band.color,
        weight: 1.5,
        fillColor: band.fill,
        fillOpacity: 1,
        dashArray: '8 6',
        interactive: false,
      });
      this._proxRings.addLayer(ring);

      // Label at north of ring
      const labelLat = center.lat + (radiusM / 111000);
      const counts = countInBand(prevRadius, radiusM);
      const label = window.L.marker([labelLat, center.lng], {
        icon: window.L.divIcon({
          html: `<div style="
            font-family:'JetBrains Mono',monospace; font-size:8px; color:#48AFF0;
            background:rgba(17,20,24,0.9); padding:2px 6px; border:1px solid rgba(45,114,210,0.2);
            white-space:nowrap; text-align:center;
          ">${band.nm}NM · ${counts.total} entities</div>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
          className: '',
        }),
        interactive: false,
      });
      this._proxRings.addLayer(label);
      prevRadius = radiusM;
    });

    // Center marker
    const centerMark = window.L.circleMarker(center, {
      radius: 4, color: '#2D72D2', fillColor: '#2D72D2', fillOpacity: 1, weight: 0,
    });
    this._proxRings.addLayer(centerMark);
    this._proxRings.addTo(this._leaflet2D);
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 3: VIEWPORT ENTITY COUNTER
  // ═══════════════════════════════════════════════════════════

  _initViewportCounter() {
    if (document.getElementById('viewport-counter')) return;

    const vc = document.createElement('div');
    vc.id = 'viewport-counter';
    vc.innerHTML = `
      <div class="vc-item">🛰 <span class="vc-count" id="vc-sats">0</span></div>
      <div class="vc-sep"></div>
      <div class="vc-item">✈ <span class="vc-count" id="vc-flights">0</span></div>
      <div class="vc-sep"></div>
      <div class="vc-item">⚓ <span class="vc-count" id="vc-ships">0</span></div>
      <div class="vc-sep"></div>
      <span class="vc-label">VIEWPORT</span>
    `;
    document.body.appendChild(vc);

    if (['map_2d','maritime'].includes(this._current)) vc.classList.add('visible');

    // Auto-update on map move
    if (this._leaflet2D) {
      this._leaflet2D.on('moveend zoomend', () => this._updateViewportCount());
      // Phase 5: Re-render markers on zoom change for density management
      let lastZoom = this._leaflet2D.getZoom();
      this._leaflet2D.on('zoomend', () => {
        const newZoom = this._leaflet2D.getZoom();
        // Only re-render if zoom crossed a threshold that changes entity filtering
        if ((lastZoom < 4 && newZoom >= 4) || (lastZoom >= 4 && newZoom < 4) ||
            (lastZoom < 5 && newZoom >= 5) || (lastZoom >= 5 && newZoom < 5) ||
            (lastZoom < 6 && newZoom >= 6) || (lastZoom >= 6 && newZoom < 6)) {
          this._refreshLeafletMarkers();
        }
        lastZoom = newZoom;
      });
    }
  }

  _updateViewportCount() {
    if (!this._leaflet2D) return;
    const bounds = this._leaflet2D.getBounds();
    if (!bounds) return;

    let sats = 0, flights = 0, ships = 0;
    (this._satellites || []).forEach(s => {
      if (s.lat && s.lon && bounds.contains(window.L.latLng(s.lat, s.lon))) sats++;
    });
    (this._flights || []).forEach(f => {
      if (f.latitude && f.longitude && bounds.contains(window.L.latLng(f.latitude, f.longitude))) flights++;
    });
    (this._ships || []).forEach(s => {
      if (s.lat && s.lon && bounds.contains(window.L.latLng(s.lat, s.lon))) ships++;
    });

    const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    el('vc-sats', sats);
    el('vc-flights', flights);
    el('vc-ships', ships);
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 4: FOLLOW MODE INDICATOR
  // ═══════════════════════════════════════════════════════════

  _showFollowIndicator(name) {
    let ind = document.getElementById('follow-indicator');
    if (!ind) {
      ind = document.createElement('div');
      ind.id = 'follow-indicator';
      document.body.appendChild(ind);
    }
    ind.innerHTML = `
      <div class="follow-dot"></div>
      <span>FOLLOWING: <b>${name}</b></span>
      <button class="follow-cancel" id="follow-cancel-btn">✕ CANCEL</button>
    `;
    ind.classList.add('visible');
    document.getElementById('follow-cancel-btn')?.addEventListener('click', () => this._cancelFollow());

    // Escape key to cancel
    this.__followEscHandler = (e) => {
      if (e.key === 'Escape') this._cancelFollow();
    };
    document.addEventListener('keydown', this.__followEscHandler);
  }

  _cancelFollow() {
    this._followTarget = null;
    const ind = document.getElementById('follow-indicator');
    if (ind) ind.classList.remove('visible');
    if (this.__followEscHandler) {
      document.removeEventListener('keydown', this.__followEscHandler);
      this.__followEscHandler = null;
    }
    
    // --- PHASE 6: Threat Radius ---
    if (this._threatRadius) { this._leaflet2D?.removeLayer(this._threatRadius); this._threatRadius = null; }
    if (this._threatLines)  { this._leaflet2D?.removeLayer(this._threatLines);  this._threatLines = null; }
    
    NemesisUI.log('Follow mode cancelled');
  }

  // ═══════════════════════════════════════════════════════════
  // TEMPORAL TIMELINE SCRUBBER
  // ═══════════════════════════════════════════════════════════

  _initTimelineScrubber() {
    if (!this._leaflet2D) return;
    const existing = document.getElementById('timeline-scrubber');
    if (existing) { existing.style.display = 'flex'; return; }

    const wrap = document.createElement('div');
    wrap.id = 'timeline-scrubber';
    wrap.innerHTML = `
      <style>
        #timeline-scrubber {
          position: fixed;
          bottom: calc(var(--bottom-h, 92px) + 2px);
          left:   var(--left-w, 200px);
          right:  var(--right-w, 280px);
          height: 38px;
          z-index: 300;
          background: rgba(17, 20, 24, 0.92);
          backdrop-filter: blur(12px);
          border-top: 1px solid rgba(255,255,255,0.04);
          display: flex;
          align-items: center;
          padding: 0 14px;
          gap: 10px;
          font-family: Inter, system-ui, sans-serif;
        }
        .tl-label {
          font-size: 8px;
          font-weight: 600;
          color: #5F6B7C;
          letter-spacing: 0.12em;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .tl-track-wrap {
          flex: 1;
          height: 20px;
          position: relative;
          cursor: pointer;
        }
        .tl-track {
          position: absolute;
          top: 9px;
          left: 0; right: 0;
          height: 2px;
          background: rgba(255,255,255,0.06);
          border-radius: 1px;
        }
        .tl-filled {
          position: absolute;
          top: 9px;
          height: 2px;
          background: linear-gradient(90deg, rgba(45,114,210,0.2), rgba(45,114,210,0.6));
          border-radius: 1px;
          pointer-events: none;
        }
        .tl-now {
          position: absolute;
          top: 4px;
          width: 2px;
          height: 12px;
          background: #2D72D2;
          box-shadow: 0 0 6px rgba(45,114,210,0.5);
          border-radius: 1px;
          pointer-events: none;
        }
        .tl-handle {
          position: absolute;
          top: 4px;
          width: 8px;
          height: 12px;
          background: #ABB3BF;
          border-radius: 2px;
          cursor: ew-resize;
          z-index: 2;
          transition: background 0.1s;
        }
        .tl-handle:hover, .tl-handle.active { background: #F6F7F9; }
        .tl-ticks {
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 20px;
          pointer-events: none;
        }
        .tl-tick {
          position: absolute;
          top: 12px;
          width: 1px;
          height: 4px;
          background: rgba(255,255,255,0.08);
        }
        .tl-tick-label {
          position: absolute;
          top: 1px;
          font-size: 7px;
          color: rgba(171,179,191,0.4);
          font-family: 'JetBrains Mono', monospace;
          transform: translateX(-50%);
          white-space: nowrap;
        }
        .tl-range-label {
          font-family: 'JetBrains Mono', monospace;
          font-size: 9px;
          color: #ABB3BF;
          white-space: nowrap;
          flex-shrink: 0;
          min-width: 110px;
          text-align: center;
        }
        .tl-clock {
          font-family: 'JetBrains Mono', monospace;
          font-size: 9px;
          color: #2D72D2;
          white-space: nowrap;
          flex-shrink: 0;
        }
      </style>
      <div class="tl-label">TEMPORAL</div>
      <div class="tl-track-wrap" id="tl-track-wrap">
        <div class="tl-track"></div>
        <div class="tl-ticks" id="tl-ticks"></div>
        <div class="tl-filled" id="tl-filled"></div>
        <div class="tl-now" id="tl-now"></div>
        <div class="tl-handle" id="tl-handle-l" style="left:70%"></div>
        <div class="tl-handle" id="tl-handle-r" style="left:100%"></div>
      </div>
      <div class="tl-range-label" id="tl-range-label">LAST 6H</div>
      <div class="tl-clock" id="tl-clock">00:00Z</div>
    `;

    document.body.appendChild(wrap);

    // Draw hour ticks
    const ticksEl = document.getElementById('tl-ticks');
    for (let h = 0; h <= 24; h += 3) {
      const pct = (h / 24) * 100;
      const tick = document.createElement('div');
      tick.className = 'tl-tick';
      tick.style.left = pct + '%';
      ticksEl.appendChild(tick);
      if (h % 6 === 0) {
        const lbl = document.createElement('div');
        lbl.className = 'tl-tick-label';
        lbl.style.left = pct + '%';
        lbl.textContent = `-${24 - h}h`;
        ticksEl.appendChild(lbl);
      }
    }

    // State
    this._tlRange = { start: 0.70, end: 1.0 }; // default: last ~30% = ~7h
    const trackWrap = document.getElementById('tl-track-wrap');
    const handleL   = document.getElementById('tl-handle-l');
    const handleR   = document.getElementById('tl-handle-r');
    const filled    = document.getElementById('tl-filled');
    const nowEl     = document.getElementById('tl-now');
    const rangeLabel = document.getElementById('tl-range-label');
    const clockEl    = document.getElementById('tl-clock');

    const updateVisuals = () => {
      const { start, end } = this._tlRange;
      filled.style.left  = (start * 100) + '%';
      filled.style.width = ((end - start) * 100) + '%';
      handleL.style.left = (start * 100) + '%';
      handleR.style.left = (end * 100) + '%';
      const hoursAgoStart = Math.round((1 - start) * 24);
      const hoursAgoEnd   = Math.round((1 - end) * 24);
      if (hoursAgoEnd === 0) {
        rangeLabel.textContent = hoursAgoStart <= 1 ? 'LAST 1H' : `LAST ${hoursAgoStart}H`;
      } else {
        rangeLabel.textContent = `-${hoursAgoStart}H → -${hoursAgoEnd}H`;
      }
    };

    // Drag logic
    let dragging = null;
    const onPointerDown = (handle, key) => {
      handle.addEventListener('pointerdown', e => {
        e.preventDefault();
        e.stopPropagation();
        dragging = key;
        handle.classList.add('active');
        handle.setPointerCapture(e.pointerId);
      });
    };
    onPointerDown(handleL, 'start');
    onPointerDown(handleR, 'end');

    document.addEventListener('pointermove', e => {
      if (!dragging) return;
      const rect = trackWrap.getBoundingClientRect();
      let pct = (e.clientX - rect.left) / rect.width;
      pct = Math.max(0, Math.min(1, pct));
      if (dragging === 'start') {
        this._tlRange.start = Math.min(pct, this._tlRange.end - 0.02);
      } else {
        this._tlRange.end = Math.max(pct, this._tlRange.start + 0.02);
      }
      updateVisuals();
    });

    document.addEventListener('pointerup', () => {
      if (dragging) {
        document.getElementById(`tl-handle-${dragging === 'start' ? 'l' : 'r'}`)?.classList.remove('active');
        dragging = null;
      }
    });

    // Now indicator + clock update
    const updateClock = () => {
      const now = new Date();
      const h = String(now.getUTCHours()).padStart(2, '0');
      const m = String(now.getUTCMinutes()).padStart(2, '0');
      const s = String(now.getUTCSeconds()).padStart(2, '0');
      clockEl.textContent = `${h}:${m}:${s}Z`;
      // "now" is always at 100%
      nowEl.style.left = '100%';
    };
    updateClock();
    setInterval(updateClock, 1000);
    updateVisuals();
  }

  // ── Map context menu ─────────────────────────────────────
  _initMapContextMenu() {
    if (!this._leaflet2D) return;
    const menu = document.createElement('div');
    menu.id = 'map-ctx-menu';
    menu.innerHTML = `
      <div class="ctx-item" id="mctx-globe">◉ Fly globe camera here</div>
      <div class="ctx-item" id="mctx-radar">⊙ Set radar center</div>
      <div class="ctx-item" id="mctx-coords">⊞ Copy coordinates</div>
      <div class="ctx-item" id="mctx-geofence">🛡️ Draw Geofence Overlay</div>
      <div class="ctx-item" id="mctx-tasking" style="color:#ffb300">⚡ Task Intercept Vector</div>
      <div class="ctx-sep"></div>
      <div class="ctx-item" id="mctx-reset">⊠ Reset map view</div>
    `;
    document.body.appendChild(menu);
    this._mapCtxMenu = menu;
    document.addEventListener('click', () => { if (menu) menu.style.display = 'none'; });

    this._leaflet2D.on('contextmenu', e => {
      e.originalEvent.preventDefault();
      menu.style.display = 'block';
      menu.style.left    = `${e.originalEvent.clientX}px`;
      menu.style.top     = `${e.originalEvent.clientY}px`;

      const wire = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.onclick = () => { fn(); menu.style.display = 'none'; };
      };
      wire('mctx-globe',   () => window.__nemesisGlobe?.focusLocation(e.latlng.lat, e.latlng.lng, 0.08));
      wire('mctx-radar',   () => { this.setRadarCenter(e.latlng.lat, e.latlng.lng); });
      wire('mctx-coords',  () => {
        navigator.clipboard?.writeText(`${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`);
        NemesisUI.log(`Coords copied: ${e.latlng.lat.toFixed(4)}°, ${e.latlng.lng.toFixed(4)}°`, 'ok');
      });
      wire('mctx-geofence', () => {
        this._toggleGeofence();
      });
      wire('mctx-tasking', () => {
        if (!this._selectedBlip || !this._selectedBlip.data) {
          NemesisUI.log('❌ TASKING FAILED: No active asset selected.', 'warn');
          return;
        }
        const asset = this._selectedBlip.data;
        if (!asset.lat || !asset.lon) return;
        
        const start = [asset.lat, asset.lon];
        const end   = [e.latlng.lat, e.latlng.lng];
        const dist  = this._mapHaversine(start[0], start[1], end[0], end[1]);
        
        const vector = window.L.polyline([start, end], {
          color: '#ffb300',
          weight: 2,
          dashArray: '5 10',
          opacity: 0.9
        }).addTo(this._leaflet2D);
        
        const tgtMarker = window.L.circleMarker(end, {
          radius: 8, color: '#ff0033', weight: 2, fillColor: '#ff0033', fillOpacity: 0.3
        }).addTo(this._leaflet2D);
        
        NemesisUI.log(`⚡ TASKING SENT: Intercept Vector queued for [${asset.callsign || asset.name || asset.id}]. Distance: ${dist.toFixed(0)}km.`, 'ok');
        
        // Auto-remove target vector after 10 seconds
        setTimeout(() => {
          if (this._leaflet2D) {
            this._leaflet2D.removeLayer(vector);
            this._leaflet2D.removeLayer(tgtMarker);
          }
        }, 10000);
      });
      wire('mctx-reset',   () => this._leaflet2D.setView([20, 20], 3));
    });
  }

  // ── Refresh age indicator ─────────────────────────────────
  _updateMapRefreshAge() {
    if (!this._lastRefresh) return;
    const age = Math.round((Date.now() - this._lastRefresh) / 1000);
    const el  = document.getElementById('map-refresh-age');
    if (el) el.textContent = age < 10 ? 'LIVE' : `${age}s ago`;
  }

  // ── Haversine for map ─────────────────────────────────────
  _mapHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371, d2r = Math.PI / 180;
    const dL = (lat2-lat1)*d2r, dG = (lon2-lon1)*d2r;
    const a  = Math.sin(dL/2)**2 + Math.cos(lat1*d2r)*Math.cos(lat2*d2r)*Math.sin(dG/2)**2;
    return R * 2 * Math.asin(Math.sqrt(a));
  }

  // Load geo hub strategic location markers
  _loadGeoHubMarkers() {
    if (!this._leaflet2D || !window.L) return;
    fetch('http://localhost:8000/api/geo-hubs')
      .then(r => r.json())
      .then(data => {
        const hubs = data.hubs || [];
        this._hubs = hubs;
        hubs.forEach(hub => {
          const isCritical = hub.tier === 'critical';
          const isMajor    = hub.tier === 'major';
          if (!isCritical && !isMajor) return;

          const col  = isCritical ? '#CD4246' : '#D1980B';
          const size = isCritical ? 6 : 4;

          const icon = window.L.divIcon({
            html: `
              <div style="
                width:${size}px; height:${size}px;
                border-radius:50%;
                background:${col};
                box-shadow:0 0 ${size}px ${col}40;
                border:1px solid ${col}80;
              "></div>
            `,
            iconSize:   [size, size],
            iconAnchor: [size/2, size/2],
            className:  '',
          });

          // Phase 5: Entity card popup for geo-hubs
          const popupHtml = `
            <div class="ec-header">
              <div class="ec-name">◈ ${hub.name}</div>
              <span class="ec-pill" style="background:${col}15;color:${col};border:1px solid ${col}40">${hub.tier.toUpperCase()}</span>
            </div>
            <div class="ec-body">
              <div class="ec-row"><span class="ec-lbl">COUNTRY</span><span class="ec-val">${hub.country}</span></div>
              <div class="ec-row"><span class="ec-lbl">REGION</span><span class="ec-val">${hub.region}</span></div>
              <div class="ec-row"><span class="ec-lbl">TYPE</span><span class="ec-val">${hub.type.toUpperCase()}</span></div>
            </div>
            <div class="ec-coords">${hub.lat.toFixed(4)}° N — ${hub.lon.toFixed(4)}° E</div>
            <div class="ec-actions">
              <button class="ec-btn" onclick="navigator.clipboard.writeText('${hub.lat.toFixed(5)}, ${hub.lon.toFixed(5)}')">⊞ COPY</button>
            </div>`;

          window.L.marker([hub.lat, hub.lon], { icon })
            .bindPopup(popupHtml, { className: 'entity-card-popup', maxWidth: 260 })
            .addTo(this._layerGroups.geoHubs);
        });
        NemesisUI.log(`Geo hubs mapped: ${hubs.filter(h=>h.tier==='critical'||h.tier==='major').length}`, 'ok');
      })
      .catch(() => {});
  }

  _refreshLeafletMarkers() {
    if (!this._leaflet2D || !window.L) return;
    this._lastRefresh = Date.now();

    // ── Ensure cluster groups exist ────────────────────────
    const hasCluster = !!window.L.MarkerClusterGroup;
    const mkGroup = (cssClass) => hasCluster
      ? window.L.markerClusterGroup({
          iconCreateFunction: c => window.L.divIcon({
            html: `<div>${c.getChildCount()}</div>`,
            className: `marker-cluster ${cssClass}`,
            iconSize: [32, 32],
          }),
          disableClusteringAtZoom: 8,  // Phase 5: Increased from 7 to reduce clutter
          spiderfyOnMaxZoom: true,
          showCoverageOnHover: false,
          maxClusterRadius: 80,        // Phase 5: Wider clustering radius
        })
      : window.L.layerGroup();

    if (!this._layerGroups) {
      this._clusterSats = mkGroup('cluster-sats');
      this._clusterFlts = mkGroup('cluster-flights');
      this._clusterShps = mkGroup('cluster-ships');
      this._layerGroups = {
        satellites: this._clusterSats,
        flights:    this._clusterFlts,
        ships:      this._clusterShps,
        hubs:       window.L.layerGroup().addTo(this._leaflet2D),
      };
      Object.values(this._layerGroups).forEach(lg => this._leaflet2D.addLayer(lg));
    } else {
      this._layerGroups.satellites.clearLayers();
      this._layerGroups.flights.clearLayers();
      this._layerGroups.ships.clearLayers();
    }

    // Phase 6: Network Topology Data Links
    if (this._datalinkLayer) {
      this._datalinkLayer.clearLayers();
    } else {
      this._datalinkLayer = window.L.layerGroup().addTo(this._leaflet2D);
    }


    // ── Phase 5: Zoom-level entity filtering ──────────────────
    // At world zoom (1-3): Only show stations (ISS etc) + GNSS — hide LEO sats
    // At zoom 4-5: Show top 80 sats (stations, gnss, then by altitude)
    // At zoom 6+: Show all sats (clustering handles density)
    const zoom = this._leaflet2D.getZoom();

    let sats = [];
    if (this._mapFilters.satellites) {
      const allSats = [...(this._satellites || [])].filter(s => s.lat && s.lon);
      if (zoom < 4) {
        // World view — only show notable satellites (stations + GNSS)
        sats = allSats.filter(s => s.group === 'stations' || s.group === 'gnss');
      } else if (zoom < 6) {
        // Regional view — top 80 by altitude
        sats = allSats.sort((a,b) => b.alt_km - a.alt_km).slice(0, 80);
      } else {
        // Close-up — show everything, clustering handles it
        sats = allSats.sort((a,b) => b.alt_km - a.alt_km).slice(0, 300);
      }
    }

    sats.forEach(sat => {
      if (!sat.lat || !sat.lon) return;
      const col  = sat.color || '#00ddf0';
      const is_s = sat.group === 'stations';
      const is_g = sat.group === 'gnss';
      // Phase 5: Zoom-adaptive sizing — smaller markers at world zoom
      const zoomScale = Math.max(0.6, Math.min(1.2, zoom / 6));
      const baseSz = is_s ? 18 : is_g ? 12 : 10;
      const sz = Math.round(baseSz * zoomScale);
      const isSelected = this._selectedEntityId === `sat-${sat.id}`;
      // Phase 5: Only show pulse ring at zoom >= 5 (reduces visual noise at world view)
      const showPulse = zoom >= 5;

      // Zoom-adaptive SVG with conditional pulse ring
      let svgCore = '';
      if (is_s) {
        svgCore = `<polygon points="10,2 12,8 18,8 13,12 15,18 10,14 5,18 7,12 2,8 8,8"
          fill="${col}" fill-opacity="0.85" stroke="${col}" stroke-width="0.5"/>`;
      } else if (is_g) {
        svgCore = `<polygon points="10,2 17,10 10,18 3,10"
          fill="${col}" fill-opacity="0.6" stroke="${col}" stroke-width="0.8"/>`;
      } else {
        // LEO sats: simple dot at low zoom, crosshair at high zoom
        if (zoom < 5) {
          svgCore = `<circle cx="10" cy="10" r="3.5" fill="${col}" opacity="0.7"/>`;
        } else {
          svgCore = `
            <circle cx="10" cy="10" r="3" fill="${col}" opacity="0.9"/>
            <circle cx="10" cy="10" r="7" fill="none" stroke="${col}" stroke-width="0.8" opacity="0.4"/>
            <line x1="10" y1="1"  x2="10" y2="5"  stroke="${col}" stroke-width="0.8" opacity="0.5"/>
            <line x1="10" y1="15" x2="10" y2="19" stroke="${col}" stroke-width="0.8" opacity="0.5"/>
            <line x1="1"  y1="10" x2="5"  y2="10" stroke="${col}" stroke-width="0.8" opacity="0.5"/>
            <line x1="15" y1="10" x2="19" y2="10" stroke="${col}" stroke-width="0.8" opacity="0.5"/>`;
        }
      }

      const icon = window.L.divIcon({
        html: `<div class="sat-marker-core">
          <svg width="${sz}" height="${sz}" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">${svgCore}</svg>
          ${showPulse ? '<div class="sat-marker-pulse"></div>' : ''}
          ${isSelected ? '<div class="entity-selected-ring"></div>' : ''}
        </div>`,
        iconSize:   [sz, sz],
        iconAnchor: [sz/2, sz/2],
        className:  '',
      });

      // Phase 4: Palantir entity card popup
      const popupHtml = `
        <div class="ec-header">
          <div class="ec-name">🛰 ${sat.name || sat.id}</div>
          <span class="ec-pill ec-pill-sat">${(sat.group||'SATELLITE').toUpperCase()}</span>
        </div>
        <div class="ec-body">
          <div class="ec-row"><span class="ec-lbl">NORAD</span><span class="ec-val">${sat.id}</span></div>
          <div class="ec-row"><span class="ec-lbl">ALTITUDE</span><span class="ec-val">${(sat.alt_km||0).toFixed(1)} km</span></div>
          <div class="ec-row"><span class="ec-lbl">VELOCITY</span><span class="ec-val">${(sat.velocity_km_s||0).toFixed(2)} km/s</span></div>
          <div class="ec-row"><span class="ec-lbl">INCLINATION</span><span class="ec-val">${(sat.inclination||0).toFixed(1)}°</span></div>
        </div>
        <div class="ec-coords">${sat.lat.toFixed(4)}° N — ${sat.lon.toFixed(4)}° E</div>
        <div class="ec-actions">
          <button class="ec-btn" onclick="window.__nemesisGlobeFocus && window.__nemesisGlobeFocus(${sat.id})">◉ GLOBE</button>
          <button class="ec-btn" onclick="navigator.clipboard.writeText('${sat.lat.toFixed(5)}, ${sat.lon.toFixed(5)}')">⊞ COPY</button>
        </div>`;

      window.L.marker([sat.lat, sat.lon], { icon })
        .bindPopup(popupHtml, { className: 'entity-card-popup', maxWidth: 280 })
        .addTo(this._layerGroups.satellites);
        
      // Phase 6: Draw network topology links for selected satellite
      if (isSelected && this._datalinkEnabled && this._hubs && this._hubs.length > 0) {
        const dists = this._hubs.map(h => ({
          hub: h,
          dist: this._mapHaversine(sat.lat, sat.lon, h.lat, h.lon)
        })).sort((a,b) => a.dist - b.dist).slice(0, 3);
        
        dists.forEach(d => {
          const lcol = d.hub.tier === 'critical' ? '#ff4444' : '#00ddf0';
          window.L.polyline([[sat.lat, sat.lon], [d.hub.lat, d.hub.lon]], {
            color: lcol,
            weight: 1.2,
            opacity: 0.6,
            className: 'datalink-line'
          }).addTo(this._datalinkLayer);
        });
      }
    });


    const satCt = document.getElementById('mapf-sat-ct');
    if (satCt) satCt.textContent = sats.length || '—';

    // ── FLIGHTS (Phase 5: Zoom-adaptive count + animated chevrons) ──
    const flightLimit = zoom < 4 ? 50 : zoom < 6 ? 100 : 200;
    const airborne = this._mapFilters.flights
      ? (this._flights || []).filter(f => !f.on_ground && f.lat && f.lon).slice(0, flightLimit)
      : [];

    // Phase 4: Accumulate flight trail history
    airborne.forEach(f => {
      const key = f.icao24 || f.callsign;
      if (!key) return;
      if (!this._flightTrailHistory[key]) this._flightTrailHistory[key] = [];
      const hist = this._flightTrailHistory[key];
      // Only add if position actually changed
      const last = hist[hist.length - 1];
      if (!last || Math.abs(last.lat - f.lat) > 0.001 || Math.abs(last.lon - f.lon) > 0.001) {
        hist.push({ lat: f.lat, lon: f.lon, ts: Date.now() });
        // Keep only last 15 positions
        if (hist.length > 15) hist.shift();
      }
    });

    // Render trails if visible
    if (this._trailsVisible) {
      if (!this._trailLayer) {
        this._trailLayer = window.L.layerGroup().addTo(this._leaflet2D);
      }
      this._trailLayer.clearLayers();

      Object.entries(this._flightTrailHistory).forEach(([key, positions]) => {
        if (positions.length < 2) return;
        // Check if flight is still active
        const isActive = airborne.some(f => (f.icao24 || f.callsign) === key);
        if (!isActive) return;

        const coords = positions.map(p => [p.lat, p.lon]);

        // Gradient trail: multiple segments with decreasing opacity
        for (let i = 1; i < coords.length; i++) {
          const opacity = 0.1 + (i / coords.length) * 0.5;
          window.L.polyline([coords[i-1], coords[i]], {
            color: '#D1980B',
            weight: 2,
            opacity: opacity,
            dashArray: i < coords.length - 2 ? '4 6' : null,
          }).addTo(this._trailLayer);
        }

        // Breadcrumb dots at each historical position
        positions.slice(0, -1).forEach((p, i) => {
          const isOld = i < positions.length / 2;
          window.L.circleMarker([p.lat, p.lon], {
            radius: isOld ? 1.5 : 2,
            color: '#D1980B',
            fillColor: '#D1980B',
            fillOpacity: 0.1 + (i / positions.length) * 0.5,
            weight: 0,
          }).addTo(this._trailLayer);
        });
      });
    }

    airborne.forEach(f => {
      const heading = f.true_track || 0;
      const speed   = f.velocity ? (f.velocity * 1.944).toFixed(0) : '—';
      const alt     = f.altitude_baro ? `FL${Math.round(f.altitude_baro*0.00328*10)/10}` : '—';
      const isFollowed = this._followTarget && (this._followTarget.id === f.icao24 || this._followTarget.id === `flt-${f.icao24}`);
      const isSelected = this._selectedEntityId === `flt-${f.icao24}`;

      // Phase 4: Animated flight marker with heading trail
      const icon = window.L.divIcon({
        html: `<div class="flight-marker-wrap">
          <svg width="14" height="14" viewBox="0 0 14 14"
               style="transform:rotate(${heading}deg);transform-origin:7px 7px"
               xmlns="http://www.w3.org/2000/svg">
            <polygon points="7,0 13,13 7,9 1,13"
              fill="#ffb300" fill-opacity="0.9" stroke="rgba(0,0,0,0.4)" stroke-width="0.5"/>
          </svg>
          ${isFollowed ? '<div class="entity-selected-ring" style="border-color:#D1980B;"></div>' : ''}
          ${isSelected ? '<div class="entity-selected-ring"></div>' : ''}
        </div>`,
        iconSize:   [14, 14],
        iconAnchor: [7, 7],
        className:  '',
      });

      // Phase 4: Palantir entity card popup
      const popupHtml = `
        <div class="ec-header">
          <div class="ec-name">✈ ${f.callsign || f.icao24 || '—'}</div>
          <span class="ec-pill ec-pill-flight">AIRBORNE</span>
        </div>
        <div class="ec-body">
          <div class="ec-row"><span class="ec-lbl">ICAO24</span><span class="ec-val">${f.icao24||'—'}</span></div>
          <div class="ec-row"><span class="ec-lbl">ALTITUDE</span><span class="ec-val">${alt}</span></div>
          <div class="ec-row"><span class="ec-lbl">SPEED</span><span class="ec-val">${speed} kt</span></div>
          <div class="ec-row"><span class="ec-lbl">HEADING</span><span class="ec-val">${heading.toFixed(0)}°</span></div>
          <div class="ec-row"><span class="ec-lbl">ORIGIN</span><span class="ec-val">${f.origin_country||'—'}</span></div>
          <div class="ec-row"><span class="ec-lbl">VERTICAL</span><span class="ec-val">${(f.vertical_rate||0).toFixed(1)} m/s</span></div>
        </div>
        <div class="ec-coords">${f.lat.toFixed(4)}° N — ${f.lon.toFixed(4)}° E</div>
        <div class="ec-actions">
          <button class="ec-btn" onclick="window.__nemesisMapFollow && window.__nemesisMapFollow('${f.icao24}','${(f.callsign||'').trim()}','flight')">◉ FOLLOW</button>
          <button class="ec-btn" onclick="navigator.clipboard.writeText('${f.lat.toFixed(5)}, ${f.lon.toFixed(5)}')">⊞ COPY</button>
          <button class="ec-btn" onclick="window.__nemesisGlobeFocus && window.__nemesisGlobeFocus('${f.icao24}')">⊕ GLOBE</button>
        </div>`;

      window.L.marker([f.lat, f.lon], { icon })
        .bindPopup(popupHtml, { className: 'entity-card-popup', maxWidth: 280 })
        .addTo(this._layerGroups.flights);
    });

    // Phase 4/6: Follow mode — auto-pan to tracked entity + Threat Radius
    if (this._followTarget) {
      const tid = this._followTarget.id;
      let target = airborne.find(f => f.icao24 === tid || `flt-${f.icao24}` === tid);
      if (!target) target = ships.find(s => String(s.mmsi) === String(tid) || `ship-${s.mmsi}` === tid);
      if (!target) target = sats.find(s => String(s.id) === String(tid) || `sat-${s.id}` === tid);

      if (target) {
        const lat = target.lat || target.latitude;
        const lon = target.lon || target.longitude;
        this._leaflet2D.panTo([lat, lon], { animate: true, duration: 0.5 });
        
        // --- PHASE 6: SEARCH AROUND / THREAT RADIUS ---
        if (this._threatRadius) this._leaflet2D.removeLayer(this._threatRadius);
        if (this._threatLines)  this._leaflet2D.removeLayer(this._threatLines);
        
        this._threatRadius = window.L.circle([lat, lon], {
          radius: 500000, color: '#ff4444', weight: 1.5, fillColor: '#ff0000', fillOpacity: 0.05, dashArray: '4 6', interactive: false
        }).addTo(this._leaflet2D);
        
        this._threatLines = window.L.layerGroup().addTo(this._leaflet2D);
        let threats = 0;
        
        const checkThreat = (entLat, entLon, entName, typeCol) => {
          if (!entLat || !entLon || (entLat===lat && entLon===lon)) return;
          const d = window.L.latLng(lat, lon).distanceTo(window.L.latLng(entLat, entLon));
          if (d <= 500000) {
            threats++;
            window.L.polyline([[lat, lon], [entLat, entLon]], { color: typeCol, weight: 1, dashArray: '2 4', opacity: 0.8 }).addTo(this._threatLines);
          }
        };
        
        airborne.forEach(f => checkThreat(f.lat, f.lon, f.callsign, '#ffaa00'));
        ships.forEach(s => checkThreat(s.lat, s.lon, s.name, '#48AFF0'));
        sats.forEach(s => checkThreat(s.lat, s.lon, s.name, '#00ffcc'));
        
        if (threats > 0) NemesisUI.log(`THREAT: ${threats} entities in 500km radius`, 'warn');
        
      } else {
        // Entity lost — cancel follow
        this._cancelFollow();
      }
    }

    const fltCt = document.getElementById('mapf-flt-ct');
    if (fltCt) fltCt.textContent = airborne.length || '—';

    // ── SHIPS (Phase 5: Zoom-adaptive + animated markers) ──
    const shipLimit = zoom < 4 ? 30 : zoom < 6 ? 80 : 200;
    const ships = this._mapFilters.ships
      ? (this._ships || []).filter(s => s.lat && s.lon).slice(0, shipLimit)
      : [];

    ships.forEach(s => {
      const heading = s.course || s.heading || 0;
      const speed   = s.speed ? s.speed.toFixed(1) : '—';
      const name    = s.name || s.vessel_name || s.mmsi || '—';
      const showRipple = zoom >= 5;

      // Phase 5: Ship marker with conditional ripple effect
      const icon = window.L.divIcon({
        html: `<div style="position:relative;display:flex;align-items:center;justify-content:center;">
          <svg width="12" height="12" viewBox="0 0 14 14"
               style="transform:rotate(${heading}deg);transform-origin:7px 7px"
               xmlns="http://www.w3.org/2000/svg">
            <polygon points="7,1 12,12 7,9 2,12"
              fill="#48AFF0" fill-opacity="0.75" stroke="rgba(0,0,0,0.3)" stroke-width="0.5"/>
          </svg>
          ${showRipple ? '<div class="ship-marker-ripple"></div>' : ''}
        </div>`,
        iconSize:   [12, 12],
        iconAnchor: [6, 6],
        className:  '',
      });

      // Phase 4: Palantir entity card popup
      const popupHtml = `
        <div class="ec-header">
          <div class="ec-name">⚓ ${name}</div>
          <span class="ec-pill ec-pill-ship">VESSEL</span>
        </div>
        <div class="ec-body">
          <div class="ec-row"><span class="ec-lbl">MMSI</span><span class="ec-val">${s.mmsi||'—'}</span></div>
          <div class="ec-row"><span class="ec-lbl">SPEED</span><span class="ec-val">${speed} kn</span></div>
          <div class="ec-row"><span class="ec-lbl">COURSE</span><span class="ec-val">${heading.toFixed(0)}°</span></div>
          <div class="ec-row"><span class="ec-lbl">TYPE</span><span class="ec-val">${(s.ship_type||'—').toString().toUpperCase()}</span></div>
        </div>
        <div class="ec-coords">${s.lat.toFixed(4)}° N — ${s.lon.toFixed(4)}° E</div>
        <div class="ec-actions">
          <button class="ec-btn" onclick="window.__nemesisMapFollow && window.__nemesisMapFollow('ship-${s.mmsi}','${name.trim()}','ship')">◉ FOLLOW</button>
          <button class="ec-btn" onclick="navigator.clipboard.writeText('${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}')">⊞ COPY</button>
        </div>`;

      window.L.marker([s.lat, s.lon], { icon })
        .bindPopup(popupHtml, { className: 'entity-card-popup', maxWidth: 280 })
        .addTo(this._layerGroups.ships);
    });

    const shpCt = document.getElementById('mapf-shp-ct');
    if (shpCt) shpCt.textContent = ships.length || '—';

    // Heatmap refresh if visible
    if (this._heatVisible && this._heatLayer) {
      const pts = [
        ...airborne.map(f => [f.lat, f.lon, 0.5]),
        ...ships.map(s   => [s.lat, s.lon, 0.3]),
      ];
      this._heatLayer.setLatLngs(pts);
    }

    NemesisUI.log(
      `MAP: ${sats.length} sats · ${airborne.length} flights · ${ships.length} ships`,
      'ok'
    );
  }
  // ═══════════════════════════════════════════════════════════
  // ATC RADAR — Proper interactive radar
  // Real lat/lon → radar coordinates mapping
  // Clickable blips with detail panel
  // Range selector (250/500/1000/2000 NM)
  // ═══════════════════════════════════════════════════════════

  setRadarCenter(lat, lon) {
    this._radarCenter = { lat: parseFloat(lat), lon: parseFloat(lon) };
    NemesisUI.log(`Radar center → ${lat}°, ${lon}°`, 'ok');
    if (this._current === 'radar') {
      this.switchView('radar');
    }
  }

  setRadarRange(nm) {
    this._radarRange = nm;
    // Highlight active button
    [250,500,1000,2000].forEach(r => {
      const btn = document.getElementById(`rng-${r}`);
      if (!btn) return;
      btn.style.color       = r === nm ? '#000' : 'rgba(72,175,240,0.5)';
      btn.style.background  = r === nm ? '#48AFF0' : 'transparent';
      btn.style.borderColor = r === nm ? '#48AFF0' : 'rgba(72,175,240,0.2)';
    });
  }

  _latLonToRadar(lat, lon, cx, cy, R) {
    // Convert lat/lon offset from radar center to canvas position
    const DEG_TO_NM = 60;
    const centerLat = this._radarCenter.lat;
    const centerLon = this._radarCenter.lon;
    const scale = R / this._radarRange;

    const dLat = (lat - centerLat) * DEG_TO_NM;
    const dLon = (lon - centerLon) * DEG_TO_NM * Math.cos(centerLat * Math.PI / 180);

    return {
      x: cx + dLon * scale,
      y: cy - dLat * scale,
    };
  }

  _startRadar() {
    const canvas = document.getElementById('radar-canvas');
    if (!canvas) return;

    const dpr  = window.devicePixelRatio || 1;
    const size = Math.min(
      window.innerWidth  - 640,
      window.innerHeight - 100
    );
    canvas.width  = size * dpr;
    canvas.height = size * dpr;
    canvas.style.cssText = `
      position:absolute;
      left:50%; top:50%;
      transform:translate(-50%,-50%);
      width:${size}px; height:${size}px;
      cursor:crosshair;
    `;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const cx = size / 2;
    const cy = size / 2;
    const R  = size / 2 - 30;

    // Click detection
    canvas.onclick = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx   = (e.clientX - rect.left);
      const my   = (e.clientY - rect.top);

      // Find nearest blip within 12px
      let nearest  = null;
      let nearDist = 12;

      this._flights.filter(f => !f.on_ground && f.lat && f.lon).forEach(f => {
        const { x, y } = this._latLonToRadar(f.lat, f.lon, cx, cy, R);
        const d = Math.hypot(mx - x, my - y);
        if (d < nearDist) { nearest = { type:'flight', data:f }; nearDist = d; }
      });

      if (nearest) this._showRadarDetail(nearest);
      else {
        this._selectedBlip = null;
        const det = document.getElementById('radar-detail');
        if (det) det.style.display = 'none';
      }
    };

    // Set default range button
    this.setRadarRange(500);

    // Build blip data with trails
    this._radarBlips = {};

    const draw = () => {
      // Throttle to 30fps for performance
      const now = performance.now();
      if (!this._lastRadarDraw) this._lastRadarDraw = now;
      const elapsed = now - this._lastRadarDraw;
      if (elapsed < 33) {   // 33ms = 30fps
        this._radarFrame = requestAnimationFrame(draw);
        return;
      }
      this._lastRadarDraw = now;

      ctx.clearRect(0, 0, size, size);

      // ── Background ──────────────────────────────────────────
      const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      bgGrad.addColorStop(0,   '#001a0d');
      bgGrad.addColorStop(0.7, '#000d06');
      bgGrad.addColorStop(1,   '#000502');
      ctx.fillStyle = bgGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();

      // ── Range rings ─────────────────────────────────────────
      const rings = 4;
      for (let i = 1; i <= rings; i++) {
        const r   = R * (i / rings);
        const nm  = Math.round(this._radarRange * i / rings);

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(45,114,210,${0.06 + i * 0.02})`;
        ctx.lineWidth   = i === rings ? 1.5 : 0.5;
        ctx.stroke();

        ctx.fillStyle     = 'rgba(45,114,210,0.3)';
        ctx.font          = '8px "Share Tech Mono"';
        ctx.textAlign     = 'left';
        ctx.textBaseline  = 'middle';
        ctx.fillText(`${nm}NM`, cx + r + 4, cy);
      }

      // ── Grid lines ───────────────────────────────────────────
      ctx.strokeStyle = 'rgba(45,114,210,0.07)';
      ctx.lineWidth   = 0.5;
      for (let a = 0; a < 360; a += 30) {
        const rad = (a - 90) * Math.PI / 180;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(rad) * R, cy + Math.sin(rad) * R);
        ctx.stroke();
      }

      // ── Compass ──────────────────────────────────────────────
      ['N','30','60','E','120','150','S','210','240','W','300','330'].forEach((d, i) => {
        const angle = (i * 30 - 90) * Math.PI / 180;
        const isMain = ['N','E','S','W'].includes(d);
        const dist   = R + (isMain ? 16 : 12);
        const x = cx + Math.cos(angle) * dist;
        const y = cy + Math.sin(angle) * dist;

        ctx.fillStyle    = isMain ? '#48AFF0' : 'rgba(45,114,210,0.5)';
        ctx.font         = `${isMain ? 'bold ' : ''}${isMain ? 11 : 8}px "Orbitron"`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(d, x, y);

        // Tick marks
        const inner = R - 4;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
        ctx.lineTo(cx + Math.cos(angle) * R,     cy + Math.sin(angle) * R);
        ctx.strokeStyle = isMain ? 'rgba(72,175,240,0.5)' : 'rgba(45,114,210,0.25)';
        ctx.lineWidth   = isMain ? 1.5 : 0.5;
        ctx.stroke();
      });

      // ── Sweep ────────────────────────────────────────────────
      this._radarAngle += 0.025 * (elapsed / 33);

      // Fading sweep trail
      for (let a = 0; a < 1.5; a += 0.04) {
        const opacity = Math.max(0, (1.5 - a) * 0.12);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, this._radarAngle - a, this._radarAngle - a + 0.04);
        ctx.lineTo(cx, cy);
        ctx.fillStyle = `rgba(0,255,80,${opacity})`;
        ctx.fill();
      }

      // Sweep line
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this._radarAngle);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(R, 0);
      ctx.strokeStyle = '#48AFF0';
      ctx.lineWidth   = 1.5;
      ctx.shadowColor = '#48AFF0';
      ctx.shadowBlur  = 8;
      ctx.stroke();
      ctx.shadowBlur  = 0;
      ctx.restore();

      // ── Aircraft blips ───────────────────────────────────────
      const airborne = this._flights.filter(f => !f.on_ground && f.lat && f.lon);

      airborne.forEach(f => {
        const id = f.icao24 || f.callsign;
        const { x, y } = this._latLonToRadar(f.lat, f.lon, cx, cy, R);

        // Skip if outside radar circle
        if (Math.hypot(x - cx, y - cy) > R) return;

        // Init trail
        if (!this._radarBlips[id]) {
          this._radarBlips[id] = { trail: [], lastX: x, lastY: y };
        }
        const blip = this._radarBlips[id];

        // Update trail every sweep
        const sweepHit = this._radarAngle % (Math.PI * 2) < 0.05;
        if (sweepHit || blip.trail.length === 0) {
          blip.trail.push({ x, y, t: Date.now() });
          if (blip.trail.length > 8) blip.trail.shift();
        }

        // Draw trail
        blip.trail.forEach((pt, i) => {
          const age   = (i / blip.trail.length);
          const alpha = age * 0.5;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 1.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(72,175,240,${alpha})`;
          ctx.fill();
        });

        // Heading line
        if (f.heading !== undefined) {
          const headRad = (f.heading - 90) * Math.PI / 180;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(headRad) * 16, y + Math.sin(headRad) * 16);
          ctx.strokeStyle = 'rgba(72,175,240,0.5)';
          ctx.lineWidth   = 1;
          ctx.stroke();
        }

        // Blip — larger if selected
        const isSelected = this._selectedBlip?.data?.icao24 === f.icao24;
        const blipR      = isSelected ? 5 : 3;
        const blipColor  = isSelected ? '#ffff00' : '#48AFF0';

        ctx.beginPath();
        ctx.arc(x, y, blipR, 0, Math.PI * 2);
        ctx.fillStyle   = blipColor;
        ctx.shadowColor = blipColor;
        ctx.shadowBlur  = isSelected ? 16 : 6;
        ctx.fill();
        ctx.shadowBlur  = 0;

        // Data tag — callsign + FL
        const callsign = (f.callsign || f.icao24 || '????').trim();
        const fl       = Math.round((f.altitude_baro || 0) / 100);
        const speed    = Math.round(f.velocity || 0);

        ctx.fillStyle   = isSelected ? '#ffff00' : 'rgba(72,175,240,0.85)';
        ctx.font        = '8px "Share Tech Mono"';
        ctx.textAlign   = 'left';
        ctx.textBaseline= 'top';
        ctx.fillText(callsign, x + 6, y - 10);

        ctx.fillStyle   = 'rgba(45,114,210,0.6)';
        ctx.font        = '7px "Share Tech Mono"';
        ctx.fillText(`FL${fl} ${speed}kt`, x + 6, y - 2);
      });

      // ── Centre ───────────────────────────────────────────────
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fillStyle   = '#48AFF0';
      ctx.shadowColor = '#48AFF0';
      ctx.shadowBlur  = 14;
      ctx.fill();
      ctx.shadowBlur  = 0;

      // Cross at centre
      ctx.strokeStyle = 'rgba(72,175,240,0.4)';
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(cx-10,cy); ctx.lineTo(cx+10,cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx,cy-10); ctx.lineTo(cx,cy+10); ctx.stroke();

      // ── Outer ring ───────────────────────────────────────────
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(45,114,210,0.3)';
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, R + 3, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(45,114,210,0.08)';
      ctx.lineWidth   = 5;
      ctx.stroke();

      // ── HUD text ─────────────────────────────────────────────
      const utc = new Date().toUTCString().slice(17,25);
      const visibleCount = airborne.filter(f => {
        const {x,y} = this._latLonToRadar(f.lat,f.lon,cx,cy,R);
        return Math.hypot(x-cx,y-cy) <= R;
      }).length;

      const timeEl = document.getElementById('radar-time-text');
      if (timeEl) timeEl.textContent = `${utc} Z`;
      
      const tracksEl = document.getElementById('radar-tracks-text');
      if (tracksEl) tracksEl.textContent = `TRACKS: ${visibleCount} / ${this._radarRange}NM`;

      this._updateRadarHUD(airborne);
      this._radarFrame = requestAnimationFrame(draw);
    };

    this._radarFrame = requestAnimationFrame(draw);
  }

  _showRadarDetail(item) {
    this._selectedBlip = item;
    const det = document.getElementById('radar-detail');
    if (!det) return;
    const f = item.data;
    det.style.display = 'block';
    det.innerHTML = `
      <div style="font-family:'Orbitron',sans-serif;font-size:10px;
                  color:#48AFF0;font-weight:700;margin-bottom:8px;
                  letter-spacing:.15em">
        ◉ ${(f.callsign||f.icao24||'?').trim()}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;
                  gap:6px;font-size:9px;color:rgba(45,114,210,0.7)">
        <div>ICAO24</div><div style="color:#48AFF0">${f.icao24||'?'}</div>
        <div>ALTITUDE</div><div style="color:#48AFF0">FL${Math.round((f.altitude_baro||0)/100)}</div>
        <div>SPEED</div><div style="color:#48AFF0">${Math.round(f.velocity||0)} kt</div>
        <div>HEADING</div><div style="color:#48AFF0">${Math.round(f.heading||0)}°</div>
        <div>LAT/LON</div><div style="color:#48AFF0">${f.lat?.toFixed(2)}° / ${f.lon?.toFixed(2)}°</div>
        <div>STATUS</div>
        <div style="color:${f.on_ground?'#ffb300':'#48AFF0'}">
          ${f.on_ground?'ON GROUND':'AIRBORNE'}
        </div>
      </div>
      <div style="margin-top:8px;font-size:8px;color:rgba(45,114,210,0.5);
                  border-top:1px solid rgba(72,175,240,0.1);padding-top:6px">
        CLICK ELSEWHERE TO DISMISS
      </div>
    `;
  }

  _updateRadarHUD(airborne) {
    const hud = document.getElementById('radar-hud');
    if (!hud) return;
    const visible = airborne.slice(0, 10);
    hud.innerHTML = `
      <div style="font-family:'Orbitron',sans-serif;font-size:8px;
                  color:rgba(72,175,240,0.5);letter-spacing:.2em;
                  margin-bottom:6px;padding-bottom:6px;
                  border-bottom:1px solid rgba(72,175,240,0.1)">
        ◎ ACTIVE TRACKS
      </div>
      ${visible.map(f => `
        <div onclick="window.__nemesisViews._showRadarDetail({type:'flight',data:${JSON.stringify(f).replace(/"/g,'&quot;')}})"
             style="padding:6px 8px;margin-bottom:3px;cursor:pointer;
                    background:rgba(72,175,240,0.03);
                    border:1px solid rgba(72,175,240,0.08);
                    border-left:2px solid rgba(72,175,240,0.4);
                    font-family:'Share Tech Mono',monospace;
                    font-size:9px;color:rgba(45,114,210,0.7);
                    transition:all .15s">
          <span style="color:#48AFF0;font-size:10px;font-weight:bold">
            ${(f.callsign||f.icao24||'?').trim()}
          </span>
          <span style="float:right;color:rgba(45,114,210,0.5)">
            FL${Math.round((f.altitude_baro||0)/100)}
          </span>
          <br>
          <span style="font-size:8px">${Math.round(f.velocity||0)}kt · ${Math.round(f.heading||0)}°</span>
        </div>
      `).join('')}
    `;
  }

  _refreshRadarBlips() {
    // Data updated — blips refresh on next draw frame automatically
  }

  // ═══════════════════════════════════════════════════════════
  // ORBITAL VIEW — interactive concentric rings
  // Real altitude-based shell placement
  // Click satellites for detail
  // ═══════════════════════════════════════════════════════════
  _startOrbital() {
    const canvas = document.getElementById('orbital-canvas');
    if (!canvas) return;

    const dpr  = window.devicePixelRatio || 1;
    const W    = window.innerWidth;
    const H    = window.innerHeight;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.cssText = `
      position:absolute; inset:0;
      width:${W}px; height:${H}px; cursor:crosshair;
    `;
    const ctx  = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const cx   = W / 2;
    const cy   = H / 2;

    // Orbital shells with proper altitude ranges
    const shells = [
      { name:'LEO',  altMin:0,      altMax:2000,  r:Math.min(W,H)*0.18, color:'#2D72D2', sats:[] },
      { name:'MEO',  altMin:2000,  altMax:20000, r:Math.min(W,H)*0.27, color:'#7cff7c', sats:[] },
      { name:'HEO',  altMin:20000, altMax:36000, r:Math.min(W,H)*0.35, color:'#ff8800', sats:[] },
      { name:'GEO',  altMin:36000, altMax:40000, r:Math.min(W,H)*0.40, color:'#ffb300', sats:[] },
      { name:'XGEO', altMin:40000, altMax:999999,r:Math.min(W,H)*0.44, color:'#ff4488', sats:[] },
    ];

    // Assign sats to shells
    this._satellites.forEach(sat => {
      const alt = sat.alt_km || 0;
      const shell = shells.find(s => alt >= s.altMin && alt < s.altMax);
      if (shell) shell.sats.push(sat);
    });

    // Click detection for satellites
    this._orbitalSatPositions = [];
    let selectedSat = null;

    canvas.onclick = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx   = e.clientX - rect.left;
      const my   = e.clientY - rect.top;
      let nearest = null;
      let nearDist = 14;

      this._orbitalSatPositions.forEach(sp => {
        const d = Math.hypot(mx - sp.x, my - sp.y);
        if (d < nearDist) { nearest = sp; nearDist = d; }
      });

      if (nearest) {
        selectedSat = nearest.sat;
        this._showOrbitalDetail(nearest.sat, nearest.shell);
      } else {
        selectedSat = null;
        const det = document.getElementById('orbital-detail');
        if (det) det.innerHTML = '';
      }
    };

    let tick = 0;

    const draw = () => {
      const now = performance.now();
      if (!this._lastOrbDraw) this._lastOrbDraw = now;
      const elapsed = now - this._lastOrbDraw;
      if (elapsed < 41) {  // 41ms = 24fps
        this._orbitalFrame = requestAnimationFrame(draw);
        return;
      }
      this._lastOrbDraw = now;

      ctx.clearRect(0, 0, W, H);

      // Background
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W,H));
      bg.addColorStop(0,   '#000f1f');
      bg.addColorStop(0.5, '#000810');
      bg.addColorStop(1,   '#000205');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Stars (generate once)
      if (!this._orbitalStars) {
        this._orbitalStars = Array.from({length:300}, () => ({
          x: Math.random() * W, y: Math.random() * H,
          r: Math.random() * 1.3 + 0.2,
          a: Math.random() * 0.6 + 0.1,
          warm: Math.random() < 0.05,
        }));
      }
      this._orbitalStars.forEach(s => {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = s.warm
          ? `rgba(255,210,120,${s.a})`
          : `rgba(180,210,255,${s.a})`;
        ctx.fill();
      });

      this._orbitalTime = (this._orbitalTime || 0) + elapsed / 1000;
      this._orbitalSatPositions = [];

      // ── Shells ───────────────────────────────────────────────
      shells.forEach((shell, si) => {
        // Shell ring (dashed)
        ctx.setLineDash([6, 10]);
        ctx.beginPath();
        ctx.arc(cx, cy, shell.r, 0, Math.PI * 2);
        ctx.strokeStyle = `${shell.color}28`;
        ctx.lineWidth   = 0.8;
        ctx.stroke();
        ctx.setLineDash([]);

        // Shell label
        ctx.fillStyle    = `${shell.color}66`;
        ctx.font         = '9px "Orbitron"';
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${shell.name}`, cx + shell.r + 10, cy - 8);
        ctx.fillStyle = `${shell.color}44`;
        ctx.font      = '7px "Share Tech Mono"';
        ctx.fillText(`${shell.altMin.toLocaleString()}–${shell.altMax === 999999 ? '∞' : shell.altMax.toLocaleString()}km`, cx + shell.r + 10, cy + 4);
        ctx.fillStyle = `${shell.color}33`;
        ctx.fillText(`[${shell.sats.length} objects]`, cx + shell.r + 10, cy + 14);

        // ── Satellites on shell ──────────────────────────────
        const maxShow = Math.min(shell.sats.length, 80);
        const speeds  = [0.004, 0.0015, 0.0006, 0.0003, 0.0001];

        shell.sats.slice(0, maxShow).forEach((sat, i) => {
          const baseLon = ((sat.lon + 180) / 360) * Math.PI * 2;
          const angle = baseLon + this._orbitalTime * speeds[si] * 60;
          const x       = cx + Math.cos(angle) * shell.r;
          const y       = cy + Math.sin(angle) * shell.r;

          const isStation   = sat.group === 'stations';
          const isSelected  = selectedSat?.id === sat.id;
          const dotR        = isStation ? 4.5 : isSelected ? 5 : 2;
          const col         = isSelected ? '#ffffff' : shell.color;

          // Orbital trail arc
          ctx.beginPath();
          ctx.arc(cx, cy, shell.r, angle - 0.25, angle);
          ctx.strokeStyle = `${col}44`;
          ctx.lineWidth   = isStation ? 2 : 1.2;
          ctx.stroke();

          // Satellite dot
          ctx.beginPath();
          ctx.arc(x, y, dotR, 0, Math.PI * 2);
          ctx.fillStyle   = col;
          ctx.shadowColor = col;
          ctx.shadowBlur  = isSelected ? 16 : isStation ? 10 : 4;
          ctx.fill();
          ctx.shadowBlur  = 0;

          // Store position for click detection
          this._orbitalSatPositions.push({ x, y, sat, shell });

          // Label for stations and selected
          if (isStation || isSelected) {
            ctx.fillStyle    = col;
            ctx.font         = '8px "Share Tech Mono"';
            ctx.textAlign    = x > cx ? 'left' : 'right';
            ctx.textBaseline = 'middle';
            const offset = x > cx ? dotR + 4 : -(dotR + 4);
            ctx.fillText(sat.name.slice(0, 14), x + offset, y);
          }
        });
      });

      // ── Earth ────────────────────────────────────────────────
      const earthR = Math.min(W,H) * 0.07;

      // Glow
      const eg = ctx.createRadialGradient(cx, cy, 0, cx, cy, earthR * 2.5);
      eg.addColorStop(0,   'rgba(0,80,180,0.35)');
      eg.addColorStop(0.5, 'rgba(0,40,100,0.15)');
      eg.addColorStop(1,   'transparent');
      ctx.fillStyle = eg;
      ctx.beginPath();
      ctx.arc(cx, cy, earthR * 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Earth body
      const ebg = ctx.createRadialGradient(
        cx - earthR * 0.3, cy - earthR * 0.3, 0, cx, cy, earthR
      );
      ebg.addColorStop(0,   '#2080d0');
      ebg.addColorStop(0.4, '#0d5090');
      ebg.addColorStop(1,   '#020d20');
      ctx.beginPath();
      ctx.arc(cx, cy, earthR, 0, Math.PI * 2);
      ctx.fillStyle   = ebg;
      ctx.shadowColor = '#0055bb';
      ctx.shadowBlur  = 25;
      ctx.fill();
      ctx.shadowBlur  = 0;

      // Atmosphere
      ctx.beginPath();
      ctx.arc(cx, cy, earthR + 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,150,255,0.35)';
      ctx.lineWidth   = 4;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, earthR + 9, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,100,255,0.12)';
      ctx.lineWidth   = 6;
      ctx.stroke();

      // Label
      ctx.fillStyle    = 'rgba(120,180,255,0.8)';
      ctx.font         = `bold ${Math.round(earthR * 0.35)}px "Orbitron"`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('EARTH', cx, cy);

      // ── HUD ──────────────────────────────────────────────────
      ctx.fillStyle    = 'rgba(45,114,210,0.5)';
      ctx.font         = '9px "Orbitron"';
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('ORBITAL SURVEILLANCE — LIVE TRACKING', 320, 64);
      ctx.fillText(`TOTAL ASSETS: ${this._satellites.length}  |  CLICK OBJECT TO INSPECT`, 320, 78);

      // Legend
      shells.forEach((shell, i) => {
        ctx.fillStyle = shell.color;
        ctx.fillRect(320, H - 80 + i * 13, 8, 8);
        ctx.font      = '8px "Share Tech Mono"';
        ctx.fillText(`${shell.name}: ${shell.sats.length}`, 334, H - 80 + i * 13);
      });

      this._orbitalFrame = requestAnimationFrame(draw);
    };

    this._orbitalFrame = requestAnimationFrame(draw);
    this._updateOrbitalDetail(shells);
  }

  _showOrbitalDetail(sat, shell) {
    const det = document.getElementById('orbital-detail');
    if (!det) return;
    det.innerHTML = `
      <div style="padding:12px;background:rgba(0,10,25,0.95);
                  border:1px solid ${shell.color}44;
                  border-left:2px solid ${shell.color}88">
        <div style="font-family:'Orbitron',sans-serif;font-size:11px;
                    color:${shell.color};font-weight:700;margin-bottom:10px;
                    letter-spacing:.1em">
          ⊕ ${sat.name}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;
                    font-family:'Share Tech Mono',monospace;font-size:9px;
                    color:rgba(180,220,255,0.6)">
          <div>NORAD ID</div><div style="color:${shell.color}">${sat.id}</div>
          <div>ALTITUDE</div><div style="color:${shell.color}">${sat.alt_km?.toFixed(1)} km</div>
          <div>LATITUDE</div><div style="color:${shell.color}">${sat.lat?.toFixed(3)}°</div>
          <div>LONGITUDE</div><div style="color:${shell.color}">${sat.lon?.toFixed(3)}°</div>
          <div>SHELL</div><div style="color:${shell.color}">${shell.name}</div>
          <div>GROUP</div><div style="color:${shell.color}">${sat.group?.toUpperCase()}</div>
          <div>TLE AGE</div><div style="color:${shell.color}">${sat.epoch_age_days?.toFixed(1) || '?'} days</div>
        </div>
        <div style="margin-top:8px;font-size:8px;
                    color:rgba(0,200,255,0.4);
                    border-top:1px solid rgba(0,200,255,0.1);
                    padding-top:6px">
          ORBITAL PERIOD: ${shell.name==='LEO'?'~90 min':shell.name==='MEO'?'~12 hr':shell.name==='GEO'?'~24 hr':'~varies'}
        </div>
      </div>
    `;
  }

  _updateOrbitalDetail(shells) {
    const det = document.getElementById('orbital-detail');
    if (!det) return;
    det.innerHTML = shells.map(s => `
      <div style="padding:8px 10px;
                  background:rgba(0,8,18,0.9);
                  border:1px solid ${s.color}22;
                  border-left:2px solid ${s.color}55">
        <div style="font-family:'Orbitron',sans-serif;font-size:9px;
                    font-weight:700;color:${s.color};margin-bottom:4px">
          ${s.name} — ${s.sats.length} objects
        </div>
        <div style="font-family:'Share Tech Mono',monospace;font-size:8px;
                    color:rgba(180,220,255,0.4)">
          ${s.altMin.toLocaleString()}–${s.altMax === 999999 ? '∞' : s.altMax.toLocaleString()} km
        </div>
      </div>
    `).join('');
  }

  // ═══════════════════════════════════════════════════════════
  // MARITIME — Leaflet map, interactive ship tracking
  // ═══════════════════════════════════════════════════════════
  _initMaritime() {
    if (!window.L) return NemesisUI.log('Leaflet not loaded', 'warn');
    const container = document.getElementById('view-maritime');
    if (!container) return;

    if (this._maritimeMap) {
      this._maritimeMap.invalidateSize();
      this._refreshShipMarkers();
      return;
    }

    this._maritimeMap = window.L.map(container, {
      center: [20, 30],
      zoom:   3,
      attributionControl: false,
    });

    window.L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
      { maxZoom: 18, subdomains: 'abcd' }
    ).addTo(this._maritimeMap);

    // Ocean tint — cleaner Phase 5 style
    const style = document.createElement('style');
    style.textContent = `
      #view-maritime .leaflet-tile-pane {
        filter: brightness(0.85) saturate(0.65) hue-rotate(185deg);
      }
    `;
    document.head.appendChild(style);

    // Phase 5: Maritime cluster group
    this._maritimeShipLayer = window.L.markerClusterGroup ? window.L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 80,
      disableClusteringAtZoom: 8,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: (c) => window.L.divIcon({
        html: `<div><span>${c.getChildCount()}</span></div>`,
        className: 'marker-cluster marker-cluster-medium cluster-ships',
        iconSize: [28, 28]
      })
    }).addTo(this._maritimeMap) : window.L.layerGroup().addTo(this._maritimeMap);

    // Phase 5: Zoom-level re-render logic
    let lastZoom = this._maritimeMap.getZoom();
    this._maritimeMap.on('zoomend', () => {
      const newZoom = this._maritimeMap.getZoom();
      // Only re-refresh if we crossed a filter threshold (4 or 6)
      if ((newZoom < 4 && lastZoom >= 4) || (newZoom >= 4 && lastZoom < 4) ||
          (newZoom < 6 && lastZoom >= 6) || (newZoom >= 6 && lastZoom < 6)) {
        this._refreshShipMarkers();
      }
      lastZoom = newZoom;
    });

    this._refreshShipMarkers();
    NemesisUI.log('Maritime tactical map online', 'ok');
  }

  _refreshShipMarkers() {
    if (!this._maritimeMap || !window.L || !this._maritimeShipLayer) return;
    this._maritimeShipLayer.clearLayers();

    // Phase 5: Maritime zoom-adaptive filtering
    const zoom = this._maritimeMap.getZoom();
    const shipLimit = zoom < 4 ? 30 : zoom < 6 ? 80 : 300; // Maritime view allows more ships at high zoom
    
    const ships = (this._ships || []).filter(s => s.lat && s.lon).slice(0, shipLimit);

    ships.forEach((s, i) => {
      const heading = s.course || s.heading || 0;
      const speed   = s.speed ? s.speed.toFixed(1) : '—';
      const name    = s.name || s.vessel_name || s.mmsi || `VESSEL-${i}`;
      const showRipple = zoom >= 5;

      // Phase 5: Palantir tactical ship marker
      const icon = window.L.divIcon({
        html: `<div style="position:relative;display:flex;align-items:center;justify-content:center;">
          <svg width="12" height="12" viewBox="0 0 14 14"
               style="transform:rotate(${heading}deg);transform-origin:7px 7px"
               xmlns="http://www.w3.org/2000/svg">
            <polygon points="7,1 12,12 7,9 2,12"
              fill="#48AFF0" fill-opacity="0.75" stroke="rgba(0,0,0,0.3)" stroke-width="0.5"/>
          </svg>
          ${showRipple ? '<div class="ship-marker-ripple"></div>' : ''}
        </div>`,
        iconSize:   [12, 12],
        iconAnchor: [6, 6],
        className:  '',
      });

      // Phase 5: Entity card popup
      const popupHtml = `
        <div class="ec-header">
          <div class="ec-name">⚓ ${name}</div>
          <span class="ec-pill ec-pill-ship">VESSEL</span>
        </div>
        <div class="ec-body">
          <div class="ec-row"><span class="ec-lbl">MMSI</span><span class="ec-val">${s.mmsi||'—'}</span></div>
          <div class="ec-row"><span class="ec-lbl">SPEED</span><span class="ec-val">${speed} kn</span></div>
          <div class="ec-row"><span class="ec-lbl">COURSE</span><span class="ec-val">${heading.toFixed(0)}°</span></div>
          <div class="ec-row"><span class="ec-lbl">TYPE</span><span class="ec-val">${(s.ship_type||'—').toString().toUpperCase()}</span></div>
        </div>
        <div class="ec-coords">${s.lat.toFixed(4)}° N — ${s.lon.toFixed(4)}° E</div>
        <div class="ec-actions">
          <button class="ec-btn" onclick="navigator.clipboard.writeText('${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}')">⊞ COPY</button>
        </div>`;

      window.L.marker([s.lat, s.lon], { icon })
        .bindPopup(popupHtml, { className: 'entity-card-popup', maxWidth: 280 })
        .addTo(this._maritimeShipLayer);
    });
  }

  // ─── Keyboard shortcuts ────────────────────────────────────
  _bindKeys() {
    document.addEventListener('keydown', e => {
      // ── Command Palette: Ctrl+K / Cmd+K ──
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this._toggleCommandPalette();
        return;
      }

      // ── ESC: Close palette first, then everything else ──
      if (e.key === 'Escape') {
        const pal = document.getElementById('command-palette');
        if (pal && pal.classList.contains('visible')) {
          this._closeCommandPalette();
          return;
        }
        if (this._followTarget) this._cancelFollow();
        const help = document.getElementById('shortcuts-tooltip');
        if (help) help.classList.remove('visible');
        if (this._measureMode) {
          this._measureMode = false;
          this._measurePts = [];
          if (this._measureLine) { this._leaflet2D.removeLayer(this._measureLine); this._measureLine = null; }
          const btn = document.getElementById('maptb-measure');
          if (btn) btn.classList.remove('active');
        }
        const sb = document.getElementById('globe-search-bar');
        if (sb) sb.style.display = 'none';
        // Close waterfall/oscilloscope
        document.getElementById('sigint-waterfall-panel')?.classList.remove('visible');
        document.getElementById('oscilloscope-panel')?.classList.remove('visible');
        return;
      }

      if (['INPUT','TEXTAREA'].includes(e.target.tagName)) return;

      // View switching: 1-5
      const viewMap = { '1':'globe_3d', '2':'map_2d', '3':'radar', '4':'orbital', '5':'maritime' };
      if (viewMap[e.key]) {
        this.switchView(viewMap[e.key]);
        return;
      }

      if (e.key === '?') {
        const help = document.getElementById('shortcuts-tooltip');
        if (help) help.classList.toggle('visible');
        return;
      }

      // Map tool shortcuts
      if (this._current === 'map_2d' || this._current === 'maritime') {
        if (e.key === 'h' || e.key === 'H') { document.getElementById('maptb-heat')?.click(); return; }
        if (e.key === 'g' || e.key === 'G') { document.getElementById('maptb-grid')?.click(); return; }
        if (e.key === 't' || e.key === 'T') { document.getElementById('maptb-trails')?.click(); return; }
        if (e.key === 'm' || e.key === 'M') { document.getElementById('maptb-measure')?.click(); return; }
      }

      if (e.key === 'f' || e.key === 'F') {
        if (this._current === 'globe_3d') {
          const sb = document.getElementById('globe-search-bar');
          if (sb) { sb.style.display = sb.style.display === 'none' ? 'block' : 'none'; }
        } else if (this._current === 'map_2d' || this._current === 'maritime') {
          const input = document.getElementById('map-search-input');
          if (input) input.focus();
        }
        return;
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE VII: COMMAND PALETTE (Ctrl+K)
  // ═══════════════════════════════════════════════════════════

  _buildCommandPalette() {
    if (document.getElementById('command-palette')) return;

    const backdrop = document.createElement('div');
    backdrop.id = 'command-palette-backdrop';
    backdrop.addEventListener('click', () => this._closeCommandPalette());
    document.body.appendChild(backdrop);

    const pal = document.createElement('div');
    pal.id = 'command-palette';
    pal.innerHTML = `
      <div class="cmd-input-wrap">
        <span class="cmd-icon">⌕</span>
        <input id="cmd-input" type="text" placeholder="Type a command or search…" autocomplete="off" spellcheck="false" />
        <span class="cmd-shortcut-hint">ESC</span>
      </div>
      <div id="cmd-results"></div>
    `;
    document.body.appendChild(pal);

    this._cmdSelectedIdx = 0;
    this._cmdFilteredItems = [];

    const input = document.getElementById('cmd-input');
    input.addEventListener('input', () => this._filterCommands(input.value));
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); this._cmdNav(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this._cmdNav(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); this._cmdExec(); }
    });
  }

  _getCommandRegistry() {
    return [
      { group: 'VIEWS', icon: '◉', label: 'Globe 3D',      shortcut: '1', action: () => this.switchView('globe_3d') },
      { group: 'VIEWS', icon: '⊞', label: 'Map 2D',        shortcut: '2', action: () => this.switchView('map_2d') },
      { group: 'VIEWS', icon: '◎', label: 'ATC Radar',      shortcut: '3', action: () => this.switchView('radar') },
      { group: 'VIEWS', icon: '⊕', label: 'Orbital',        shortcut: '4', action: () => this.switchView('orbital') },
      { group: 'VIEWS', icon: '⚓', label: 'Maritime',       shortcut: '5', action: () => this.switchView('maritime') },
      { group: 'TOOLS', icon: '🔥', label: 'Toggle Heatmap',   shortcut: 'H', action: () => document.getElementById('maptb-heat')?.click() },
      { group: 'TOOLS', icon: '▦',  label: 'Toggle Grid',      shortcut: 'G', action: () => document.getElementById('maptb-grid')?.click() },
      { group: 'TOOLS', icon: '⋯',  label: 'Toggle Trails',    shortcut: 'T', action: () => document.getElementById('maptb-trails')?.click() },
      { group: 'TOOLS', icon: '📏', label: 'Measure Distance',  shortcut: 'M', action: () => document.getElementById('maptb-measure')?.click() },
      { group: 'TOOLS', icon: '⤳',  label: 'Toggle Bearings',  shortcut: '',  action: () => document.getElementById('maptb-bearing')?.click() },
      { group: 'TOOLS', icon: '◎',  label: 'Proximity Rings',  shortcut: '',  action: () => document.getElementById('maptb-rings')?.click() },
      { group: 'TOOLS', icon: '✎',  label: 'Draw Geofence',    shortcut: '',  action: () => document.getElementById('maptb-draw')?.click() },
      { group: 'PANELS', icon: '📡', label: 'SIGINT Waterfall',  shortcut: '', action: () => this._toggleWaterfall() },
      { group: 'PANELS', icon: '〰', label: 'Oscilloscope',      shortcut: '', action: () => this._toggleOscilloscope() },
      { group: 'ACTIONS', icon: '⊠', label: 'Reset Globe View',  shortcut: 'ESC', action: () => window.__nemesisGlobe?.resetView() },
      { group: 'ACTIONS', icon: '↻', label: 'Toggle Auto-Rotate', shortcut: '', action: () => document.getElementById('gf-rotate')?.click() },
      { group: 'ACTIONS', icon: '⌕', label: 'Search Entities',    shortcut: 'F', action: () => { const si = document.getElementById('map-search-input'); if (si) si.focus(); } },
    ];
  }

  _toggleCommandPalette() {
    this._buildCommandPalette();
    const pal = document.getElementById('command-palette');
    const bd  = document.getElementById('command-palette-backdrop');
    const visible = pal.classList.contains('visible');
    if (visible) {
      this._closeCommandPalette();
    } else {
      pal.classList.add('visible');
      bd.classList.add('visible');
      const input = document.getElementById('cmd-input');
      input.value = '';
      input.focus();
      this._filterCommands('');
    }
  }

  _closeCommandPalette() {
    document.getElementById('command-palette')?.classList.remove('visible');
    document.getElementById('command-palette-backdrop')?.classList.remove('visible');
  }

  _filterCommands(query) {
    const registry = this._getCommandRegistry();
    const q = query.toLowerCase().trim();
    const filtered = q ? registry.filter(c => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)) : registry;
    this._cmdFilteredItems = filtered;
    this._cmdSelectedIdx = 0;

    const results = document.getElementById('cmd-results');
    if (!results) return;

    if (filtered.length === 0) {
      results.innerHTML = '<div class="cmd-empty">No matching commands</div>';
      return;
    }

    let html = '';
    let lastGroup = '';
    filtered.forEach((item, i) => {
      if (item.group !== lastGroup) {
        html += `<div class="cmd-group-label">${item.group}</div>`;
        lastGroup = item.group;
      }
      const labelHtml = q ? item.label.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>') : item.label;
      html += `<div class="cmd-item${i === 0 ? ' selected' : ''}" data-idx="${i}">
        <span class="cmd-item-icon">${item.icon}</span>
        <span class="cmd-item-label">${labelHtml}</span>
        ${item.shortcut ? `<span class="cmd-item-shortcut">${item.shortcut}</span>` : ''}
      </div>`;
    });
    results.innerHTML = html;

    results.querySelectorAll('.cmd-item').forEach(el => {
      el.addEventListener('click', () => {
        this._cmdSelectedIdx = parseInt(el.dataset.idx);
        this._cmdExec();
      });
    });
  }

  _cmdNav(dir) {
    if (!this._cmdFilteredItems.length) return;
    this._cmdSelectedIdx = (this._cmdSelectedIdx + dir + this._cmdFilteredItems.length) % this._cmdFilteredItems.length;
    document.querySelectorAll('#cmd-results .cmd-item').forEach((el, i) => {
      el.classList.toggle('selected', i === this._cmdSelectedIdx);
      if (i === this._cmdSelectedIdx) el.scrollIntoView({ block: 'nearest' });
    });
  }

  _cmdExec() {
    const item = this._cmdFilteredItems[this._cmdSelectedIdx];
    if (item) {
      this._closeCommandPalette();
      item.action();
      NemesisUI.log(`CMD: ${item.label}`, 'ok');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE VII: SIGNAL INTELLIGENCE WATERFALL
  // ═══════════════════════════════════════════════════════════

  _buildWaterfallPanel() {
    if (document.getElementById('sigint-waterfall-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'sigint-waterfall-panel';
    panel.innerHTML = `
      <div class="wf-header">
        <span>📡 SIGINT WATERFALL — RF SPECTRUM</span>
        <span class="wf-close" onclick="document.getElementById('sigint-waterfall-panel').classList.remove('visible')">✕</span>
      </div>
      <div class="wf-body">
        <canvas id="waterfall-canvas"></canvas>
        <div class="wf-freq-axis">
          <span>1 GHz</span><span>L</span><span>S</span><span>C</span><span>X</span><span>Ku</span><span>Ka</span><span>40 GHz</span>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
  }

  _toggleWaterfall() {
    this._buildWaterfallPanel();
    const panel = document.getElementById('sigint-waterfall-panel');
    const wasVisible = panel.classList.contains('visible');
    panel.classList.toggle('visible');

    if (!wasVisible) {
      this._startWaterfallRender();
    } else {
      if (this._waterfallFrame) { cancelAnimationFrame(this._waterfallFrame); this._waterfallFrame = null; }
    }
  }

  _startWaterfallRender() {
    const canvas = document.getElementById('waterfall-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const parent = canvas.parentElement;

    const resize = () => {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight - 16;
    };
    resize();

    const W = canvas.width, H = canvas.height;
    const spectrumBins = W;
    const noiseFloor = new Float32Array(spectrumBins);
    for (let i = 0; i < spectrumBins; i++) noiseFloor[i] = Math.random() * 0.15;

    // Simulated anomaly bands
    const anomalies = [
      { center: Math.floor(W * 0.18), width: 8, intensity: 0.7, drift: 0.002 },
      { center: Math.floor(W * 0.42), width: 12, intensity: 0.85, drift: -0.001 },
      { center: Math.floor(W * 0.73), width: 6, intensity: 0.6, drift: 0.003 },
    ];

    let t = 0;
    const render = () => {
      const panel = document.getElementById('sigint-waterfall-panel');
      if (!panel || !panel.classList.contains('visible')) return;

      // Shift image down by 1 row
      const imgData = ctx.getImageData(0, 0, W, H - 1);
      ctx.putImageData(imgData, 0, 1);

      // Generate new top row
      for (let x = 0; x < W; x++) {
        let val = noiseFloor[x] + Math.random() * 0.08;

        // Add anomaly signals
        for (const a of anomalies) {
          const center = a.center + Math.sin(t * a.drift * Math.PI) * 10;
          const dist = Math.abs(x - center);
          if (dist < a.width) {
            val += a.intensity * (1 - dist / a.width) * (0.7 + Math.random() * 0.3);
          }
        }

        val = Math.min(1, val);

        // Color mapping: blue → cyan → yellow → red
        let r, g, b;
        if (val < 0.25)      { r = 0;   g = 0;   b = Math.floor(val * 4 * 180); }
        else if (val < 0.5)  { r = 0;   g = Math.floor((val - 0.25) * 4 * 220); b = 180; }
        else if (val < 0.75) { r = Math.floor((val - 0.5) * 4 * 255); g = 220; b = Math.floor(180 * (1 - (val - 0.5) * 4)); }
        else                 { r = 255; g = Math.floor(220 * (1 - (val - 0.75) * 4)); b = 0; }

        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, 0, 1, 1);
      }

      t++;
      this._waterfallFrame = requestAnimationFrame(render);
    };
    render();
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE VII: TELEMETRY WAVEFORM OSCILLOSCOPE
  // ═══════════════════════════════════════════════════════════

  _buildOscilloscopePanel() {
    if (document.getElementById('oscilloscope-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'oscilloscope-panel';
    panel.innerHTML = `
      <div class="osc-header">
        <span>〰 TELEMETRY WAVEFORM — LIVE</span>
        <span class="osc-close" onclick="document.getElementById('oscilloscope-panel').classList.remove('visible')">✕</span>
      </div>
      <div class="osc-body">
        <canvas id="oscilloscope-canvas"></canvas>
      </div>
    `;
    document.body.appendChild(panel);
  }

  _toggleOscilloscope() {
    this._buildOscilloscopePanel();
    const panel = document.getElementById('oscilloscope-panel');
    const wasVisible = panel.classList.contains('visible');
    panel.classList.toggle('visible');

    if (!wasVisible) {
      this._startOscilloscopeRender();
    } else {
      if (this._oscFrame) { cancelAnimationFrame(this._oscFrame); this._oscFrame = null; }
    }
  }

  _startOscilloscopeRender() {
    const canvas = document.getElementById('oscilloscope-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const parent = canvas.parentElement;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
    const W = canvas.width, H = canvas.height;

    // Waveform data buffers — 3 channels
    const bufLen = 120;
    const channels = [
      { data: new Float32Array(bufLen), color: 'rgba(35,133,81,0.9)',  label: 'SAT Δ',  freq: 0.08, amp: 0.3 },
      { data: new Float32Array(bufLen), color: 'rgba(45,114,210,0.8)', label: 'FLT VEL', freq: 0.12, amp: 0.25 },
      { data: new Float32Array(bufLen), color: 'rgba(209,152,11,0.7)', label: 'DENSITY', freq: 0.05, amp: 0.2 },
    ];

    let t = 0;
    const render = () => {
      const panel = document.getElementById('oscilloscope-panel');
      if (!panel || !panel.classList.contains('visible')) return;

      ctx.fillStyle = 'rgba(8,12,16,0.3)';
      ctx.fillRect(0, 0, W, H);

      // Grid
      ctx.strokeStyle = 'rgba(45,114,210,0.06)';
      ctx.lineWidth = 0.5;
      for (let x = 0; x < W; x += W / 10) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += H / 6)  { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

      // Center line
      ctx.strokeStyle = 'rgba(45,114,210,0.12)';
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

      // Update and draw each channel
      channels.forEach((ch, ci) => {
        // Shift left, add new value
        for (let i = 0; i < bufLen - 1; i++) ch.data[i] = ch.data[i + 1];
        const satCount = this._satellites?.length || 50;
        const fltCount = this._flights?.length || 20;
        const base = ci === 0 ? satCount / 500 : ci === 1 ? fltCount / 200 : (satCount + fltCount) / 800;
        ch.data[bufLen - 1] = base + Math.sin(t * ch.freq) * ch.amp + (Math.random() - 0.5) * 0.15;

        // Draw waveform with phosphor glow
        ctx.strokeStyle = ch.color;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = ch.color;
        ctx.shadowBlur = 4;
        ctx.beginPath();
        for (let i = 0; i < bufLen; i++) {
          const x = (i / bufLen) * W;
          const y = H / 2 - ch.data[i] * H * 0.4;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Channel label
        ctx.fillStyle = ch.color;
        ctx.font = '8px JetBrains Mono, monospace';
        ctx.fillText(ch.label, 4, 12 + ci * 12);
      });

      // Time markers
      ctx.fillStyle = 'rgba(45,114,210,0.2)';
      ctx.font = '7px JetBrains Mono, monospace';
      const now = new Date();
      ctx.fillText(now.toUTCString().slice(17, 25) + 'Z', W - 60, H - 4);

      t++;
      this._oscFrame = requestAnimationFrame(render);
    };
    render();
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE VII: ENTITY ANALYTICS SPARKLINES
  // ═══════════════════════════════════════════════════════════

  _initSparklines() {
    if (this._sparklineInited) return;
    this._sparklineInited = true;

    this._sparkData = {
      sats:   new Array(40).fill(0),
      flights: new Array(40).fill(0),
      ships:  new Array(40).fill(0),
    };

    // Build sparkline container in nav column (insert before log section)
    const navCol = document.getElementById('nav-column') || document.querySelector('.nav-col');
    if (!navCol) return;

    const container = document.createElement('div');
    container.id = 'entity-sparklines';
    container.style.cssText = 'border-top:1px solid rgba(45,114,210,0.08);padding:6px 0;margin-top:4px;';
    container.innerHTML = `
      <div style="font-family:var(--font-mono);font-size:8px;color:var(--text-dim);padding:2px 12px;letter-spacing:0.12em;margin-bottom:2px;">ENTITY TRENDS</div>
      ${['SAT','FLT','SHP'].map(k => `
        <div class="entity-sparkline-row">
          <span class="spark-label">${k}</span>
          <svg class="entity-sparkline-svg" id="spark-${k.toLowerCase()}" viewBox="0 0 120 20" preserveAspectRatio="none">
            <path class="spark-fill" d="M0,20 L120,20"/>
            <path d="M0,20 L120,20"/>
          </svg>
          <span class="spark-val" id="spark-val-${k.toLowerCase()}">0</span>
        </div>
      `).join('')}
    `;

    // Find a good insertion point
    const logSection = navCol.querySelector('#log-list')?.parentElement;
    if (logSection) {
      navCol.insertBefore(container, logSection);
    } else {
      navCol.appendChild(container);
    }

    // Update every 3 seconds
    setInterval(() => this._updateSparklines(), 3000);
  }

  _updateSparklines() {
    if (!this._sparkData) return;

    const counts = {
      sats: this._satellites?.length || 0,
      flights: this._flights?.length || 0,
      ships: this._ships?.length || 0,
    };

    ['sats', 'flights', 'ships'].forEach(key => {
      this._sparkData[key].shift();
      this._sparkData[key].push(counts[key]);

      const abbr = key === 'sats' ? 'sat' : key === 'flights' ? 'flt' : 'shp';
      const svg = document.getElementById(`spark-${abbr}`);
      const valEl = document.getElementById(`spark-val-${abbr}`);
      if (valEl) valEl.textContent = counts[key];
      if (!svg) return;

      const data = this._sparkData[key];
      const max = Math.max(...data, 1);
      const W = 120, H = 20;

      const points = data.map((v, i) => {
        const x = (i / (data.length - 1)) * W;
        const y = H - (v / max) * (H - 2) - 1;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });

      const linePath = `M${points.join(' L')}`;
      const fillPath = `M0,${H} L${points.join(' L')} L${W},${H} Z`;

      const paths = svg.querySelectorAll('path');
      if (paths[0]) paths[0].setAttribute('d', fillPath);
      if (paths[1]) paths[1].setAttribute('d', linePath);
    });
  }
}

