/**
 * Nemesis Interpolator — Dead Reckoning Engine
 * Smoothly animates objects between telemetry updates.
 * 
 * Satellites: move using orbital mechanics (longitude drift 
 *             based on orbital period derived from altitude)
 * Flights:    move using heading + speed (great circle)
 * Ships:      move using heading + speed (slow, barely moves)
 */

export class NemesisInterpolator {

  constructor() {
    this._satellites  = new Map();  // id → { data, lastUpdate }
    this._flights     = new Map();  // icao24 → { data, lastUpdate }
    this._ships       = new Map();  // mmsi → { data, lastUpdate }
    this._frame       = null;
    this._callbacks   = [];
    this._lastTick    = performance.now();
    this._running     = false;
  }

  // ── Start the interpolation loop ─────────────────────────
  start() {
    if (this._running) return;
    this._running = true;
    const tick = (now) => {
      if (!this._running) return;
      const dt = Math.min((now - this._lastTick) / 1000, 0.5); // delta seconds, capped at 0.5s
      this._lastTick = now;
      this._tick(dt);
      this._frame = requestAnimationFrame(tick);
    };
    this._frame = requestAnimationFrame(tick);
  }

  stop() {
    this._running = false;
    if (this._frame) cancelAnimationFrame(this._frame);
  }

  // ── Register a callback for interpolated data ────────────
  // Called every frame with fresh predicted positions
  onUpdate(cb) {
    this._callbacks.push(cb);
  }

  // ── Ingest real telemetry data ───────────────────────────
  ingestSatellites(sats) {
    const now = performance.now();
    sats.forEach(sat => {
      const existing = this._satellites.get(sat.id);
      this._satellites.set(sat.id, {
        data:       { ...sat },
        lastUpdate: now,
        // Compute angular velocity from altitude
        // Orbital period T = 2π√(r³/GM), GM=3.986e14
        // For simplicity: LEO~90min→0.067°/s, GEO~0.004°/s
        degPerSec: this._satDegPerSec(sat.alt_km),
        prevLat:   existing?.data.lat ?? sat.lat,
        prevLon:   existing?.data.lon ?? sat.lon,
      });
    });
    // Remove stale satellites
    const ids = new Set(sats.map(s => s.id));
    this._satellites.forEach((_, id) => {
      if (!ids.has(id)) this._satellites.delete(id);
    });
  }

  ingestFlights(flights) {
    const now = performance.now();
    flights.forEach(f => {
      const id = f.icao24 || f.callsign;
      if (!id) return;
      this._flights.set(id, {
        data:       { ...f },
        lastUpdate: now,
      });
    });
    const ids = new Set(flights.map(f => f.icao24 || f.callsign).filter(Boolean));
    this._flights.forEach((_, id) => {
      if (!ids.has(id)) this._flights.delete(id);
    });
  }

  ingestShips(ships) {
    const now = performance.now();
    ships.forEach((s, idx) => {
      const id = s.mmsi || s.name || `ship-${idx}`;
      this._ships.set(id, {
        data:       { ...s },
        lastUpdate: now,
      });
    });
    const ids = new Set(ships.map((s, idx) => s.mmsi || s.name || `ship-${idx}`));
    this._ships.forEach((_, id) => {
      if (!ids.has(id)) this._ships.delete(id);
    });
  }

  // ── Main interpolation tick ───────────────────────────────
  _tick(dt) {
    const sats    = this._interpolateSatellites(dt);
    const flights = this._interpolateFlights(dt);
    const ships   = this._interpolateShips(dt);

    this._callbacks.forEach(cb => cb({ sats, flights, ships }));
  }

  _interpolateSatellites(dt) {
    const result = [];
    this._satellites.forEach((entry) => {
      const sat = entry.data;

      // Advance longitude based on orbital angular velocity
      // Satellites move west→east (prograde) so lon increases
      // We also apply slight inclination-based lat wobble
      const dLon = entry.degPerSec * dt;
      sat.lon = ((sat.lon + dLon + 180) % 360) - 180;

      // Slight latitude oscillation based on inclination
      // (simplified — real inclination needs TLE but this looks great)
      const incFactor = Math.sin(
        ((performance.now() / 1000) * entry.degPerSec * 0.8) * Math.PI / 180
      );
      const latAmplitude = Math.min(Math.abs(sat.lat), 15);
      sat.lat = sat.lat + Math.sign(sat.lat) * incFactor * latAmplitude * 0.001 * dt;
      sat.lat = Math.max(-89, Math.min(89, sat.lat));

      result.push({ ...sat });
    });
    return result;
  }

  _interpolateFlights(dt) {
    const result = [];
    this._flights.forEach((entry) => {
      const f = entry.data;
      if (f.on_ground || !f.lat || !f.lon) {
        result.push({ ...f });
        return;
      }

      // Dead reckoning: speed in m/s → km/s → degrees/s
      const speedMs    = f.velocity || 250;       // m/s
      const speedKmS   = speedMs / 1000;
      const distKm     = speedKmS * dt;           // km travelled this frame
      const headingRad = ((f.heading || 0) - 90) * Math.PI / 180;

      // Approximate: 1 degree lat ≈ 111 km
      const dLat = (distKm / 111) * Math.sin((f.heading || 0) * Math.PI / 180);
      const dLon = (distKm / (111 * Math.cos(f.lat * Math.PI / 180)))
                   * Math.cos((f.heading || 0) * Math.PI / 180);

      f.lat = Math.max(-90, Math.min(90, f.lat + dLat));
      f.lon = ((f.lon + dLon + 180) % 360) - 180;

      result.push({ ...f });
    });
    return result;
  }

  _interpolateShips(dt) {
    const result = [];
    this._ships.forEach((entry) => {
      const s = entry.data;
      if (!s.lat || !s.lon) { result.push({ ...s }); return; }

      const speedKts  = s.speed_knots || s.speed || 0;
      const speedKmS  = speedKts * 0.000514;    // knots → km/s
      const distKm    = speedKmS * dt;
      const heading   = s.heading || 0;

      const dLat = (distKm / 111) * Math.cos(heading * Math.PI / 180);
      const dLon = (distKm / (111 * Math.cos(s.lat * Math.PI / 180)))
                   * Math.sin(heading * Math.PI / 180);

      s.lat = Math.max(-90, Math.min(90, s.lat + dLat));
      s.lon = ((s.lon + dLon + 180) % 360) - 180;

      result.push({ ...s });
    });
    return result;
  }

  // ── Orbital mechanics ─────────────────────────────────────
  _satDegPerSec(altKm) {
    // T = 2π√((R+h)³/GM)
    // R = 6371km, GM = 3.986e5 km³/s²
    const R  = 6371;
    const GM = 3.986e5;
    const r  = R + (altKm || 400);
    const T  = 2 * Math.PI * Math.sqrt(r * r * r / GM);  // seconds
    // Earth rotates 360°/86400s, satellite completes orbit in T seconds
    // Apparent ground track speed = 360/T - 360/86400 (subtract Earth rotation)
    const orbitalDegPerSec = 360 / T;
    const earthDegPerSec   = 360 / 86400;
    return orbitalDegPerSec - earthDegPerSec;
  }
}