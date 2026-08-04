# NEMESIS — tactical theme integration spec (lean / functional build)

Target: additive skin layer on the existing NEMESIS frontend. No logic changes to any existing module. This is a functional tool, not a demo reel — every rule below exists to keep frame time cheap on top of an already GPU-heavy `globe.gl`/Three.js scene.

## 0. Non-negotiable constraints

- Existing modules stay untouched in logic/behavior: `main.js`, `telemetry.js`, `globe.js`, `interpolator.js`, `flights.js`, `ships.js`, `satellite_profile.js`, `ui.js`, `alerts.js`, `knowledge_graph.js`, `views.js`, `vfx.js`.
- `vfx.js` already implements FLIR/NV/RF-heatmap optical modes and CRT scanlines — extend it, don't fork a parallel system.
- New CSS vars prefixed `--nx-`, zero collision risk with existing theme vars.
- Ships behind `data-theme="tactical"` on the app root, default OFF until reviewed.
- Zero continuous `requestAnimationFrame` loops, zero infinite CSS `@keyframes` running while the dashboard is open. The globe/telemetry render loop is the only thing that should be animating continuously. A themed dashboard idling at high CPU/GPU because of decorative CSS is a bug, not a feature.

## 1. Design tokens — unchanged from prior pass, this part was never the cost

```css
[data-theme="tactical"] {
  --nx-bg: #060705;
  --nx-panel: #0A0C09;
  --nx-border: #1C2418;
  --nx-flir-a: #1B2A16;
  --nx-flir-b: #2C4020;
  --nx-flir-c: #0E1A0C;
  --nx-green: #7CFF6B;
  --nx-green-dim: #3E7A35;
  --nx-red: #E8332E;
  --nx-red-dim: #5A1614;
  --nx-text: #C7D4C2;
  --nx-text-dim: #4C5A47;
}
```

Alert color (`--nx-red`) reserved for genuine threat/lock states only.

## 2. What's IN — static, single-paint, effectively free

### 2.1 Static scanline texture
One `background-image`, painted once, no animation, no blend mode. Sits on the main viewport only, not the whole app.

```css
.nx-viewport::before {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,0.18), rgba(0,0,0,0.18) 1px, transparent 1px, transparent 3px);
}
```

### 2.2 Track/correlation row pattern — static state, no transition loop
Color changes on state change only (React/DOM class toggle when the underlying event updates), not a running animation.

```html
<div class="nx-track-row" data-status="active">
  <div>SAT-44714</div><div>OPTICAL / RF</div><div class="nx-status">ACTIVE</div><div>CONFIRMED — ΔV EVENT</div>
</div>
```

```css
.nx-track-row[data-status="active"] > div {
  color: var(--nx-red); border-color: var(--nx-red-dim); background: rgba(232,51,46,0.08);
}
```

### 2.3 Static FLIR-tone background for optical viewport
Plain `radial-gradient`, no blend mode, no repaint cost beyond first layout.

```css
.nx-viewport {
  background: radial-gradient(ellipse at 40% 60%, var(--nx-flir-b) 0%, var(--nx-flir-a) 45%, var(--nx-flir-c) 100%);
}
```

## 3. What's OUT — removed on purpose, do not re-add without a specific reason

Cut from the previous pass, all for the same reason: continuous animation stacked on top of an already-animating WebGL canvas competes for the same frame budget and buys nothing functional.

- Screen flicker loop (`@keyframes` brightness jitter on the shell)
- RGB-split glitch pulse on status text
- Holo sensor-refresh scan (moving gradient band)
- Radar sweep (rotating conic-gradient)
- Threat-dot pulse animation
- Noise/grain SVG turbulence overlay
- Vignette using `mix-blend-mode` (blend modes force extra compositing passes — if a vignette is wanted later, use a flat `box-shadow: inset` instead, it's cheap; skip for now)

If a specific one of these is needed later for a demo build (not the working tool), branch it separately — don't merge it into the functional theme.

## 4. Rollout checklist

- [ ] New CSS in its own file, imported after the base stylesheet, gated by `[data-theme="tactical"]`
- [ ] No `.js` file deleted, renamed, or logic-altered
- [ ] `vfx.js` gets one new static mode entry; existing modes remain selectable
- [ ] Zero `@keyframes` with `infinite` iteration count anywhere in the new CSS
- [ ] Overlay elements have `pointer-events: none` and sit above the canvas in DOM order, never inside the Three.js render loop
- [ ] Confirm `telemetry.js` reconnect/backoff and the OSINT-offline fallback state render unchanged under the new theme
- [ ] Profile with the theme on vs off — frame time delta should be near zero; if it isn't, something in this list got re-added
