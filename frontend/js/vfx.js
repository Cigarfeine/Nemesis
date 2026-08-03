/**
 * Project Nemesis — Visual Enhancements Module (js/vfx.js)
 */

export class NemesisVFX {

  static init(globe) {
    NemesisVFX._initCounterFlicker();
    NemesisVFX._enhanceGlobe(globe);
    NemesisVFX.setMode('tactical');
    console.log('[VFX] Nemesis visual enhancements & lean tactical theme active');
  }

  static _initStarField() {
    const canvas = document.createElement('canvas');
    canvas.id = 'starfield';
    canvas.style.cssText = `position:fixed;inset:0;z-index:0;pointer-events:none;opacity:0.9;`;
    document.body.insertBefore(canvas, document.getElementById('globe-container'));
    const ctx = canvas.getContext('2d');
    let W, H, stars = [];
    const resize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
      stars = NemesisVFX._generateStars(W, H);
    };
    resize();
    window.addEventListener('resize', resize);
    let offsetX = 0, offsetY = 0;
    const render = () => {
      ctx.clearRect(0, 0, W, H);
      for (const star of stars) {
        const x = (star.x + offsetX * star.depth) % W;
        const y = (star.y + offsetY * star.depth) % H;
        ctx.beginPath();
        ctx.arc(x, y, star.r, 0, Math.PI * 2);
        ctx.fillStyle = star.warm
          ? `rgba(255,200,100,${star.a})`
          : `rgba(${120 + star.depth * 80},${180 + star.depth * 60},255,${star.a})`;
        ctx.fill();
        if (star.r > 1.2) {
          ctx.beginPath();
          ctx.arc(x, y, star.r * 2.5, 0, Math.PI * 2);
          const grad = ctx.createRadialGradient(x, y, 0, x, y, star.r * 2.5);
          grad.addColorStop(0, star.warm ? `rgba(255,200,100,${star.a*0.3})` : `rgba(100,200,255,${star.a*0.2})`);
          grad.addColorStop(1, 'transparent');
          ctx.fillStyle = grad;
          ctx.fill();
        }
      }
      offsetX += 0.015;
      offsetY += 0.008;
      requestAnimationFrame(render);
    };
    render();
  }

  static _generateStars(W, H) {
    const stars = [];
    const count = Math.floor((W * H) / 2000);
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * W, y: Math.random() * H,
        r: Math.random() * 1.6 + 0.2,
        a: Math.random() * 0.7 + 0.1,
        depth: Math.random() * 0.3,
        warm: Math.random() < 0.04,
      });
    }
    return stars;
  }

  static _initCounterFlicker() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(m => {
        const el = m.target.nodeType === 3 ? m.target.parentElement : m.target;
        if (el && el.classList) {
          el.classList.remove('flicker');
          void el.offsetWidth;
          el.classList.add('flicker');
        }
      });
    });
    document.querySelectorAll('.status-value, .stat-num, .detail-value').forEach(el => {
      observer.observe(el, { childList: true, characterData: true, subtree: true });
    });
  }

  static _enhanceGlobe(globe) {
    if (!globe || !globe._globe) return;
    try {
      globe._globe.atmosphereColor('#4A90D9').atmosphereAltitude(0.15).showGraticules(false).showAtmosphere(true);
      const scene = globe._globe.scene();
      if (scene) {
        scene.traverse(obj => {
          if (obj.isLineSegments && obj.material) {
            obj.material.color.setHex(0x1a3a5c);
            obj.material.opacity = 0.12;
            obj.material.transparent = true;
          }
        });
      }
    } catch(e) { console.warn('[VFX] Globe enhancement partial:', e.message); }
  }

  static createPulseRing(screenX, screenY, color = '#ffb300') {
    const ring = document.createElement('div');
    ring.style.cssText = `position:fixed;left:${screenX}px;top:${screenY}px;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;border:1.5px solid ${color};box-shadow:0 0 8px ${color};pointer-events:none;z-index:300;animation:pulse-ring-expand 1.2s ease-out forwards;`;
    document.body.appendChild(ring);
    setTimeout(() => ring.remove(), 1200);
  }

  static _initDataParticles() {
    const canvas = document.createElement('canvas');
    canvas.id = 'particle-overlay';
    canvas.style.cssText = `position:fixed;inset:0;z-index:150;pointer-events:none;`;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const particles = [];
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener('resize', resize);
    const spawnParticle = () => {
      const topbarH = 52, panelW = 300;
      const lane = Math.random();
      if (lane < 0.4) {
        particles.push({ x: panelW + Math.random()*(window.innerWidth-panelW*2), y: topbarH, vx:(Math.random()-0.5)*0.8, vy:0, life:1, decay:0.008+Math.random()*0.006, size:1.5+Math.random(), color:'rgba(0,245,255,' });
      } else if (lane < 0.7) {
        particles.push({ x: panelW, y: topbarH+Math.random()*(window.innerHeight-topbarH-34), vx:0, vy:(Math.random()-0.5)*0.6, life:1, decay:0.01, size:1.2, color:'rgba(0,200,220,' });
      } else {
        particles.push({ x: window.innerWidth-panelW, y: topbarH+Math.random()*(window.innerHeight-topbarH-34), vx:0, vy:(Math.random()-0.5)*0.6, life:1, decay:0.01, size:1.2, color:'rgba(0,180,200,' });
      }
    };
    let frameCount = 0;
    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      frameCount++;
      if (frameCount % 3 === 0) spawnParticle();
      if (particles.length > 120) particles.splice(0, particles.length - 120);
      for (let i = particles.length-1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy; p.life -= p.decay;
        if (p.life <= 0) { particles.splice(i,1); continue; }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI*2);
        ctx.fillStyle = `${p.color}${p.life.toFixed(2)})`;
        ctx.fill();
      }
      requestAnimationFrame(render);
    };
    render();
  }

  static injectKeyframes() {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse-ring-expand { 0%{transform:scale(1);opacity:1;} 100%{transform:scale(8);opacity:0;} }
      @keyframes orbit-trail-fade { from{opacity:0.6;} to{opacity:0;} }
    `;
    document.head.appendChild(style);
  }

  // Optical & Tactical visual modes (extended with static lean mode entry)
  static MODES = {
    normal:   { name: 'Normal View',       theme: null,       class: '' },
    nv:       { name: 'Night Vision (NV)', theme: null,       class: 'nv-mode' },
    flir:     { name: 'FLIR Thermal',      theme: null,       class: 'flir-mode' },
    rf_heat:  { name: 'RF Heatmap',        theme: null,       class: 'rf-heatmap-mode' },
    tactical: { name: 'Tactical (Lean)',   theme: 'tactical', class: 'nx-viewport' }
  };
  static currentMode = 'normal';

  static setMode(modeKey, targetElement = null) {
    const mode = NemesisVFX.MODES[modeKey] || NemesisVFX.MODES.normal;
    NemesisVFX.currentMode = modeKey;

    // Gate by [data-theme="tactical"] on app root (default OFF)
    if (mode.theme) {
      document.documentElement.setAttribute('data-theme', mode.theme);
      if (document.body) document.body.setAttribute('data-theme', mode.theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
      if (document.body) document.body.removeAttribute('data-theme');
    }

    // Apply viewport styling class if target or #globe-container exists
    const viewport = targetElement || document.getElementById('globe-container');
    if (viewport) {
      Object.values(NemesisVFX.MODES).forEach(m => {
        if (m.class && viewport.classList) viewport.classList.remove(m.class);
      });
      if (mode.class && viewport.classList) viewport.classList.add(mode.class);
    }
    console.log(`[VFX] Switched mode to: ${mode.name}`);
  }
}
