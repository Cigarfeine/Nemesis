export class NemesisShips {
  constructor() {
    this._ws = null;
    this._ships = [];
    this._reconnectDelay = 2000;
  }

  start(globe) {
    this._globe = globe;
    this._fetchSnapshot();
    this._connectWS();
  }

  _fetchSnapshot() {
    fetch('http://localhost:8000/api/ships/snapshot')
      .then(r => r.json())
      .then(data => {
        this._ships = data.ships || [];
        this._updateGlobe();
        window.dispatchEvent(new CustomEvent('ships:update', { detail: { ships: this._ships } }));
      })
      .catch(e => console.warn('[SHIPS] Snapshot failed:', e));
  }

  _connectWS() {
    this._ws = new WebSocket('ws://localhost:8000/ws/ships');
    this._ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'SHIP_UPDATE') {
        this._ships = msg.ships;
        this._updateGlobe();
        window.dispatchEvent(new CustomEvent('ships:update', { detail: { ships: this._ships } }));
      }
    };
    this._ws.onclose = () => {
      setTimeout(() => this._connectWS(), this._reconnectDelay);
      this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, 30000);
    };
    this._ws.onopen = () => { this._reconnectDelay = 2000; };
  }

  _updateGlobe() {
    if (!this._globe?._globe) return;
    // Ships rendered as custom sci-fi nautical sprites
    this._globe._globe.customLayerData(this._ships.slice(0, 500))
      .customThreeObject(d => {
        if (!window.THREE) return null;
        if (!this._shipSpriteMaterialBase) {
          const canvas = document.createElement('canvas');
          canvas.width = 64; canvas.height = 64;
          const ctx = canvas.getContext('2d');
          
          ctx.strokeStyle = '#00aaff';
          ctx.lineWidth = 1.5;
          ctx.shadowColor = '#00aaff';
          ctx.shadowBlur = 6;
          
          // Outer dashed ring
          ctx.beginPath();
          ctx.arc(32, 32, 28, 0, Math.PI * 2);
          ctx.setLineDash([4, 6]);
          ctx.stroke();
          
          // Ship chevron (pointing up)
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(0, 170, 255, 0.8)';
          ctx.beginPath();
          ctx.moveTo(32, 10);
          ctx.lineTo(44, 48);
          ctx.lineTo(32, 40);
          ctx.lineTo(20, 48);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          
          this._shipTexture = new window.THREE.CanvasTexture(canvas);
          this._shipSpriteMaterialBase = new window.THREE.SpriteMaterial({
            map: this._shipTexture,
            transparent: true,
            depthWrite: false,
            blending: window.THREE.AdditiveBlending
          });
        }
        
        // Clone material so each sprite can rotate independently
        const mat = this._shipSpriteMaterialBase.clone();
        return new window.THREE.Sprite(mat);
      })
      .customThreeObjectUpdate((obj, d) => {
        if (!obj) return;
        Object.assign(obj.position, 
          this._globe._globe.getCoords(d.lat, d.lon, 0.001));
        
        const scale = d.speed_knots > 15 ? 1.0 : 0.7;
        obj.scale.set(scale, scale, 1);
        
        // Rotate sprite by heading (deck.gl uses clockwise, standard math requires negative radians)
        obj.material.rotation = -(d.heading || 0) * Math.PI / 180;
      });
  }

  get ships() { return this._ships; }
}