/**
 * Project Nemesis — Flights Module (flights.js)
 * ================================================
 * Manages the live OpenSky ADS-B flight layer using deck.gl.
 */

import { NemesisUI } from './ui.js';

export class NemesisFlights {
  constructor(containerId) {
    this._containerId = containerId;
    this._deckgl = null;
    this._flights = [];
    this._flightTrails = {}; // Maps icao24 to array of recent positions
  }

  init(globeInstance) {
    const container = document.getElementById(this._containerId);
    if (!container) throw new Error(`Container #${this._containerId} not found`);

    // Create a container for deck.gl that overlays globe.gl exactly
    const deckContainer = document.createElement('div');
    deckContainer.style.position = 'absolute';
    deckContainer.style.top = '0';
    deckContainer.style.left = '0';
    deckContainer.style.width = '100%';
    deckContainer.style.height = '100%';
    deckContainer.style.pointerEvents = 'none'; // Let clicks pass through to globe.gl
    container.appendChild(deckContainer);

    this._deckgl = new deck.DeckGL({
      container: deckContainer,
      views: new deck._GlobeView(),
      initialViewState: {
        longitude: 0,
        latitude: 20,
        zoom: 0.5 // Will be synced with globe
      },
      controller: false,
      layers: [],
      getTooltip: ({object}) => object && `Callsign: ${object.callsign}\nAltitude: ${Math.round(object.altitude_baro || 0)}m\nVelocity: ${Math.round(object.velocity || 0)}m/s`
    });

    // Hook into the globe's render loop to sync camera
    const syncCamera = () => {
      if (globeInstance && globeInstance._globe) {
        const pov = globeInstance._globe.pointOfView();
        // Convert globe altitude (0.01 - 2.5+) to deck.gl zoom.
        // This mapping requires tweaking, but generally zoom = log2(1/alt) + offset
        const zoom = Math.log2(2.5 / (pov.altitude || 0.001));
        
        this._deckgl.setProps({
          viewState: {
            longitude: pov.lng,
            latitude: pov.lat,
            zoom: Math.max(0, zoom)
          }
        });
      }
      requestAnimationFrame(syncCamera);
    };
    syncCamera();

    NemesisUI.log('Flight tracking (deck.gl overlay): ONLINE', 'ok');
  }

  update(flights) {
    this._flights = flights;

    // Update trails
    const maxTrailLength = 5;
    flights.forEach(f => {
      if (!this._flightTrails[f.icao24]) {
        this._flightTrails[f.icao24] = [];
      }
      const trail = this._flightTrails[f.icao24];
      trail.push([f.lon, f.lat]);
      if (trail.length > maxTrailLength) {
        trail.shift();
      }
    });

    // Clean up old trails
    const currentIcaos = new Set(flights.map(f => f.icao24));
    Object.keys(this._flightTrails).forEach(icao => {
      if (!currentIcaos.has(icao)) {
        delete this._flightTrails[icao];
      }
    });

    this._render();
  }

  _render() {
    if (!this._deckgl) return;

    const flightArcs = [];
    const predictivePaths = [];

    this._flights.forEach(f => {
      // Historical trails
      const trail = this._flightTrails[f.icao24];
      if (trail && trail.length > 1) {
        for (let i = 0; i < trail.length - 1; i++) {
          flightArcs.push({
            source: trail[i],
            target: trail[i+1],
            altitude: f.altitude_baro || 0
          });
        }
      }

      // Predictive trajectory
      if (f.trajectory && f.trajectory.length > 0) {
        const path = [[f.lon, f.lat]];
        f.trajectory.forEach(pt => {
          path.push([pt.lon, pt.lat]);
        });
        predictivePaths.push({
          path: path,
          callsign: f.callsign || f.icao24
        });
      }
    });

    const ICON_MAPPING = {
      marker: { x: 0, y: 0, width: 128, height: 128, mask: true }
    };
    
    // Crisp, filled chevron pointing UP (deck.gl angle 0 points UP)
    const flightIconSvg = `data:image/svg+xml;charset=utf-8,%3Csvg viewBox='0 0 128 128' xmlns='http://www.w3.org/2000/svg'%3E` +
      `%3Cpath d='M64 16 L104 96 L64 76 L24 96 Z' fill='%23ffffff'/%3E` +
      `%3C/svg%3E`;

    const scatterLayer = new deck.IconLayer({
      id: 'flights-scatter',
      data: this._flights,
      pickable: true,
      iconAtlas: flightIconSvg,
      iconMapping: ICON_MAPPING,
      getIcon: d => 'marker',
      sizeScale: 4,
      getPosition: d => [d.lon, d.lat, (d.altitude_baro || 0)],
      getSize: d => 5,
      getColor: d => d.on_ground ? [200, 200, 200, 180] : [255, 179, 0, 255],
      getAngle: d => -(d.heading || 0),
      transitions: {
        getPosition: 1000,
        getAngle: 1000
      },
      onClick: ({object}) => {
        if (object) {
          NemesisUI.triggerCCTV(`AIRCRAFT [${object.callsign || object.icao24}]`);
          NemesisUI.log(`Intercepting feed for flight ${object.callsign || object.icao24}...`, 'warn');
          NemesisUI.triggerTargetLock();
        }
      }
    });

    const textLayer = new deck.TextLayer({
      id: 'flights-labels',
      // Only annotate a manageable subset to reduce visual noise
      data: this._flights.filter(f => !f.on_ground && f.callsign?.trim()).slice(0, 200),
      pickable: false,
      getPosition: d => [d.lon, d.lat, (d.altitude_baro || 0)],
      getText: d => d.callsign.trim(),
      getSize: 9,
      getColor: [0, 200, 220, 180],
      getPixelOffset: [18, 0],
      fontFamily: "'Share Tech Mono', monospace",
      fontWeight: 'normal',
      background: true,
      getBackgroundColor: [1, 4, 14, 200],
      backgroundPadding: [3, 1]
    });

    const arcLayer = new deck.ArcLayer({
      id: 'flights-trails',
      data: flightArcs,
      getSourcePosition: d => d.source,
      getTargetPosition: d => d.target,
      getSourceColor: [255, 179, 0, 50],
      getTargetColor: [255, 179, 0, 150],
      getWidth: 1.5,
      widthUnits: 'pixels'
    });

    const trajectoryLayer = new deck.PathLayer({
      id: 'flights-trajectories',
      data: predictivePaths,
      pickable: false,
      widthScale: 20,
      widthMinPixels: 1,
      getPath: d => d.path,
      getColor: [0, 245, 255, 120], // Cyan
      getWidth: 1,
      getDashArray: [4, 4],
      dashJustified: true,
      extensions: [new deck.PathStyleExtension({dash: true})]
    });

    const existingLayers = this._deckgl.props.layers || [];
    const otherLayers = existingLayers.filter(
      l => !['flights-scatter', 'flights-labels', 'flights-trails', 'flights-trajectories'].includes(l.id)
    );

    this._deckgl.setProps({
      layers: [scatterLayer, textLayer, arcLayer, trajectoryLayer, ...otherLayers]
    });
  }
}
