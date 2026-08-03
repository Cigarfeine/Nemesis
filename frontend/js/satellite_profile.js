export class SatelliteProfile {

  static async show(noradId, satName) {
    // 1. Show loading state in the Target Lock panel
    SatelliteProfile._setLoading(satName);
    
    // 2. Fetch profile from backend
    const url = `http://localhost:8000/api/satellites/${noradId}/profile?name=${encodeURIComponent(satName)}`;
    let profile;
    try {
      const res = await fetch(url);
      profile = await res.json();
    } catch(e) {
      SatelliteProfile._setError(satName, noradId);
      return;
    }
    
    // 3. Render the full profile
    SatelliteProfile._render(profile);
  }

  static _setLoading(name) {
    const panel = document.getElementById('sat-profile-panel');
    if (!panel) return;
    panel.innerHTML = `
      <div class="profile-loading">
        <div class="profile-scan-line"></div>
        <div style="font-family:'Orbitron',sans-serif;font-size:10px;color:#00f5ff;
                    letter-spacing:.2em;text-align:center;margin-top:12px">
          ACQUIRING: ${name}
        </div>
      </div>
    `;
    panel.style.display = 'block';
  }

  static _render(profile) {
    const panel = document.getElementById('sat-profile-panel');
    if (!panel) return;

    const m = profile.mission_data || {};
    const hasImage = !!profile.image_url;

    panel.innerHTML = `
      <div class="sat-profile">
        ${hasImage ? `
          <div class="profile-image-wrap">
            <img src="${profile.image_url}" 
                 alt="${profile.name}"
                 class="profile-image"
                 onerror="this.parentElement.style.display='none'"/>
            <div class="profile-image-source">SOURCE: ${profile.image_source?.toUpperCase()}</div>
          </div>
        ` : `
          <div class="profile-no-image">
            <div class="profile-schematic">
              ${SatelliteProfile._generateSchematic(profile)}
            </div>
          </div>
        `}
        
        <div class="profile-description">${profile.description || 'No description available.'}</div>
        
        <div class="profile-specs">
          ${m.country    ? `<div class="spec-row"><span class="spec-label">OPERATOR</span><span class="spec-val">${m.country}</span></div>` : ''}
          ${m.launch_date ? `<div class="spec-row"><span class="spec-label">LAUNCHED</span><span class="spec-val">${m.launch_date}</span></div>` : ''}
          ${m.period_minutes ? `<div class="spec-row"><span class="spec-label">PERIOD</span><span class="spec-val">${m.period_minutes?.toFixed(1)} min</span></div>` : ''}
          ${m.inclination_deg ? `<div class="spec-row"><span class="spec-label">INCLINATION</span><span class="spec-val">${m.inclination_deg?.toFixed(2)}°</span></div>` : ''}
          ${m.apogee_km ? `<div class="spec-row"><span class="spec-label">APOGEE</span><span class="spec-val">${m.apogee_km} km</span></div>` : ''}
          ${m.perigee_km ? `<div class="spec-row"><span class="spec-label">PERIGEE</span><span class="spec-val">${m.perigee_km} km</span></div>` : ''}
        </div>
      </div>
    `;
    panel.style.display = 'block';
  }

  static _setError(name, id) {
    const panel = document.getElementById('sat-profile-panel');
    if (!panel) return;
    panel.innerHTML = `
      <div style="font-size:9px;color:rgba(255,45,45,0.7);padding:8px;line-height:2">
        <div style="color:#ff2d2d">IMAGERY UNAVAILABLE</div>
        <div style="color:rgba(0,180,200,0.4)">${name} [${id}]</div>
        <div style="margin-top:4px;color:rgba(0,140,160,0.3)">
          Object may be classified or catalog entry incomplete.
        </div>
      </div>
    `;
  }

  // Generate a simple SVG schematic for satellites with no image
  static _generateSchematic(profile) {
    const isStation = profile.name?.toLowerCase().includes('iss') || 
                      profile.name?.toLowerCase().includes('station');
    const isGPS = profile.mission_data?.object_type?.includes('PAY');

    if (isStation) {
      return `<svg viewBox="0 0 120 60" xmlns="http://www.w3.org/2000/svg">
        <rect x="50" y="25" width="20" height="10" fill="none" stroke="#00f5ff" stroke-width="1"/>
        <rect x="10" y="27" width="35" height="6" fill="none" stroke="#ffb300" stroke-width="1"/>
        <rect x="75" y="27" width="35" height="6" fill="none" stroke="#ffb300" stroke-width="1"/>
        <rect x="55" y="15" width="10" height="10" fill="none" stroke="#00f5ff" stroke-width="0.5"/>
        <circle cx="60" cy="30" r="3" fill="#00f5ff" opacity="0.6"/>
        <text x="60" y="55" text-anchor="middle" fill="#00f5ff" font-size="5" font-family="monospace">SPACE STATION</text>
      </svg>`;
    }

    return `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
      <rect x="30" y="30" width="20" height="20" fill="none" stroke="#00f5ff" stroke-width="1"/>
      <rect x="5"  y="37" width="22" height="6"  fill="none" stroke="#7cff7c" stroke-width="1"/>
      <rect x="53" y="37" width="22" height="6"  fill="none" stroke="#7cff7c" stroke-width="1"/>
      <circle cx="40" cy="20" r="4" fill="none" stroke="#ffb300" stroke-width="1"/>
      <line x1="40" y1="16" x2="40" y2="30" stroke="#ffb300" stroke-width="0.5"/>
      <circle cx="40" cy="40" r="2" fill="#00f5ff" opacity="0.8"/>
      <text x="40" y="70" text-anchor="middle" fill="#00f5ff" font-size="5" font-family="monospace">SATELLITE</text>
    </svg>`;
  }

  static hide() {
    const panel = document.getElementById('sat-profile-panel');
    if (panel) panel.style.display = 'none';
  }
}
