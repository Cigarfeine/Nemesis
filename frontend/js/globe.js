/**
 * Project Nemesis — Globe Module v4 (Palantir-Grade)
 * Professional 3D tactical globe: terminator, HUD, lock-on, search, coverage cone
 */
import { NemesisUI } from './ui.js';
import { NemesisVFX } from './vfx.js';

const EARTH_RADIUS_KM = 6371;
const AUTO_ROTATE_SPEED = 0.06;

const GROUP_CONFIG = {
  visual:   { color: '#38bdf8', label: 'LEO'      }, // Soft Cyan
  stations: { color: '#6366f1', label: 'STATION'  }, // Indigo/Blue
  gnss:     { color: '#fbbf24', label: 'GNSS'     }, // Soft Amber
  debris:   { color: '#f43f5e', label: 'DEBRIS'   }, // Minimal Soft Red
  military: { color: '#10b981', label: 'MILITARY' }, // Emerald Soft Green
};

export class NemesisGlobe {
  constructor(containerId) {
    this._containerId         = containerId;
    this._globe               = null;
    this._satellites          = [];
    this._flights             = [];
    this._ships               = [];
    this._selectedId          = null;
    this._selectedSat         = null;
    this._rotating            = true;
    this._frameId             = null;
    this._lockOn              = false;
    this._lockOnAlt           = 0.25;
    this._orbitalRingObjects  = [];
    this._terminatorMesh      = null;
    this._coverageCone        = null;
    this._coverageConeWire    = null;
    this._zoomLevel           = 'orbital';
    this._measureStart        = null;
    this._contextMenu         = null;
    this._searchBar           = null;
    this._filters = {
      satellites: true,
      flights:    true,
      stations:   true,
      gnss:       true,
      terminator: true,
      labels:     true,
      heatmaps:   false,
      isll:       false,
      anomaly:    false,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════

  init() {
    const container = document.getElementById(this._containerId);
    if (!container) throw new Error(`#${this._containerId} not found`);

    NemesisVFX.injectKeyframes();

    this._globe = Globe({ animateIn: false, rendererConfig: { antialias: true, alpha: true } })(container)
      .globeImageUrl('assets/earth-dark.jpg')
      .bumpImageUrl('assets/earth-topo-bathy.jpg')
      .backgroundImageUrl('')
      .atmosphereColor('#4A90D9')
      .atmosphereAltitude(0.15)
      .showAtmosphere(true)
      .showGraticules(false)
      .pointOfView({ lat: 20, lng: 10, altitude: 2.4 })
      .enablePointerInteraction(true);

    container.style.cursor = 'crosshair';

    // ── Layers ─────────────────────────────────────────────
    this._initPointLayer();
    this._initPathLayer();
    this._initPolygonLayer();
    this._initGeoHubs();

    // ── Callbacks ──────────────────────────────────────────
    this._globe.onPointHover(d => this._onSatHover(d));
    this._globe.onPointClick(d => { if (d) this._onSatClick(d); });
    this._globe.onGlobeClick(coords => this._onGlobeClick(coords));

    // ── DOM overlays ───────────────────────────────────────
    this._buildGlobeHUD(container);
    this._initContextMenu(container);
    this._initSearchBar(container);

    // ── Native events ──────────────────────────────────────
    container.addEventListener('dblclick',    e => this._onDoubleClick(e));
    container.addEventListener('contextmenu', e => this._onContextMenu(e));
    container.addEventListener('click',       () => this._hideContextMenu());
    document.addEventListener('keydown',      e => this._onKeyDown(e));

    // ── Camera change ──────────────────────────────────────
    this._globe.controls().addEventListener('change', () => {
      const alt = this._globe.pointOfView().altitude;
      this._zoomLevel = alt < 0.15 ? 'local' : alt < 0.7 ? 'regional' : 'orbital';
      this._hideContextMenu();
    });

    // ── Resize ─────────────────────────────────────────────
    new ResizeObserver(() => {
      this._globe.width(container.offsetWidth);
      this._globe.height(container.offsetHeight);
    }).observe(container);

    // ── Post-init effects ──────────────────────────────────
    setTimeout(() => NemesisVFX._enhanceGlobe(this), 800);
    setTimeout(() => {
      this._initTerminator();
      setInterval(() => this._updateTerminator(), 60000);
    }, 1200);
    setTimeout(() => this._applyOceanShader(), 1500);
    setTimeout(() => this._initFresnelAtmosphere(), 600);
    setTimeout(() => this._initSubtleGraticule(), 900);

    this._startAnimationLoop();
    NemesisUI.log('Globe v5 — Blueprint Intelligence Platform active', 'ok');
    return this;
  }

  // ═══════════════════════════════════════════════════════════
  // GLOBE HUD TOOLBAR
  // ═══════════════════════════════════════════════════════════

  _buildGlobeHUD(container) {
    const hud = document.createElement('div');
    hud.id = 'globe-hud';
    hud.innerHTML = `
      <div class="globe-hud-row">
        <div class="ghud-section">
          <span class="ghud-label">OBJ</span>
          <button class="ghud-btn active" id="gf-satellites">🛰 SATS</button>
          <button class="ghud-btn active" id="gf-flights">✈ AIR</button>
          <button class="ghud-btn active" id="gf-stations">◉ STA</button>
          <button class="ghud-btn active" id="gf-gnss">◆ GPS</button>
        </div>
        <div class="ghud-sep"></div>
        <div class="ghud-section">
          <span class="ghud-label">VIEW</span>
          <button class="ghud-btn active" id="gf-terminator" title="Day/Night terminator [T]">☀ TERM</button>
          <button class="ghud-btn active" id="gf-labels" title="Geo-Hub labels">◎ HUBS</button>
          <button class="ghud-btn" id="gf-rotate" title="Auto-rotate [R]">↻ ROT</button>
          <button class="ghud-btn" id="gf-bloom" title="Toggle cinematic bloom glow">✦ BLOOM</button>
        </div>
        <div class="ghud-sep"></div>
        <div class="ghud-section">
          <span class="ghud-label">C2 / AI</span>
          <button class="ghud-btn" id="gf-heatmaps" title="Hexbin Heatmaps">⬡ HEX</button>
          <button class="ghud-btn" id="gf-isll" title="Inter-Satellite Links">⤡ ISLL</button>
          <button class="ghud-btn" id="gf-anomaly" title="AI Anomaly Filter">⚠ FLTR</button>
        </div>
        <div class="ghud-sep"></div>
        <div class="ghud-section">
          <span class="ghud-label">CAM</span>
          <button class="ghud-btn" id="gf-lockon" title="Lock camera to selected [L]">⊕ LOCK</button>
          <button class="ghud-btn" id="gf-reset"  title="Reset view [ESC]">⊠ RESET</button>
          <button class="ghud-btn" id="gf-search" title="Search assets [Ctrl+F]">⌕ FIND</button>
        </div>
        <div class="ghud-right">
          <span id="globe-zoom-level">ORBITAL</span>
          <span id="globe-sat-tally">— SAT</span>
        </div>
      </div>
    `;
    // Attach to body (sibling of globe container's parent)
    document.body.appendChild(hud);

    // Filter toggles
    const filterMap = {
      'gf-satellites': 'satellites',
      'gf-flights':    'flights',
      'gf-stations':   'stations',
      'gf-gnss':       'gnss',
      'gf-terminator': 'terminator',
      'gf-labels':     'labels',
      'gf-heatmaps':   'heatmaps',
      'gf-isll':       'isll',
      'gf-anomaly':    'anomaly',
    };
    Object.entries(filterMap).forEach(([id, key]) => {
      document.getElementById(id)?.addEventListener('click', e => {
        e.stopPropagation();
        this._filters[key] = !this._filters[key];
        document.getElementById(id)?.classList.toggle('active', this._filters[key]);
        this._applyFilters();
      });
    });

    // Rotate toggle
    document.getElementById('gf-rotate')?.addEventListener('click', e => {
      e.stopPropagation();
      this._rotating = !this._rotating;
      document.getElementById('gf-rotate')?.classList.toggle('active', this._rotating);
      NemesisUI.log(`Auto-rotate: ${this._rotating ? 'ON' : 'OFF'}`);
    });

    // Lock-on toggle
    document.getElementById('gf-lockon')?.addEventListener('click', e => {
      e.stopPropagation();
      this._lockOn = !this._lockOn;
      document.getElementById('gf-lockon')?.classList.toggle('active', this._lockOn);
      const name = this._selectedSat?.name || 'nothing';
      NemesisUI.log(`Lock-on: ${this._lockOn ? 'TRACKING ' + name : 'OFF'}`);
    });

    // Reset
    document.getElementById('gf-reset')?.addEventListener('click', e => {
      e.stopPropagation();
      this.resetView();
    });

    // Search
    document.getElementById('gf-search')?.addEventListener('click', e => {
      e.stopPropagation();
      this._toggleSearchBar();
    });

    // Phase VII: Bloom toggle
    this._bloomEnabled = false;
    document.getElementById('gf-bloom')?.addEventListener('click', e => {
      e.stopPropagation();
      this._bloomEnabled = !this._bloomEnabled;
      document.getElementById('gf-bloom')?.classList.toggle('bloom-active', this._bloomEnabled);
      const container = document.getElementById(this._containerId);
      if (container) {
        if (this._bloomEnabled) {
          container.style.filter = 'brightness(1.05) contrast(1.08)';
          container.style.mixBlendMode = 'screen';
          // Inject a subtle glow overlay
          if (!this._bloomOverlay) {
            this._bloomOverlay = document.createElement('div');
            this._bloomOverlay.style.cssText = `
              position:absolute; inset:0; z-index:1; pointer-events:none;
              background: radial-gradient(ellipse at 50% 50%,
                rgba(45,114,210,0.04) 0%,
                rgba(45,114,210,0.02) 40%,
                transparent 70%);
              mix-blend-mode: screen;
              animation: bloom-pulse 4s ease-in-out infinite;
            `;
            container.appendChild(this._bloomOverlay);
            // Inject keyframes
            if (!document.getElementById('bloom-keyframes')) {
              const style = document.createElement('style');
              style.id = 'bloom-keyframes';
              style.textContent = `@keyframes bloom-pulse { 0%,100%{opacity:0.6} 50%{opacity:1} }`;
              document.head.appendChild(style);
            }
          }
          this._bloomOverlay.style.display = 'block';
        } else {
          container.style.filter = '';
          container.style.mixBlendMode = '';
          if (this._bloomOverlay) this._bloomOverlay.style.display = 'none';
        }
      }
      NemesisUI.log(`Bloom: ${this._bloomEnabled ? 'ON' : 'OFF'}`);
    });
  }

  // ═══════════════════════════════════════════════════════════
  // LAYERS
  // ═══════════════════════════════════════════════════════════

  _initPointLayer() {
    this._globe
      .pointsData([])
      .pointLat(d      => d.lat)
      .pointLng(d      => d.lon)
      .pointAltitude(d => this._pointAlt(d))
      .pointColor(d    => this._pointColor(d))
      .pointRadius(d   => this._pointRadius(d))
      .pointResolution(8)
      .pointsMerge(false)
      .pointLabel(d    => this._pointLabel(d));
  }

  _initPathLayer() {
    this._globe
      .pathsData([])
      .pathPoints(d      => d.points)
      .pathPointLat(p    => p[0])
      .pathPointLng(p    => p[1])
      .pathPointAlt(p    => p[2] || 0)
      .pathColor(d       => d.color || ['rgba(0,245,255,0.05)', 'rgba(0,245,255,0.7)'])
      .pathStroke(1.5)
      .pathDashLength(0.15)
      .pathDashGap(0.08)
      .pathDashAnimateTime(5000);
  }

  _initPolygonLayer() {
    // Load local high-quality GeoJSON for Palantir-grade glowing borders
    fetch('assets/countries.geojson')
      .then(r => r.json())
      .then(geo => {
        const features = geo.features || [];
        if (!features.length || !this._globe) return;

        // Palantir double-stroke technique:
        // Layer 1: Wider semi-transparent glow border (the "outer glow")
        // Layer 2: Thin solid bright border (rendered via polygonStrokeColor)
        this._globe
          .polygonsData(features)
          .polygonGeoJsonGeometry(d => d.geometry)
          .polygonCapColor(() => 'rgba(18, 28, 42, 0.35)')      // Dark land mass with deep blue tint
          .polygonSideColor(() => 'rgba(45, 114, 210, 0.08)')    // Subtle inner edge glow
          .polygonStrokeColor(() => 'rgba(72, 175, 240, 0.45)')  // Bright blue border line
          .polygonAltitude(0.005);                                // Slightly lifted for depth

      }).catch(() => {
        // Fallback to CDN TopoJSON
        fetch('https://unpkg.com/world-atlas@2.0.2/countries-110m.json')
          .then(r => r.json())
          .then(world => {
            const apply = () => {
              if (!window.topojson || !this._globe) return;
              const countries = window.topojson.feature(world, world.objects.countries).features;
              this._globe
                .polygonsData(countries)
                .polygonCapColor(() => 'rgba(18, 28, 42, 0.35)')
                .polygonSideColor(() => 'rgba(45, 114, 210, 0.08)')
                .polygonStrokeColor(() => 'rgba(72, 175, 240, 0.45)')
                .polygonAltitude(0.005);
            };
            if (!window.topojson) {
              const s = document.createElement('script');
              s.src = 'https://unpkg.com/topojson-client@3';
              s.onload = apply;
              document.head.appendChild(s);
            } else { apply(); }
          }).catch(() => {});
      });
  }

  _initGeoHubs() {
    fetch('http://localhost:8000/api/geo-hubs')
      .then(r => r.json())
      .then(data => {
        const hubs = (data.hubs || []).filter(h => h.tier === 'critical' || h.tier === 'major');
        this._geoHubsData = hubs; // Store for connection arcs
        if (!this._filters.labels) return;
        this._globe
          .labelsData(hubs)
          .labelLat(d  => d.lat)
          .labelLng(d  => d.lon)
          .labelText(d => d.name.toUpperCase())
          .labelSize(d => d.tier === 'critical' ? 0.5 : 0.35)
          .labelDotRadius(d => d.tier === 'critical' ? 0.35 : 0.2)
          .labelColor(d => d.tier === 'critical' ? 'rgba(255,68,68,0.85)' : 'rgba(255,136,0,0.75)')
          .labelResolution(2)
          .onLabelClick(d => {
            this.focusLocation(d.lat, d.lon, 0.3);
            NemesisUI.log(`HUB: ${d.name}  [${(d.type || '').toUpperCase()}]`, 'ok');
          });
      }).catch(() => {});
  }

  // ═══════════════════════════════════════════════════════════
  // FRESNEL ATMOSPHERE RIM-GLOW
  // ═══════════════════════════════════════════════════════════

  _initFresnelAtmosphere() {
    if (!this._globe || !window.THREE) return;
    try {
      const scene  = this._globe.scene();
      const globeR = this._globe.getGlobeRadius();
      const geom   = new THREE.SphereGeometry(globeR * 1.025, 64, 64);
      const mat    = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite:  false,
        side:        THREE.FrontSide,
        uniforms: {
          glowColor:  { value: new THREE.Color('#4A90D9') },
          glowPower:  { value: 4.0 },
          glowScale:  { value: 0.6 }
        },
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vWorldPosition;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPos.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPos;
          }
        `,
        fragmentShader: `
          uniform vec3  glowColor;
          uniform float glowPower;
          uniform float glowScale;
          varying vec3  vNormal;
          varying vec3  vWorldPosition;
          void main() {
            vec3 viewDir = normalize(cameraPosition - vWorldPosition);
            float rim = 1.0 - max(0.0, dot(vNormal, viewDir));
            float intensity = glowScale * pow(rim, glowPower);
            gl_FragColor = vec4(glowColor, intensity * 0.55);
          }
        `
      });
      const atmoMesh = new THREE.Mesh(geom, mat);
      scene.add(atmoMesh);
      this._fresnelMesh = atmoMesh;
      NemesisUI.log('Fresnel atmosphere shader active', 'ok');
    } catch (e) {
      console.warn('[Globe] Fresnel atmosphere failed:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SUBTLE GRATICULE OVERLAY
  // ═══════════════════════════════════════════════════════════

  _initSubtleGraticule() {
    if (!this._globe || !window.THREE) return;
    try {
      const scene  = this._globe.scene();
      const globeR = this._globe.getGlobeRadius();
      const d2r    = Math.PI / 180;
      const material = new THREE.LineBasicMaterial({
        color: new THREE.Color('#1a3a5c'),
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      });

      // Latitude lines every 30°
      for (let lat = -60; lat <= 60; lat += 30) {
        const points = [];
        const r = globeR * 1.002 * Math.cos(lat * d2r);
        const y = globeR * 1.002 * Math.sin(lat * d2r);
        for (let lng = 0; lng <= 360; lng += 3) {
          points.push(new THREE.Vector3(
            r * Math.cos(lng * d2r),
            y,
            r * Math.sin(lng * d2r)
          ));
        }
        const geo  = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geo, material);
        scene.add(line);
      }

      // Longitude lines every 30°
      for (let lng = 0; lng < 360; lng += 30) {
        const points = [];
        for (let lat = -90; lat <= 90; lat += 3) {
          const phi   = (90 - lat) * d2r;
          const theta = lng * d2r;
          const R     = globeR * 1.002;
          points.push(new THREE.Vector3(
            R * Math.sin(phi) * Math.cos(theta),
            R * Math.cos(phi),
            R * Math.sin(phi) * Math.sin(theta)
          ));
        }
        const geo  = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geo, material);
        scene.add(line);
      }
    } catch (e) {
      console.warn('[Globe] Graticule overlay failed:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // DAY/NIGHT TERMINATOR
  // ═══════════════════════════════════════════════════════════

  _getSunVector() {
    const d2r = Math.PI / 180;
    const now = new Date();
    const JD  = now / 86400000 + 2440587.5;
    const n   = JD - 2451545.0;
    const L   = (280.460 + 0.9856474 * n) % 360;
    const g   = (357.528 + 0.9856003 * n) % 360;
    const lam = (L + 1.915 * Math.sin(g * d2r) + 0.020 * Math.sin(2 * g * d2r)) * d2r;
    const eps = 23.439 * d2r;
    // Equatorial direction → globe.gl Three.js coords (Y-up)
    return new THREE.Vector3(
      Math.cos(lam),
      Math.sin(eps) * Math.sin(lam),
      Math.cos(eps) * Math.sin(lam)
    ).normalize();
  }

  _initTerminator() {
    if (!this._globe || !window.THREE) return;
    try {
      const scene  = this._globe.scene();
      const globeR = this._globe.getGlobeRadius();
      const geom   = new THREE.SphereGeometry(globeR * 1.006, 64, 64);
      const mat    = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite:  false,
        side:        THREE.FrontSide,
        uniforms: {
          sunDir:          { value: this._getSunVector() },
          nightColor:      { value: new THREE.Vector4(0.0, 0.0, 0.04, 0.70) },
          terminatorWidth: { value: 0.09 },
        },
        vertexShader: `
          varying vec3 vWorldNormal;
          void main() {
            vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
            gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3  sunDir;
          uniform vec4  nightColor;
          uniform float terminatorWidth;
          varying vec3  vWorldNormal;
          void main() {
            float cosA  = dot(normalize(vWorldNormal), normalize(sunDir));
            float night = smoothstep(terminatorWidth, -terminatorWidth, cosA);
            gl_FragColor = vec4(nightColor.rgb, nightColor.a * night);
          }
        `,
      });
      this._terminatorMesh         = new THREE.Mesh(geom, mat);
      this._terminatorMesh.visible = this._filters.terminator;
      scene.add(this._terminatorMesh);
      NemesisUI.log('Terminator — solar day/night boundary active', 'ok');
    } catch (e) {
      console.warn('[Globe] Terminator shader failed:', e);
    }
  }

  _updateTerminator() {
    if (!this._terminatorMesh) return;
    this._terminatorMesh.material.uniforms.sunDir.value = this._getSunVector();
    this._terminatorMesh.visible = this._filters.terminator;
  }

  // ═══════════════════════════════════════════════════════════
  // CONTEXT MENU
  // ═══════════════════════════════════════════════════════════

  _initContextMenu(container) {
    const menu = document.createElement('div');
    menu.id = 'globe-ctx-menu';
    menu.innerHTML = `
      <div class="ctx-item" id="ctx-fly">◉ Fly camera here</div>
      <div class="ctx-item" id="ctx-radar">⊙ Set radar center</div>
      <div class="ctx-item" id="ctx-coords">⊞ Copy coordinates</div>
      <div class="ctx-item" id="ctx-measure">📏 Measure from here</div>
      <div class="ctx-sep"></div>
      <div class="ctx-item" id="ctx-reset">⊠ Reset orbital view</div>
    `;
    document.body.appendChild(menu);
    this._contextMenu = menu;
  }

  _onContextMenu(e) {
    e.preventDefault();
    const rect   = e.target.getBoundingClientRect();
    const coords = this._globe.toGlobeCoords(e.clientX - rect.left, e.clientY - rect.top);
    if (!coords) return;
    this._ctxCoords = coords;

    const cm = this._contextMenu;
    cm.style.display = 'block';
    cm.style.left    = `${e.clientX}px`;
    cm.style.top     = `${e.clientY}px`;

    // Ensure menu stays within viewport
    requestAnimationFrame(() => {
      const r = cm.getBoundingClientRect();
      if (r.right  > window.innerWidth)  cm.style.left = `${e.clientX - r.width}px`;
      if (r.bottom > window.innerHeight) cm.style.top  = `${e.clientY - r.height}px`;
    });

    const wire = (id, fn) => {
      const el = document.getElementById(id);
      if (el) { el.onclick = () => { fn(); this._hideContextMenu(); }; }
    };

    wire('ctx-fly',     () => this.focusLocation(coords.lat, coords.lng, 0.08));
    wire('ctx-radar',   () => {
      window.__nemesisViews?.setRadarCenter?.(coords.lat, coords.lng);
      NemesisUI.log(`Radar center → ${coords.lat.toFixed(2)}°, ${coords.lng.toFixed(2)}°`);
    });
    wire('ctx-coords',  () => {
      navigator.clipboard?.writeText(`${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`);
      NemesisUI.log(`Coords copied: ${coords.lat.toFixed(4)}°, ${coords.lng.toFixed(4)}°`, 'ok');
    });
    wire('ctx-measure', () => {
      this._measureStart = [coords.lat, coords.lng];
      NemesisUI.log('📏 Measure: click a second point on the globe');
    });
    wire('ctx-reset',   () => this.resetView());
  }

  _hideContextMenu() {
    if (this._contextMenu) this._contextMenu.style.display = 'none';
  }

  // ═══════════════════════════════════════════════════════════
  // SEARCH BAR  (Ctrl+F)
  // ═══════════════════════════════════════════════════════════

  _initSearchBar(container) {
    const sb = document.createElement('div');
    sb.id = 'globe-search-bar';
    sb.innerHTML = `
      <div class="gsb-inner">
        <span class="gsb-icon">⌕</span>
        <input id="gsb-input" type="text"
          placeholder="Search satellite name, NORAD ID, or callsign…"
          autocomplete="off" spellcheck="false" />
        <span class="gsb-hint">ESC to close · ENTER to select</span>
      </div>
      <div id="gsb-results"></div>
    `;
    document.body.appendChild(sb);
    this._searchBar = sb;

    const inp = document.getElementById('gsb-input');
    inp?.addEventListener('input',   () => this._doSearch(inp.value));
    inp?.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); this._hideSearchBar(); }
    });
  }

  _toggleSearchBar() {
    const sb = this._searchBar;
    if (!sb) return;
    const visible = sb.style.display === 'block';
    sb.style.display = visible ? 'none' : 'block';
    if (!visible) setTimeout(() => document.getElementById('gsb-input')?.focus(), 40);
  }

  _hideSearchBar() {
    if (this._searchBar) {
      this._searchBar.style.display = 'none';
      const inp = document.getElementById('gsb-input');
      if (inp) inp.value = '';
      const res = document.getElementById('gsb-results');
      if (res) res.innerHTML = '';
    }
  }

  _doSearch(query) {
    const q       = (query || '').trim().toLowerCase();
    const results = document.getElementById('gsb-results');
    if (!results) return;
    if (!q) { results.innerHTML = ''; return; }

    const sats = this._satellites
      .filter(s => s.name?.toLowerCase().includes(q) || String(s.id).includes(q))
      .slice(0, 6);
    const flts = this._flights
      .filter(f => f.callsign?.toLowerCase().includes(q) || f.icao24?.toLowerCase().includes(q))
      .slice(0, 4);
    const matches = [...sats, ...flts];

    if (!matches.length) {
      results.innerHTML = '<div class="gsb-no-result">No matching assets found</div>';
      return;
    }

    results.innerHTML = matches.map(m => `
      <div class="gsb-result" data-id="${m.id ?? m.icao24 ?? ''}"
           data-lat="${m.lat}" data-lon="${m.lon}"
           data-type="${m._type === 'flight' ? 'flight' : 'sat'}">
        <span class="gsb-icon ${m._type === 'flight' ? 'flight' : 'sat'}">
          ${m._type === 'flight' ? '✈' : '🛰'}
        </span>
        <span class="gsb-name">${m.name || m.callsign || m.icao24 || '—'}</span>
        ${m.id ? `<span class="gsb-id">${m.id}</span>` : ''}
        <span class="gsb-pos">${(+m.lat).toFixed(1)}° ${(+m.lon).toFixed(1)}°</span>
      </div>
    `).join('');

    results.querySelectorAll('.gsb-result').forEach(el => {
      el.addEventListener('click', () => {
        const lat  = parseFloat(el.dataset.lat);
        const lon  = parseFloat(el.dataset.lon);
        const id   = el.dataset.id;
        const type = el.dataset.type;
        let asset;
        if (type === 'sat') asset = this._satellites.find(s => String(s.id) === id);
        else                asset = this._flights.find(f => f.icao24 === id || String(f.id) === id);

        if (asset) this._onSatClick(asset);
        else       this.focusLocation(lat, lon, 0.3);
        this._hideSearchBar();
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  // COVERAGE CONE
  // ═══════════════════════════════════════════════════════════

  _drawCoverageCone(sat) {
    this._removeCoverageCone();
    if (!sat || !window.THREE || !this._globe) return;

    const scene  = this._globe.scene();
    const globeR = this._globe.getGlobeRadius();
    const altRatio = this._altRatio(sat.alt_km || 400);
    const altR   = globeR * (1 + altRatio);
    const half   = Math.asin(Math.min(globeR / altR, 1));
    const baseR  = globeR * Math.sin(half) * 0.98;
    const height = altR - (globeR * Math.cos(half));
    
    // Create cone with tip at y=0, growing downwards to y=-height
    const geo = new THREE.ConeGeometry(baseR, height, 64, 1, true);
    geo.translate(0, -height / 2, 0);

    const col = new THREE.Color(sat.color || '#00f3ff');
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        color: { value: col },
        heightMax: { value: height }
      },
      vertexShader: `
        varying vec3 vLocalPos;
        void main() {
          vLocalPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform float heightMax;
        varying vec3 vLocalPos;
        void main() {
          float depth = abs(vLocalPos.y) / heightMax;
          // Glow intensely near the tip, fade at the base to merge with Earth softly
          float alpha = pow(1.0 - depth, 1.5) * 0.25;
          gl_FragColor = vec4(color, alpha);
        }
      `
    });

    const cone = new THREE.Mesh(geo, mat);

    const phi   = (90 - sat.lat) * Math.PI / 180;
    const theta = sat.lon * Math.PI / 180;
    const satV  = new THREE.Vector3(
      altR * Math.sin(phi) * Math.cos(theta),
      altR * Math.cos(phi),
      altR * Math.sin(phi) * Math.sin(theta)
    );
    
    // Position tip exactly at satellite
    cone.position.copy(satV);
    // Point the base down toward Earth center (origin)
    cone.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, -1, 0),
      satV.clone().negate().normalize()
    );
    
    scene.add(cone);
    this._coverageCone = cone;

    // Hard wireframe edge ring at the base of the cone (tactical ping ring on the ground)
    const ringGeo = new THREE.RingGeometry(baseR * 0.98, baseR, 64);
    ringGeo.rotateX(-Math.PI / 2);
    // Position it at the base of the cone locally (y = -height)
    const edgeGeo = new THREE.EdgesGeometry(ringGeo);
    const edgeMat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.4 });
    const wire = new THREE.LineSegments(edgeGeo, edgeMat);
    wire.position.set(0, -height, 0);
    cone.add(wire); // add wire to cone so it inherits position/rotation
    this._coverageConeWire = wire;
  }

  _removeCoverageCone() {
    const sc = this._globe?.scene();
    if (sc) {
      if (this._coverageCone)     { sc.remove(this._coverageCone);     this._coverageCone = null; }
      if (this._coverageConeWire) { sc.remove(this._coverageConeWire); this._coverageConeWire = null; }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ORBITAL RING + TRAIL
  // ═══════════════════════════════════════════════════════════

  _drawOrbitalRing(sat) {
    this._orbitalRingObjects.forEach(o => this._globe?.scene().remove(o));
    this._orbitalRingObjects = [];
    if (!sat || !window.THREE || !this._globe) return;

    const scene  = this._globe.scene();
    const globeR = this._globe.getGlobeRadius();
    const altR   = globeR * (1 + this._altRatio(sat.alt_km || 400));
    const col    = new THREE.Color(sat.color || '#38bdf8');

    const obj    = new THREE.Group();
    const rGeo   = new THREE.RingGeometry(altR, altR + 0.05, 128);
    // Draw horizontal ring to resemble orbit path
    rGeo.rotateX(Math.PI / 2);

    const rMat   = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.35 });
    const ring   = new THREE.LineLoop(rGeo, rMat);
    const incRad = sat.lat  * 1.1 * Math.PI / 180;
    const lonRad = sat.lon * Math.PI / 180;
    ring.rotation.x = incRad;
    ring.rotation.z = lonRad;
    scene.add(ring);
    this._orbitalRingObjects.push(ring);

    // Ground track
    const gPts = [];
    for (let a = 0; a <= Math.PI * 2; a += 0.035) {
      const x = Math.cos(a + lonRad) * Math.cos(incRad);
      const y = Math.sin(a + lonRad);
      const z = Math.cos(a + lonRad) * Math.sin(incRad);
      gPts.push(new THREE.Vector3(x, y, z).normalize().multiplyScalar(globeR * 1.003));
    }
    const gLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(gPts),
      new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.14 })
    );
    scene.add(gLine);
    this._orbitalRingObjects.push(gLine);
  }

  _drawOrbitTrail(sat) {
    const STEPS = 120;
    const DEG   = (360 / 92) / STEPS;
    const pts   = [];
    for (let i = STEPS; i >= 0; i--) {
      const lng = ((sat.lon - i * DEG) + 540) % 360 - 180;
      pts.push([sat.lat, lng, 0.008]);
    }
    const c = sat.group === 'stations' ? '255,179,0' : '0,220,240';
    this._globe.pathsData([]);
    setTimeout(() => {
      this._globe.pathsData([{
        points: pts,
        color: [`rgba(${c},0.03)`, `rgba(${c},0.78)`],
      }]);
    }, 100);
  }

  // ═══════════════════════════════════════════════════════════
  // POINT DISPLAY HELPERS
  // ═══════════════════════════════════════════════════════════

  _pointAlt(d) {
    if (d._type === 'flight')      return 0.007;
    if (d.group === 'stations')    return 0.036;
    if (d.group === 'gnss')        return 0.026;
    return Math.max(0.010, Math.min((d.alt_km || 400) / EARTH_RADIUS_KM, 0.065));
  }

  _pointColor(d) {
    if (d.id === this._selectedId)  return '#ffffff';
    if (d._type === 'flight')       return '#f0ff00';
    if (d.group === 'stations')     return '#ff0055';
    if (d.group === 'gnss')         return '#f0ff00';
    return d.color || '#00ddf0';
  }

  _pointRadius(d) {
    if (d.id === this._selectedId)  return 0.78;
    if (d._type === 'flight')       return 0.14;
    if (d.group === 'stations')     return 0.50;
    if (d.group === 'gnss')         return 0.18;
    return 0.22;
  }

  _pointLabel(d) {
    if (!this._filters.labels) return '';
    if (d._type === 'flight') {
      return `<div style="font:10px 'Share Tech Mono',mono;color:#f0ff00;background:rgba(1,4,14,.88);padding:2px 6px;border:1px solid #f0ff00;clip-path: polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px);">${d.callsign || d.icao24}</div>`;
    }
    if (d.group === 'stations') {
      return `<div style="font:10px 'Share Tech Mono',mono;color:#ff0055;background:rgba(14,8,1,.88);padding:2px 6px;border:1px solid #ff0055;clip-path: polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px);">${d.name}</div>`;
    }
    return '';
  }

  // ═══════════════════════════════════════════════════════════
  // DATA  UPDATES
  // ═══════════════════════════════════════════════════════════

  update(satellites) {
    if (!this._globe) return;
    this._satellites = satellites;
    this._applyFilters();
    const el = document.getElementById('globe-sat-tally');
    if (el) el.textContent = `${satellites.length} SAT`;
  }

  updateFlights(flights) {
    if (!this._globe) return;
    this._flights = flights || [];
    this._applyFilters();
  }

  updateShips(ships) {
    this._ships = ships || [];
  }

  _applyFilters() {
    if (!this._globe) return;
    let pts = [];

    if (this._filters.satellites) {
      let sats = [...this._satellites];
      if (!this._filters.stations) sats = sats.filter(s => s.group !== 'stations');
      if (!this._filters.gnss)     sats = sats.filter(s => s.group !== 'gnss');
      pts = [...pts, ...sats];
    }

    if (this._filters.flights) {
      const air = this._flights
        .filter(f => !f.on_ground && f.lat && f.lon)
        .slice(0, 150)
        .map(f => ({
          ...f, _type: 'flight',
          alt_km: (f.altitude_baro || 10000) / 1000,
          color: '#ffb300',
          group: 'flight',
          name:  f.callsign || f.icao24,
        }));
      pts = [...pts, ...air];
    }

    // ──────────────────────────────────────────────────────────
    // C2 AI FILTERS

    if (this._filters.anomaly) {
      pts = pts.map(p => {
        const hash = String(p.id || p.icao24 || p.name || '0').charCodeAt(0);
        // Flag deterministic anomalies
        const isAnom = (p.alt_km > 20000 && p.group !== 'gnss') || hash % 17 === 0;
        return {
          ...p,
          color: isAnom ? '#ff0033' : 'rgba(0, 150, 255, 0.05)',
          name: isAnom ? `[ANOMALY] ${p.name || ''}` : p.name
        };
      });
    }

    if (this._filters.heatmaps) {
      this._globe.hexBinPointsData(pts)
        .hexBinPointWeight(() => 1)
        .hexBinPointLat(d => d.lat)
        .hexBinPointLng(d => d.lon)
        .hexBinResolution(3)
        .hexAltitude(d => Math.min(0.6, d.sumWeight * 0.012))
        .hexTopColor(d => `rgba(255, ${Math.max(0, 100 - d.sumWeight*8)}, 0, ${Math.min(0.9, d.sumWeight * 0.15)})`)
        .hexSideColor(d => `rgba(255, 20, 0, ${Math.min(0.8, d.sumWeight * 0.05)})`)
        .hexTransitionDuration(500);
    } else {
      this._globe.hexBinPointsData([]);
    }

    if (this._filters.isll && this._filters.satellites) {
      // Create a visual optical mesh network between Starlinks
      const starlinks = this._satellites.filter(s => s.name?.includes('STARLINK'));
      const arcs = [];
      const len = Math.min(starlinks.length, 300);
      for (let i = 0; i < len - 2; i += Math.floor(Math.random() * 3) + 1) {
        arcs.push({
          startLat: starlinks[i].lat, startLng: starlinks[i].lon,
          endLat: starlinks[i+1].lat, endLng: starlinks[i+1].lon
        });
      }
      this._globe.arcsData(arcs)
        .arcColor(() => 'rgba(0, 255, 136, 0.45)')
        .arcDashLength(0.4)
        .arcDashGap(0.2)
        .arcDashInitialGap(() => Math.random() * 2)
        .arcDashAnimateTime(1500)
        .arcAltitudeAutoScale(0.2);
    } else {
      this._globe.arcsData([]);
    }
    // ──────────────────────────────────────────────────────────

    this._globe
      .pointsData(pts)
      .pointLabel(d => this._pointLabel(d));

    if (this._selectedSat && this._selectedSat.lat && this._selectedSat.lon) {
      this._globe.htmlElementsData([this._selectedSat])
        .htmlElement(d => {
          const el = document.createElement('div');
          el.innerHTML = `
            <div style="position:relative; width:48px; height:48px; transform:translate(-50%,-50%); pointer-events:none;">
              <div style="position:absolute; top:0; left:0; width:12px; height:12px; border:2px solid #00ff88; border-right:none; border-bottom:none;"></div>
              <div style="position:absolute; top:0; right:0; width:12px; height:12px; border:2px solid #00ff88; border-left:none; border-bottom:none;"></div>
              <div style="position:absolute; bottom:0; left:0; width:12px; height:12px; border:2px solid #00ff88; border-right:none; border-top:none;"></div>
              <div style="position:absolute; bottom:0; right:0; width:12px; height:12px; border:2px solid #00ff88; border-left:none; border-top:none;"></div>
              <div style="position:absolute; top:50%; left:50%; width:2px; height:2px; background:#00ff88; transform:translate(-50%,-50%);"></div>
              <div style="position:absolute; bottom:-18px; width:120px; left:-36px; text-align:center; font:10px 'Share Tech Mono',mono; color:#00ff88; padding:2px; background:rgba(0,10,20,0.6); border:1px solid rgba(0,255,136,0.3);">TRK // ${d.name}</div>
            </div>
          `;
          return el;
        })
        .htmlLat(d => d.lat)
        .htmlLng(d => d.lon)
        .htmlAltitude(d => this._altRatio(d.alt_km || 400));
    } else {
      this._globe.htmlElementsData([]);
    }

    if (this._terminatorMesh) {
      this._terminatorMesh.visible = this._filters.terminator;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // INTERACTION
  // ═══════════════════════════════════════════════════════════

  focusSatellite(sat) {
    this._selectedId  = sat.id;
    this._selectedSat = sat;
    this._rotating    = false;
    document.getElementById('gf-rotate')?.classList.remove('active');

    this._globe.pointOfView({ lat: sat.lat, lng: sat.lon, altitude: 0.4 }, 1600);
    this._drawOrbitTrail(sat);
    this._drawOrbitalRing(sat);
    this._drawCoverageCone(sat);
    this._applyFilters();

    const zl = document.getElementById('globe-zoom-level');
    if (zl) zl.textContent = `⊕ ${sat.name || sat.id}`;

    NemesisUI.log(`TRACKING: ${sat.name}  ·  NORAD ${sat.id}  ·  ALT ${(sat.alt_km || 0).toFixed(0)} km`, 'ok');
  }

  focusLocation(lat, lon, altitude = 0.08) {
    this._rotating = false;
    this._globe.pointOfView({ lat, lng: lon, altitude }, 2000);
    NemesisUI.log(`Camera → ${lat.toFixed(3)}°, ${lon.toFixed(3)}°`);
  }

  resetView() {
    this._selectedId  = null;
    this._selectedSat = null;
    this._rotating    = true;
    this._lockOn      = false;
    this._measureStart = null;
    document.getElementById('gf-rotate')?.classList.add('active');
    document.getElementById('gf-lockon')?.classList.remove('active');

    this._globe.pointOfView({ lat: 20, lng: 10, altitude: 2.4 }, 1400);
    this._globe.pathsData([]);
    this._drawOrbitalRing(null);
    this._removeCoverageCone();
    this._applyFilters();

    const zl = document.getElementById('globe-zoom-level');
    if (zl) zl.textContent = 'ORBITAL';
    NemesisUI.log('Camera reset — orbital view');
  }

  _onGlobeClick(coords) {
    if (!coords) return;
    // Dismiss entity inspector card when clicking empty space
    document.getElementById('entity-inspector')?.remove();
    if (this._measureStart) {
      const [lat1, lon1] = this._measureStart;
      const dist = this._haversine(lat1, lon1, coords.lat, coords.lng);
      NemesisUI.log(`📏 Distance: ${dist.toFixed(0)} km  (${(dist * 0.539957).toFixed(0)} NM)`, 'ok');
      this._globe.pathsData([{
        points: [[lat1, lon1, 0.002], [coords.lat, coords.lng, 0.002]],
        color:  ['rgba(255,220,0,0.3)', 'rgba(255,220,0,0.9)'],
      }]);
      this._measureStart = null;
    }
  }

  _onSatHover(sat) {
    const tip = document.getElementById('sat-tooltip');
    if (!sat || !tip) { if (tip) tip.style.display = 'none'; return; }

    const col = sat.group === 'stations' ? '#ff0055'
              : sat.group === 'gnss'     ? '#f0ff00'
              : (sat.color || '#00f3ff');

    tip.style.display = 'block';
    tip.innerHTML = `
      <div style="color:${col};font-weight:700;font-size:10px;letter-spacing:.15em;margin-bottom:8px;text-shadow:0 0 10px ${col}">
        ${sat._type === 'flight' ? '✈' : '🛰'} ${sat.name || sat.callsign || sat.icao24 || '—'}
      </div>
      <table style="width:100%;font-size:9px;border-collapse:collapse">
        ${sat._type === 'flight' ? `
          <tr><td style="color:rgba(255,200,100,.5)">ICAO24</td><td style="color:${col};text-align:right">${sat.icao24 || '—'}</td></tr>
          <tr><td style="color:rgba(255,200,100,.5)">ALT</td><td style="color:${col};text-align:right">FL${Math.round((sat.altitude_baro||0)*0.00328*10)/10} · ${Math.round((sat.altitude_baro||0))}m</td></tr>
          <tr><td style="color:rgba(255,200,100,.5)">SPEED</td><td style="color:${col};text-align:right">${Math.round((sat.velocity||0)*1.944)} kt</td></tr>
          <tr><td style="color:rgba(255,200,100,.5)">HDG</td><td style="color:${col};text-align:right">${(sat.true_track||0).toFixed(0)}°</td></tr>
        ` : `
          <tr><td style="color:rgba(0,200,220,.5)">NORAD</td><td style="color:${col};text-align:right">${sat.id}</td></tr>
          <tr><td style="color:rgba(0,200,220,.5)">ALT</td><td style="color:${col};text-align:right">${(sat.alt_km||0).toFixed(1)} km</td></tr>
          <tr><td style="color:rgba(0,200,220,.5)">GROUP</td><td style="color:${col};text-align:right">${(sat.group||'').toUpperCase()}</td></tr>
        `}
        <tr><td style="color:rgba(150,200,200,.4)">LAT/LON</td>
            <td style="color:#999;text-align:right">${(sat.lat||0).toFixed(2)}° / ${(sat.lon||0).toFixed(2)}°</td></tr>
      </table>
    `;
  }

  _onSatClick(sat) {
    if (!sat) return;
    this.focusSatellite(sat);
    if (typeof NemesisUI.updateSelectedSat === 'function') NemesisUI.updateSelectedSat(sat);
    if (typeof window.__nemesisSatClick    === 'function') window.__nemesisSatClick(sat);
    this._showEntityCard(sat);
    // Draw connection arcs to nearest ground stations
    if (sat._type !== 'flight') {
      this._drawConnectionArcs(sat);
    }
  }

  _showEntityCard(sat) {
    // Remove existing card
    document.getElementById('entity-inspector')?.remove();
    if (!sat) return;

    const isFlight = sat._type === 'flight';
    const name = isFlight ? (sat.callsign || sat.icao24 || 'UNKNOWN') : (sat.name || `NORAD ${sat.id}`);
    const statusColor = isFlight ? '#D1980B' : '#238551';
    const statusText  = isFlight ? 'TRACKED' : (sat.group || 'satellite').toUpperCase();
    const accentColor = isFlight ? '#D1980B' : '#2D72D2';

    const card = document.createElement('div');
    card.id = 'entity-inspector';
    card.style.cssText = `
      position:absolute; top:16px; right:16px; width:260px; z-index:500;
      background:rgba(28,33,39,0.94); backdrop-filter:blur(20px);
      border:1px solid rgba(255,255,255,0.06); border-top:2px solid ${accentColor};
      border-radius:2px; padding:0; overflow:hidden;
      box-shadow:0 8px 32px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03) inset;
      font-family:Inter,system-ui,sans-serif; animation:entitySlideIn 0.25s ease-out;
    `;

    const telemetry = isFlight ? `
      <div class="ei-row"><span class="ei-lbl">ICAO24</span><span class="ei-val">${sat.icao24 || '—'}</span></div>
      <div class="ei-row"><span class="ei-lbl">ALTITUDE</span><span class="ei-val">FL${Math.round((sat.altitude_baro || 0) / 100)}</span></div>
      <div class="ei-row"><span class="ei-lbl">SPEED</span><span class="ei-val">${Math.round((sat.velocity || 0) * 1.944)} kt</span></div>
      <div class="ei-row"><span class="ei-lbl">HEADING</span><span class="ei-val">${(sat.true_track || 0).toFixed(0)}°</span></div>
    ` : `
      <div class="ei-row"><span class="ei-lbl">NORAD ID</span><span class="ei-val">${sat.id || '—'}</span></div>
      <div class="ei-row"><span class="ei-lbl">ALTITUDE</span><span class="ei-val">${(sat.alt_km || 0).toFixed(1)} km</span></div>
      <div class="ei-row"><span class="ei-lbl">GROUP</span><span class="ei-val">${(sat.group || '—').toUpperCase()}</span></div>
    `;

    card.innerHTML = `
      <style>
        @keyframes entitySlideIn { from{transform:translateY(-8px);opacity:0;} to{transform:translateY(0);opacity:1;} }
        .ei-header { padding:12px 14px 10px; border-bottom:1px solid rgba(255,255,255,0.04); }
        .ei-name { font-size:13px; font-weight:600; color:#F6F7F9; letter-spacing:0.03em; margin-bottom:4px; }
        .ei-pill { display:inline-block; padding:2px 8px; font-size:9px; font-weight:500; letter-spacing:0.1em;
                   border-radius:2px; background:${statusColor}22; color:${statusColor}; border:1px solid ${statusColor}44; }
        .ei-body { padding:10px 14px; }
        .ei-row { display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.02); }
        .ei-lbl { font-size:10px; color:#5F6B7C; letter-spacing:0.06em; }
        .ei-val { font-family:'JetBrains Mono',monospace; font-size:11px; color:#ABB3BF; }
        .ei-coords { padding:6px 14px 10px; font-family:'JetBrains Mono',monospace; font-size:10px; color:#5F6B7C; }
        .ei-actions { display:flex; gap:0; border-top:1px solid rgba(255,255,255,0.04); }
        .ei-btn { flex:1; padding:8px; text-align:center; font-size:10px; font-weight:500; cursor:pointer;
                  background:transparent; border:none; border-right:1px solid rgba(255,255,255,0.04);
                  color:#ABB3BF; font-family:Inter,sans-serif; letter-spacing:0.04em; transition:background 0.15s; }
        .ei-btn:hover { background:rgba(45,114,210,0.08); color:#F6F7F9; }
        .ei-btn:last-child { border-right:none; }
        .ei-close { position:absolute; top:8px; right:10px; background:none; border:none;
                    color:#5F6B7C; font-size:14px; cursor:pointer; padding:4px; line-height:1; }
        .ei-close:hover { color:#F6F7F9; }
      </style>
      <button class="ei-close" id="ei-close-btn">✕</button>
      <div class="ei-header">
        <div class="ei-name">${isFlight ? '✈' : '🛰'} ${name.trim()}</div>
        <span class="ei-pill">${statusText}</span>
      </div>
      <div class="ei-body">${telemetry}</div>
      <div class="ei-coords">${(sat.lat || 0).toFixed(4)}° N / ${(sat.lon || 0).toFixed(4)}° E</div>
      <div class="ei-actions">
        <button class="ei-btn" id="ei-focus">FOCUS</button>
        ${isFlight ? '<button class="ei-btn" id="ei-track">TRACK</button>' : '<button class="ei-btn" id="ei-predict">PREDICT</button>'}
        <button class="ei-btn" id="ei-dismiss">DISMISS</button>
      </div>
    `;

    const container = document.getElementById('globe-container');
    if (container) container.appendChild(card);

    // Wire actions
    document.getElementById('ei-close-btn')?.addEventListener('click', () => { card.remove(); this._clearOrbitArc(); this._clearConnectionArcs(); });
    document.getElementById('ei-dismiss')?.addEventListener('click', () => { card.remove(); this._clearOrbitArc(); this._clearConnectionArcs(); });
    document.getElementById('ei-focus')?.addEventListener('click', () => {
      if (sat.lat && sat.lon) this.focusLocation(sat.lat, sat.lon, 0.08);
    });
    document.getElementById('ei-track')?.addEventListener('click', () => {
      NemesisUI.log(`TRACKING: ${name.trim()} — continuous lock engaged`, 'ok');
    });
    document.getElementById('ei-predict')?.addEventListener('click', () => {
      this._renderOrbitPrediction(sat);
      NemesisUI.log(`ORBIT PREDICTION: ${name.trim()} — rendering 45min ground track`, 'ok');
    });
  }

  _onDoubleClick(e) {
    const rect   = e.target.getBoundingClientRect();
    const coords = this._globe.toGlobeCoords(e.clientX - rect.left, e.clientY - rect.top);
    if (!coords) return;
    this._rotating = false;
    const cur    = this._globe.pointOfView().altitude;
    const target = cur > 1.5 ? 0.8 : cur > 0.4 ? 0.15 : cur > 0.06 ? 0.025 : 2.4;
    this._globe.pointOfView({ lat: coords.lat, lng: coords.lng, altitude: target }, 1800);
    if (target === 2.4) {
      this._rotating = true;
      document.getElementById('gf-rotate')?.classList.add('active');
    }
    const zl = document.getElementById('globe-zoom-level');
    if (zl && !this._selectedSat) {
      zl.textContent = target < 0.1 ? 'LOCAL' : target < 0.5 ? 'REGIONAL' : 'ORBITAL';
    }
  }

  _onKeyDown(e) {
    if (document.activeElement?.tagName === 'INPUT') return;
    switch (e.key) {
      case 'Escape':
        this.resetView();
        if (typeof window.__nemesisSatReset === 'function') window.__nemesisSatReset();
        break;
      case 'r': case 'R':
        this._rotating = !this._rotating;
        document.getElementById('gf-rotate')?.classList.toggle('active', this._rotating);
        NemesisUI.log(`Rotation: ${this._rotating ? 'ON' : 'OFF'}`);
        break;
      case 'l': case 'L':
        this._lockOn = !this._lockOn;
        document.getElementById('gf-lockon')?.classList.toggle('active', this._lockOn);
        NemesisUI.log(`Lock-on: ${this._lockOn ? 'TRACKING' : 'OFF'}`);
        break;
      case 't': case 'T':
        this._filters.terminator = !this._filters.terminator;
        document.getElementById('gf-terminator')?.classList.toggle('active', this._filters.terminator);
        this._updateTerminator();
        NemesisUI.log(`Terminator: ${this._filters.terminator ? 'ON' : 'OFF'}`);
        break;
      case 'f':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); this._toggleSearchBar(); }
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ANIMATION LOOP
  // ═══════════════════════════════════════════════════════════

  _startAnimationLoop() {
    const tick = () => {
      if (this._globe) {
        if (this._rotating) {
          const pov = this._globe.pointOfView();
          this._globe.pointOfView({ ...pov, lng: pov.lng + AUTO_ROTATE_SPEED });
        }
        if (this._lockOn && this._selectedSat) {
          // Find latest position for this satellite
          const live = this._satellites.find(s => s.id === this._selectedSat.id);
          const sat  = live || this._selectedSat;
          this._globe.pointOfView({ lat: sat.lat, lng: sat.lon, altitude: this._lockOnAlt });
          if (live) this._selectedSat = live;
        }
        // Update zoom label
        if (!this._selectedSat && !this._lockOn) {
          const a  = this._globe.pointOfView().altitude;
          const lv = a < 0.15 ? 'LOCAL' : a < 0.7 ? 'REGIONAL' : 'ORBITAL';
          const el = document.getElementById('globe-zoom-level');
          if (el && el.textContent !== lv) el.textContent = lv;
        }
      }
      this._frameId = requestAnimationFrame(tick);
    };
    this._frameId = requestAnimationFrame(tick);
  }

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════

  _applyOceanShader() {
    try {
      this._globe.scene().traverse(obj => {
        if (obj.isMesh && obj.geometry?.parameters?.radius && obj.material?.map) {
          obj.material.emissive          = new THREE.Color(0x000d1a);
          obj.material.emissiveIntensity = 0.18;
          obj.material.needsUpdate       = true;
        }
      });
    } catch (e) {}
  }

  _haversine(lat1, lon1, lat2, lon2) {
    const R   = 6371;
    const d2r = Math.PI / 180;
    const dL  = (lat2 - lat1) * d2r;
    const dG  = (lon2 - lon1) * d2r;
    const a   = Math.sin(dL/2)**2 + Math.cos(lat1*d2r) * Math.cos(lat2*d2r) * Math.sin(dG/2)**2;
    return R * 2 * Math.asin(Math.sqrt(a));
  }

  _altRatio(alt_km) { return Math.max(0.01, Math.min((alt_km || 400) / EARTH_RADIUS_KM, 0.40)); }

  stopRotation()  { this._rotating = false; document.getElementById('gf-rotate')?.classList.remove('active'); }
  startRotation() { this._rotating = true;  document.getElementById('gf-rotate')?.classList.add('active');    }
  get _globeInstance() { return this._globe; }

  // ═══════════════════════════════════════════════════════════
  // PHASE 3: ORBIT PREDICTION ARC
  // ═══════════════════════════════════════════════════════════

  _renderOrbitPrediction(sat) {
    if (!this._globe || !sat) return;
    this._clearOrbitArc();

    const lat = sat.lat || 0;
    const lon = sat.lon || 0;
    const altKm = sat.alt_km || 400;
    const vel = sat.velocity_km_s || 7.66; // Default LEO velocity

    // Calculate orbital period approximation
    const R = 6371 + altKm;
    const orbitalPeriodMin = 2 * Math.PI * Math.sqrt(Math.pow(R, 3) / 398600) / 60;
    const degreesPerMinute = 360 / orbitalPeriodMin;

    // Generate ground track points for ~45 minutes
    const points = [];
    const steps = 90;
    const inclination = sat.inclination || 51.6; // Default ISS-like inclination

    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * 45; // minutes
      const angularTravel = degreesPerMinute * t;
      
      // Simplified ground track using great circle approximation
      const heading = sat.true_track || 0; // heading in degrees
      const d = angularTravel * Math.PI / 180; // angular distance in radians
      const lat1 = lat * Math.PI / 180;
      const lon1 = lon * Math.PI / 180;
      const brng = (heading || 45) * Math.PI / 180;

      const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
      );
      const lon2 = lon1 + Math.atan2(
        Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
        Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
      );

      // Earth rotation compensation: ~0.25° per minute
      const earthRotation = t * 0.25;
      
      points.push({
        lat: lat2 * 180 / Math.PI,
        lng: (lon2 * 180 / Math.PI) - earthRotation,
        alt: altKm / EARTH_RADIUS_KM,
      });
    }

    // Render using globe.gl pathsData
    this._orbitArcData = [{
      points,
      color: ['rgba(72,175,240,0.8)', 'rgba(45,114,210,0.1)'],
    }];

    this._globe
      .pathsData(this._orbitArcData)
      .pathPoints('points')
      .pathPointLat(p => p.lat)
      .pathPointLng(p => p.lng)
      .pathPointAlt(p => p.alt)
      .pathColor(d => d.color)
      .pathStroke(2)
      .pathDashLength(0.01)
      .pathDashGap(0.008)
      .pathDashAnimateTime(4000);

    // Also render ground track shadow (on surface)
    const groundTrack = points.map(p => ({
      lat: p.lat,
      lng: p.lng,
    }));

    // Add predicted position markers at 15-min intervals
    const markers = [];
    [15, 30, 45].forEach(min => {
      const idx = Math.round((min / 45) * steps);
      if (idx < points.length) {
        const p = points[idx];
        markers.push({
          lat: p.lat,
          lng: p.lng,
          alt: p.alt,
          label: `T+${min}m`,
        });
      }
    });

    // Store markers for cleanup
    this._orbitMarkers = markers;

    // Render markers as custom labels
    if (this._globe.labelsData) {
      const existingLabels = this._globe.labelsData() || [];
      this._globe
        .labelsData([...existingLabels, ...markers.map(m => ({
          lat: m.lat,
          lng: m.lng,
          alt: m.alt,
          text: m.label,
          color: '#48AFF0',
          size: 0.4,
          _isOrbitMarker: true,
        }))])
        .labelText(d => d.text || '')
        .labelSize(d => d.size || 0.5)
        .labelColor(d => d.color || '#fff')
        .labelDotRadius(d => d._isOrbitMarker ? 0.15 : 0)
        .labelAltitude(d => d.alt || 0.01);
    }
  }

  _clearOrbitArc() {
    if (this._globe) {
      this._globe.pathsData([]);
      // Remove orbit marker labels
      if (this._globe.labelsData) {
        const labels = (this._globe.labelsData() || []).filter(l => !l._isOrbitMarker);
        this._globe.labelsData(labels);
      }
    }
    this._orbitArcData = null;
    this._orbitMarkers = null;
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 4: CONNECTION ARCS (SATELLITE ↔ GROUND STATIONS)
  // ═══════════════════════════════════════════════════════════

  _drawConnectionArcs(sat) {
    if (!this._globe || !sat || !sat.lat || !sat.lon) return;
    this._clearConnectionArcs();

    const hubs = this._geoHubsData || [];
    if (!hubs.length) return;

    // Find 3 nearest ground stations
    const withDist = hubs.map(h => ({
      ...h,
      dist: this._haversine(sat.lat, sat.lon, h.lat, h.lon),
    })).sort((a, b) => a.dist - b.dist).slice(0, 3);

    const arcAlt = sat.alt_km ? Math.min(sat.alt_km / EARTH_RADIUS_KM * 0.5, 0.15) : 0.06;

    this._connectionArcs = withDist.map(hub => ({
      startLat: sat.lat,
      startLng: sat.lon,
      endLat: hub.lat,
      endLng: hub.lon,
      color: ['rgba(72,175,240,0.7)', 'rgba(45,114,210,0.15)'],
      label: `${hub.name} — ${Math.round(hub.dist)} km`,
      arcAlt,
    }));

    this._globe
      .arcsData(this._connectionArcs)
      .arcStartLat(d => d.startLat)
      .arcStartLng(d => d.startLng)
      .arcEndLat(d => d.endLat)
      .arcEndLng(d => d.endLng)
      .arcColor(d => d.color)
      .arcAltitude(d => d.arcAlt)
      .arcStroke(0.6)
      .arcDashLength(0.4)
      .arcDashGap(0.15)
      .arcDashAnimateTime(2000)
      .arcLabel(d => `<div style="font-family:var(--font-mono);font-size:10px;color:#48AFF0;background:rgba(17,20,24,0.9);padding:4px 8px;border:1px solid rgba(45,114,210,0.2);">${d.label}</div>`);
  }

  _clearConnectionArcs() {
    if (this._globe) {
      this._globe.arcsData([]);
    }
    this._connectionArcs = null;
  }
}
