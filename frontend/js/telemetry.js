/**
 * Project Nemesis — Telemetry Module (telemetry.js)
 * ====================================================
 * Manages all communication with the Nemesis backend.
 */

import { NemesisUI } from './ui.js';

const BASE_HTTP = 'http://localhost:8000';
const BASE_WS   = 'ws://localhost:8000';

const RECONNECT_INITIAL_MS = 2000;
const RECONNECT_MAX_MS     = 30_000;
const RECONNECT_FACTOR     = 1.5;
const HEALTH_POLL_MS       = 10_000;

export class NemesisTelemetry {
  constructor() {
    this._wsSat            = null;
    this._wsFlights        = null;
    
    this._satReconnectDelay = RECONNECT_INITIAL_MS;
    this._flightReconnectDelay = RECONNECT_INITIAL_MS;
    
    this._satReconnectTimer = null;
    this._flightReconnectTimer = null;
    
    this._healthTimer      = null;
    this._connectedSat     = false;
    this._connectedFlights = false;
    
    this._satelliteCache   = [];
    this._flightCache      = [];
    
    this._totalUpdates     = 0;
    this._byteCount        = 0;
  }

  async start() {
    NemesisUI.log('Contacting Nemesis backend…');

    try {
      await this._fetchSatSnapshot();
      await this._fetchFlightSnapshot();
    } catch (err) {
      NemesisUI.log(`REST snapshot failed: ${err.message}`, 'warn');
    }

    this._connectSatWebSocket();
    this._connectFlightWebSocket();

    this._healthTimer = setInterval(() => this._fetchHealth(), HEALTH_POLL_MS);
  }

  stop() {
    if (this._wsSat) { this._wsSat.onclose = null; this._wsSat.close(); }
    if (this._wsFlights) { this._wsFlights.onclose = null; this._wsFlights.close(); }
    clearInterval(this._healthTimer);
    clearTimeout(this._satReconnectTimer);
    clearTimeout(this._flightReconnectTimer);
  }

  get satellites() { return this._satelliteCache; }
  get flights() { return this._flightCache; }

  // ─── Satellites WebSocket ──────────────────────────────────────────────────

  _connectSatWebSocket() {
    try {
      this._wsSat = new WebSocket(`${BASE_WS}/ws/telemetry`);
    } catch (err) {
      NemesisUI.log(`Sat WS failed: ${err.message}`, 'error');
      this._scheduleSatReconnect();
      return;
    }

    this._wsSat.addEventListener('open', () => {
      this._connectedSat = true;
      this._satReconnectDelay = RECONNECT_INITIAL_MS;
      NemesisUI.log('Sat WebSocket UPLINK established', 'ok');
      this._updateConnectionStatus();
      NemesisUI.setProgress(100);
    });

    this._wsSat.addEventListener('message', (event) => {
      this._byteCount += event.data.length;
      this._handleSatMessage(event.data);
    });

    this._wsSat.addEventListener('error', () => {
      this._updateConnectionStatus();
    });

    this._wsSat.addEventListener('close', () => {
      this._connectedSat = false;
      this._updateConnectionStatus();
      this._scheduleSatReconnect();
    });
  }

  _scheduleSatReconnect() {
    clearTimeout(this._satReconnectTimer);
    this._satReconnectTimer = setTimeout(() => {
      this._satReconnectDelay = Math.min(this._satReconnectDelay * RECONNECT_FACTOR, RECONNECT_MAX_MS);
      this._connectSatWebSocket();
    }, this._satReconnectDelay);
  }

  // ─── Flights WebSocket ─────────────────────────────────────────────────────

  _connectFlightWebSocket() {
    try {
      this._wsFlights = new WebSocket(`${BASE_WS}/ws/flights`);
    } catch (err) {
      NemesisUI.log(`Flight WS failed: ${err.message}`, 'error');
      this._scheduleFlightReconnect();
      return;
    }

    this._wsFlights.addEventListener('open', () => {
      this._connectedFlights = true;
      this._flightReconnectDelay = RECONNECT_INITIAL_MS;
      NemesisUI.log('Flight WebSocket UPLINK established', 'ok');
      this._updateConnectionStatus();
    });

    this._wsFlights.addEventListener('message', (event) => {
      this._byteCount += event.data.length;
      this._handleFlightMessage(event.data);
    });

    this._wsFlights.addEventListener('error', () => {
      this._updateConnectionStatus();
    });

    this._wsFlights.addEventListener('close', () => {
      this._connectedFlights = false;
      this._updateConnectionStatus();
      this._scheduleFlightReconnect();
    });
  }

  _scheduleFlightReconnect() {
    clearTimeout(this._flightReconnectTimer);
    this._flightReconnectTimer = setTimeout(() => {
      this._flightReconnectDelay = Math.min(this._flightReconnectDelay * RECONNECT_FACTOR, RECONNECT_MAX_MS);
      this._connectFlightWebSocket();
    }, this._flightReconnectDelay);
  }

  _updateConnectionStatus() {
    if (this._connectedSat && this._connectedFlights) {
      NemesisUI.setConnectionStatus('ONLINE');
    } else if (this._connectedSat || this._connectedFlights) {
      NemesisUI.setConnectionStatus('PARTIAL');
    } else {
      NemesisUI.setConnectionStatus('RECONNECTING');
    }
  }

  // ─── Message Handling ────────────────────────────────────────────────────

  _handleSatMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    
    if (msg.type !== 'SAT_SNAPSHOT' && msg.type !== 'SAT_UPDATE') return;

    this._totalUpdates++;
    this._satelliteCache = msg.satellites;
    
    NemesisUI.updateCounter('sat-count', msg.count);
    NemesisUI.updateCounter('update-count', this._totalUpdates);
    NemesisUI.updateCounter('data-rate', this._formatBytes(this._byteCount));
    NemesisUI.populateSatList(msg.satellites);

    window.dispatchEvent(new CustomEvent('telemetry:update', { detail: { satellites: msg.satellites } }));

    if (msg.type === 'SAT_SNAPSHOT') {
      NemesisUI.dismissOverlay();
    }
  }

  _handleFlightMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    
    if (msg.type !== 'FLIGHT_SNAPSHOT' && msg.type !== 'FLIGHT_UPDATE') return;

    this._totalUpdates++;
    this._flightCache = msg.flights;
    
    NemesisUI.updateCounter('flight-count', msg.count);
    NemesisUI.updateCounter('update-count', this._totalUpdates);
    NemesisUI.updateCounter('data-rate', this._formatBytes(this._byteCount));

    window.dispatchEvent(new CustomEvent('flights:update', { detail: { flights: msg.flights } }));
  }

  // ─── REST Helpers ────────────────────────────────────────────────────────

  async _fetchSatSnapshot() {
    NemesisUI.setProgress(30);
    const response = await fetch(`${BASE_HTTP}/api/satellites/snapshot`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    NemesisUI.setProgress(60);
    window.dispatchEvent(new CustomEvent('telemetry:update', { detail: { satellites: data.satellites } }));
    NemesisUI.updateCounter('sat-count', data.count);
    NemesisUI.populateSatList(data.satellites);
  }

  async _fetchFlightSnapshot() {
    try {
      const response = await fetch(`${BASE_HTTP}/api/flights/snapshot`);
      if (response.ok) {
        const data = await response.json();
        window.dispatchEvent(new CustomEvent('flights:update', { detail: { flights: data.flights } }));
        NemesisUI.updateCounter('flight-count', data.count);
      }
    } catch (e) {
      NemesisUI.log('Flight snapshot not available yet.', 'warn');
    }
  }

  async _fetchHealth() {
    try {
      const response = await fetch(`${BASE_HTTP}/api/health`);
      if (response.ok) {
        const data = await response.json();
        NemesisUI.updateCounter('backend-status', data.status);
      }
    } catch {}
  }

  _formatBytes(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1048576).toFixed(2)}MB`;
  }
}
