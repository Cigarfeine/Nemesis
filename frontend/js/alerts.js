export class NemesisAlerts {
  constructor() {
    this._ws = null;
    this._alerts = [];
    this._reconnectDelay = 2000;
  }

  start() {
    this._connectWS();
    this._fetchWeather();
    this._fetchManeuvers();
  }

  _connectWS() {
    this._ws = new WebSocket('ws://localhost:8000/ws/alerts');
    this._ws.onmessage = (e) => {
      const alert = JSON.parse(e.data);
      this._handleAlert(alert);
    };
    this._ws.onclose = () => setTimeout(() => this._connectWS(), this._reconnectDelay);
  }

  _handleAlert(alert) {
    this._alerts.unshift(alert);
    if (this._alerts.length > 100) this._alerts.pop();

    // Flash the HUD
    this._flashHUD(alert.severity);

    // Add to intel feed log
    const logList = document.getElementById('log-list');
    if (logList) {
      const li = document.createElement('li');
      li.className = `log-entry ${alert.severity === 'RED' ? 'error' : alert.severity === 'AMBER' ? 'warn' : 'ok'}`;
      const now = new Date();
      const ts = `${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')}Z`;
      li.innerHTML = `<span class="log-time">${ts}</span><span class="log-msg">[${alert.type}] ${alert.message}</span>`;
      logList.prepend(li);
      while (logList.children.length > 50) logList.removeChild(logList.lastChild);
    }

    // Auto-flyto on EMERGING_EVENT
    if (alert.type === 'EMERGING_EVENT' && alert.lat && alert.lon) {
      window.dispatchEvent(new CustomEvent('graph:location-click', {
        detail: { lat: alert.lat, lon: alert.lon }
      }));
    }

    // Show toast notification
    this._showToast(alert);

    window.dispatchEvent(new CustomEvent('alert:new', { detail: alert }));
  }

  _flashHUD(severity) {
    const topbar = document.getElementById('topbar');
    if (!topbar) return;
    const color = severity === 'RED' ? 'rgba(255,45,45,0.15)' 
                : severity === 'AMBER' ? 'rgba(255,179,0,0.1)' 
                : 'rgba(0,245,255,0.06)';
    topbar.style.background = color;
    setTimeout(() => { topbar.style.background = ''; }, 600);
  }

  _showToast(alert) {
    const toast = document.createElement('div');
    const colors = { RED: '#ff2d2d', AMBER: '#ffb300', GREEN: '#7cff7c' };
    const color = colors[alert.severity] || '#00f5ff';
    toast.style.cssText = `
      position:fixed; bottom:50px; left:50%;
      transform:translateX(-50%);
      z-index:1000; pointer-events:none;
      background:rgba(2,8,20,0.97);
      border:1px solid ${color};
      box-shadow:0 0 20px ${color}44;
      padding:10px 24px;
      font-family:'Orbitron',sans-serif;
      font-size:10px; color:${color};
      letter-spacing:.2em;
      text-shadow:0 0 8px ${color};
      animation:toast-in 0.3s ease-out;
      white-space:nowrap;
    `;
    toast.textContent = `[${alert.type}] ${alert.message?.substring(0,60)}`;
    document.body.appendChild(toast);

    const style = document.createElement('style');
    style.textContent = `@keyframes toast-in{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`;
    document.head.appendChild(style);

    setTimeout(() => { toast.style.opacity='0'; toast.style.transition='opacity 0.5s'; }, 3500);
    setTimeout(() => toast.remove(), 4000);
  }

  _fetchWeather() {
    fetch('http://localhost:8000/api/space-weather')
      .then(r => r.json())
      .then(data => {
        const el = document.getElementById('weather-kp');
        if (el) el.textContent = data.kp_index?.toFixed(1) || '—';
        const level = document.getElementById('weather-level');
        if (level) {
          level.textContent = data.alert_level || 'GREEN';
          level.className = 'status-value ' + 
            (data.alert_level === 'RED' ? 'red' : data.alert_level === 'AMBER' ? 'amber' : 'green');
        }
      })
      .catch(() => {});
  }

  _fetchManeuvers() {
    fetch('http://localhost:8000/api/maneuvers/recent')
      .then(r => r.json())
      .then(data => {
        const list = document.getElementById('maneuver-list');
        if (!list || !data.maneuvers?.length) return;
        list.innerHTML = (data.maneuvers || []).slice(0,5).map(m => `
          <li class="sat-item" style="border-color:rgba(255,179,0,0.15)">
            <div class="sat-dot" style="background:#ffb300;box-shadow:0 0 5px #ffb300"></div>
            <span class="sat-name">${m.name}</span>
            <span class="sat-alt" style="font-size:8px">${m.type}</span>
          </li>
        `).join('');
      })
      .catch(() => {});
  }
}