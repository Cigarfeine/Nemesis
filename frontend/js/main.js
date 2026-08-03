import { NemesisGlobe }       from './globe.js';
import { NemesisTelemetry }   from './telemetry.js';
import { NemesisUI }          from './ui.js';
import { NemesisVFX }         from './vfx.js';
import { SatelliteProfile }   from './satellite_profile.js';
import { NemesisShips }       from './ships.js';
import { NemesisAlerts }      from './alerts.js';
import { NemesisFlights }     from './flights.js';
import { NemesisKnowledgeGraph } from './knowledge_graph.js';
import { NemesisViews }       from './views.js';
import { NemesisInterpolator } from './interpolator.js';

class NemesisApp {
  constructor() {
    this.globe          = new NemesisGlobe('globe-container');
    this.flights        = new NemesisFlights('globe-container');
    this.knowledgeGraph = new NemesisKnowledgeGraph('knowledge-graph-container');
    this.telemetry      = new NemesisTelemetry();
    this.ships          = new NemesisShips();
    this.alerts         = new NemesisAlerts();
    this.views          = new NemesisViews();
    this.interp         = new NemesisInterpolator();

    // Latest snapshot for the asset table
    this._latestSats    = [];
    this._latestFlights = [];
    this._latestShips   = [];
  }

  async init() {
    NemesisUI.startClock();
    NemesisUI.initTicker();
    NemesisUI.initTooltipTracking();
    await NemesisUI.runBootSequence();

    // Patch views.switchView to also highlight the topbar tab
    const _origSwitch = this.views.switchView.bind(this.views);
    this.views.switchView = (id) => {
      _origSwitch(id);
      document.querySelectorAll('.tb-tab').forEach(t => t.classList.remove('active'));
      const btn = document.getElementById(`tab-${id}`);
      if (btn) btn.classList.add('active');
    };

    try {
      this.globe.init();
      this.flights.init(this.globe);
      this.knowledgeGraph.init(this.globe);
      this.views.init();

      // Expose for cross-component access (context menus, map←→globe)
      window.__nemesisGlobe = this.globe;
      window.__nemesisViews = this.views;

      NemesisUI.addBootLine('Globe v4 — Palantir-grade tactical globe active', 'ok');
      NemesisUI.setProgress(95);
      setTimeout(() => NemesisVFX.init(this.globe), 800);

      // Start dead-reckoning interpolation
      this.interp.start();

      this.interp.onUpdate(({ sats, flights, ships }) => {
        if (sats.length)    this.globe.update(sats);
        if (flights.length) this.globe.updateFlights(flights);
        if (this.views) {
          this.views.updateFlights(flights);
          this.views.updateSatellites(sats);
          this.views.updateShips(ships);
        }
      });

    } catch (err) {
      NemesisUI.addBootLine(`Globe FAILED: ${err.message}`, 'error');
    }

    // ── Satellite telemetry ────────────────────────────────────────────────
    window.addEventListener('telemetry:update', (e) => {
      this._latestSats = e.detail.satellites || [];
      this.interp.ingestSatellites(this._latestSats);

      const count = this._latestSats.length;
      NemesisUI.updateCounter('sat-count', count);
      NemesisUI.updateNavCount('nc-sat-count', count);
      NemesisUI.populateSatList(this._latestSats);
      this._refreshAssetTable();
    });

    // ── Flight telemetry ───────────────────────────────────────────────────
    window.addEventListener('flights:update', (e) => {
      this._latestFlights = e.detail.flights || [];
      this.interp.ingestFlights(this._latestFlights);

      const count = this._latestFlights.length;
      NemesisUI.updateCounter('flight-count', count);
      NemesisUI.updateNavCount('nc-flight-count', count);
      this._refreshAssetTable();
    });

    // ── Ship telemetry ─────────────────────────────────────────────────────
    window.addEventListener('ships:update', (e) => {
      this._latestShips = e.detail.ships || [];
      this.interp.ingestShips(this._latestShips);

      const count = this._latestShips.length;
      NemesisUI.updateNavCount('nc-ship-count', count);
      NemesisUI.updateCounter('ship-count', count);
      this._refreshAssetTable();
    });

    // ── Knowledge graph: update nav count ──────────────────────────────────
    window.addEventListener('graph:update', (e) => {
      const nodeCount = e.detail?.node_count;
      if (nodeCount !== undefined) {
        NemesisUI.updateNavCount('nc-graph-count', nodeCount);
      }
    });

    // ── Knowledge graph location click → globe flyto ──────────────────────
    window.addEventListener('graph:location-click', (e) => {
      this.globe.focusLocation(e.detail.lat, e.detail.lon, 0.15);
    });

    // ── Satellite click → profile + track ─────────────────────────────────
    window.__nemesisFocus = (noradId) => {
      const sat = this.telemetry.satellites.find(s => s.id === noradId);
      if (!sat) return;
      this.globe.focusSatellite(sat);
      NemesisUI.updateSelectedSat(sat);
      SatelliteProfile.show(sat.id, sat.name);
    };

    // ── Space weather nav badge ────────────────────────────────────────────
    window.addEventListener('weather:update', (e) => {
      const level = e.detail?.alert_level || e.detail?.status?.alert_level;
      if (level) NemesisUI.updateNavCount('nc-weather-level', level);
    });

    // ── Keyboard shortcuts ─────────────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.globe.resetView();
        SatelliteProfile.hide();
        NemesisUI.clearSelectedSat && NemesisUI.clearSelectedSat();
        NemesisUI.log('ESC — orbital view restored');
      }
      if (e.key === 'r' || e.key === 'R') {
        this.globe._rotating = !this.globe._rotating;
        NemesisUI.log(`Rotation: ${this.globe._rotating ? 'ON' : 'OFF'}`);
      }
    });

    // ── Start all live services ────────────────────────────────────────────
    await this.telemetry.start();
    this.ships.start(this.globe);
    this.alerts.start();

    NemesisUI.addBootLine('DAEMON LOGOS — All systems nominal', 'ok');
    NemesisUI.setProgress(100);
    NemesisUI.dismissOverlay();
  }

  /** Push latest data to the bottom asset table */
  _refreshAssetTable() {
    NemesisUI.updateAssetTable({
      satellites: this._latestSats,
      flights:    this._latestFlights,
      ships:      this._latestShips,
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new NemesisApp();
  app.init().catch(err => console.error('[NEMESIS FATAL]', err));
});
