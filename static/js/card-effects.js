/* Card hover effects registry.

   Goals:
   - Effects are opt-in per card via data-fx.
   - Effects only render while hovered (no idle CPU/GPU burn).
   - Effects are easy to extend: add a registry entry.
*/

(function () {
  const registry = {
    'glow-matrix': createGlowMatrixEffect,
    'vector-field': createVectorFieldEffect,
    'molecules': createMoleculesEffect,
  };

  const controllers = new WeakMap();

  function setGlowVarsFromEvent(card, evt) {
    const rect = card.getBoundingClientRect();
    const x = ((evt.clientX - rect.left) / rect.width) * 100;
    const y = ((evt.clientY - rect.top) / rect.height) * 100;
    card.style.setProperty('--glow-x', x.toFixed(2) + '%');
    card.style.setProperty('--glow-y', y.toFixed(2) + '%');
  }

  function attachCard(card) {
    const fxName = (card.dataset.fx || '').trim();
    const factory = registry[fxName];
    if (!factory) return;

    function ensureController() {
      let ctrl = controllers.get(card);
      if (!ctrl) {
        ctrl = factory(card);
        controllers.set(card, ctrl);
      }
      return ctrl;
    }

    const shouldTrackGlow = fxName === 'glow-matrix';
    const shouldTrackMove = fxName !== 'molecules';

    card.addEventListener('mouseenter', (evt) => {
      if (shouldTrackGlow) setGlowVarsFromEvent(card, evt);
      const ctrl = ensureController();
      if (ctrl && ctrl.onEnter) ctrl.onEnter(evt);
    });

    if (shouldTrackMove || shouldTrackGlow) {
      card.addEventListener('mousemove', (evt) => {
        if (shouldTrackGlow) setGlowVarsFromEvent(card, evt);
        const ctrl = controllers.get(card);
        if (ctrl && ctrl.onMove) ctrl.onMove(evt);
      });
    }

    card.addEventListener('mouseleave', (evt) => {
      const ctrl = controllers.get(card);
      if (ctrl && ctrl.onLeave) ctrl.onLeave(evt);
    });
  }

  function init() {
    const cards = document.querySelectorAll('[data-fx]');
    if (!cards.length) return;
    for (const card of cards) attachCard(card);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // -------------------------
  // Effect: glow-matrix (existing)
  // -------------------------

  function createGlowMatrixEffect(card) {
    const matrix = card.querySelector('.fx-matrix');
    if (!matrix) return {};

    const DIGITS = '0123456789';
    let timer = null;
    let clearTimer = null;

    function buildDigits(rows, cols) {
      let out = '';
      for (let r = 0; r < rows; r++) {
        let line = '';
        for (let c = 0; c < cols; c++) {
          const roll = Math.random();
          if (roll < 0.22) line += ' ';
          else line += DIGITS[(Math.random() * DIGITS.length) | 0];
        }
        out += line + (r === rows - 1 ? '' : '\n');
      }
      return out;
    }

    function measureCharWidth(sampleEl) {
      const probe = document.createElement('span');
      const styles = getComputedStyle(sampleEl);
      probe.style.position = 'absolute';
      probe.style.left = '-9999px';
      probe.style.top = '0';
      probe.style.whiteSpace = 'pre';
      probe.style.fontFamily = styles.fontFamily;
      probe.style.fontSize = styles.fontSize;
      probe.style.fontWeight = styles.fontWeight;
      probe.style.letterSpacing = styles.letterSpacing;
      probe.textContent = '0000000000';
      document.body.appendChild(probe);
      const w = probe.getBoundingClientRect().width / 10;
      probe.remove();
      return Math.max(1, w);
    }

    function start() {
      if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = null;
      }

      const rect = card.getBoundingClientRect();
      const ms = getComputedStyle(matrix);
      const padX = parseFloat(ms.paddingLeft) + parseFloat(ms.paddingRight);
      const padY = parseFloat(ms.paddingTop) + parseFloat(ms.paddingBottom);
      const charW = measureCharWidth(matrix);
      const cols = Math.max(22, Math.floor((rect.width - padX) / charW));
      const rows = Math.max(8, Math.floor((rect.height - padY) / 18));

      if (timer) clearInterval(timer);
      matrix.textContent = buildDigits(rows, cols);
      timer = setInterval(() => {
        matrix.textContent = buildDigits(rows, cols);
      }, 80);
    }

    function stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = setTimeout(() => {
        matrix.textContent = '';
        clearTimer = null;
      }, 260);
    }

    return {
      onEnter: start,
      onLeave: stop,
    };
  }

  // -------------------------
  // Effect: vector-field (Physics)
  // -------------------------

  function parseRgbTriplet(cssValue) {
    // Expected format: "13, 110, 253" (Bootstrap vars)
    const parts = String(cssValue)
      .trim()
      .split(',')
      .map((p) => Number(p.trim()))
      .filter((n) => Number.isFinite(n));
    if (parts.length >= 3) return [parts[0], parts[1], parts[2]];
    return [0, 0, 0];
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function clamp01(x) {
    return Math.max(0, Math.min(1, x));
  }

  function createVectorFieldEffect(card) {
    const canvas = card.querySelector('canvas.fx-canvas');
    if (!canvas) return {};

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return {};

    const rootStyles = getComputedStyle(document.documentElement);
    const primaryRgb = parseRgbTriplet(rootStyles.getPropertyValue('--bs-primary-rgb'));
    const dangerRgb = parseRgbTriplet(rootStyles.getPropertyValue('--bs-danger-rgb'));

    let running = false;
    let rafId = 0;
    let lastTs = 0;
    let cursorX = 0;
    let cursorY = 0;
    let hasCursor = false;
    let dpr = 1;
    let clearTimer = null;

    let points = [];
    let width = 0;
    let height = 0;

    const config = {
      // Density scales roughly with 1/spacing^2. Using ~12*sqrt(2) gives ~half.
      spacing: 17,
      segmentLength: 7,
      lineWidth: 1,
      alpha: 0.55,
      maxFps: 40,
    };

    function resize() {
      const rect = card.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);

      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Rebuild points grid.
      points = [];
      const pad = config.spacing * 0.5;
      for (let y = pad; y < height - pad; y += config.spacing) {
        for (let x = pad; x < width - pad; x += config.spacing) {
          // small jitter so it doesn't feel too perfect
          const jx = (hash2(x, y) - 0.5) * 3;
          const jy = (hash2(y, x) - 0.5) * 3;
          const px = x + jx;
          const py = y + jy;
          points.push([px, py]);
        }
      }
    }

    // Fast deterministic hash -> [0..1)
    function hash2(x, y) {
      const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      return s - Math.floor(s);
    }

    // Smooth-ish pseudo-noise (cheap)
    function noise(x, y, t) {
      const a = Math.sin(x * 0.015 + t * 0.9);
      const b = Math.cos(y * 0.015 - t * 0.7);
      const c = Math.sin((x + y) * 0.01 + t * 0.35);
      return (a * b + 0.55 * c);
    }

    function colorForDistance(dist, maxDist) {
      // Color depends on distance: near pointer -> danger, far -> primary.
      const t = clamp01(1 - dist / maxDist);
      const r = Math.round(lerp(primaryRgb[0], dangerRgb[0], t));
      const g = Math.round(lerp(primaryRgb[1], dangerRgb[1], t));
      const b = Math.round(lerp(primaryRgb[2], dangerRgb[2], t));
      return `rgba(${r}, ${g}, ${b}, ${config.alpha})`;
    }

    function step(ts) {
      if (!running) return;

      const minFrameMs = 1000 / config.maxFps;
      if (ts - lastTs < minFrameMs) {
        rafId = requestAnimationFrame(step);
        return;
      }
      lastTs = ts;

      ctx.clearRect(0, 0, width, height);

      // If cursor hasn't moved yet, keep it near center.
      const cx = hasCursor ? cursorX : width * 0.5;
      const cy = hasCursor ? cursorY : height * 0.45;

      // "Matplotlib-ish" look: thin, lots of tiny line segments.
      ctx.lineWidth = config.lineWidth;
      ctx.lineCap = 'round';
      // No glow; keep it crisp/"matplotlib".
      ctx.shadowBlur = 0;

      const t = ts * 0.001;
      const maxDist = Math.max(140, Math.min(width, height) * 0.75);

      for (let i = 0; i < points.length; i++) {
        const px = points[i][0];
        const py = points[i][1];

        // Magnet field: point toward cursor.
        const dx = cx - px;
        const dy = cy - py;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.0001;
        const ux = dx / dist;
        const uy = dy / dist;

        // Distance-based strength (closer -> stronger/longer).
        const influence = clamp01(1 - dist / maxDist);

        // Small noise so it isn't perfectly uniform.
        const n = noise(px, py, t);
        const jitter = (0.22 + 0.12 * (1 - influence)) * n;
        const angle = Math.atan2(uy, ux) + jitter;
        const vx = Math.cos(angle);
        const vy = Math.sin(angle);

        const len = config.segmentLength * (0.65 + 1.0 * influence);

        ctx.strokeStyle = colorForDistance(dist, maxDist);

        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + vx * len, py + vy * len);
        ctx.stroke();
      }

      rafId = requestAnimationFrame(step);
    }

    function start() {
      if (running) return;

      if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = null;
      }

      resize();
      running = true;
      lastTs = 0;
      rafId = requestAnimationFrame(step);
    }

    function stop() {
      running = false;
      hasCursor = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;

      // Keep the last frame so CSS opacity can fade it out.
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = setTimeout(() => {
        ctx.clearRect(0, 0, width, height);
        clearTimer = null;
      }, 260);
    }

    // Keep canvas sized correctly while hovered.
    const ro = new ResizeObserver(() => {
      if (!running) return;
      resize();
    });
    ro.observe(card);

    return {
      onEnter: (evt) => {
        const rect = card.getBoundingClientRect();
        cursorX = evt.clientX - rect.left;
        cursorY = evt.clientY - rect.top;
        hasCursor = true;
        start();
      },
      onMove: (evt) => {
        const rect = card.getBoundingClientRect();
        cursorX = evt.clientX - rect.left;
        cursorY = evt.clientY - rect.top;
        hasCursor = true;
      },
      onLeave: () => stop(),
    };
  }

  // -------------------------
  // Effect: molecules (Chemistry)
  // -------------------------

  function createMoleculesEffect(card) {
    const canvas = card.querySelector('canvas.fx-canvas');
    if (!canvas) return {};

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return {};

    function parseCssColorToRgb(color) {
      // Handles 'rgb(r,g,b)' and 'rgba(r,g,b,a)'
      const m = String(color)
        .trim()
        .match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
      if (!m) return null;
      return [Number(m[1]), Number(m[2]), Number(m[3])];
    }

    const rootStyles = getComputedStyle(document.documentElement);
    const primaryRgb = parseRgbTriplet(rootStyles.getPropertyValue('--bs-primary-rgb'));
    const dangerRgb = parseRgbTriplet(rootStyles.getPropertyValue('--bs-danger-rgb'));
    const warningRgb = parseRgbTriplet(rootStyles.getPropertyValue('--bs-warning-rgb'));
    const successRgb = parseRgbTriplet(rootStyles.getPropertyValue('--bs-success-rgb'));
    const bodyRgb = parseRgbTriplet(rootStyles.getPropertyValue('--bs-body-color-rgb'));
    const pageBgRgb = parseCssColorToRgb(getComputedStyle(document.body).backgroundColor) || [255, 255, 255];

    let running = false;
    let rafId = 0;
    let lastTs = 0;
    let dpr = 1;
    let clearTimer = null;
    let width = 0;
    let height = 0;
    let molecules = [];

    const config = {
      // Target density; actual count scales with card area.
      minCount: 8,
      maxCount: 14,
      pixelsPerMolecule: 6500,
      maxFps: 30,
    };

    function desiredCount() {
      const byArea = Math.max(1, Math.round((width * height) / config.pixelsPerMolecule));
      return Math.max(config.minCount, Math.min(config.maxCount, byArea));
    }

    function rgba(rgb, a) {
      return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
    }

    function resize() {
      const rect = card.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);

      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function rand(min, max) {
      return min + Math.random() * (max - min);
    }

    function elementColor(el) {
      switch (el) {
        case 'C':
          return bodyRgb; // black/dark
        case 'O':
          return dangerRgb; // red
        case 'N':
          return primaryRgb; // blue
        case 'S':
          return warningRgb; // yellow
        case 'Cl':
          return successRgb; // green
        case 'H':
          return pageBgRgb; // white-ish, depends on page
        default:
          return bodyRgb;
      }
    }

    function elementRadius(el) {
      // Make circles 1.5x bigger (overall scale factor).
      // Keep H slightly smaller than heavy atoms.
      const scale = 1.5;
      const base = el === 'H' ? 1.8 : 2.3;
      return base * scale;
    }

    const templates = [
      // Coordinates are in a small local coordinate space around (0,0).
      // Bonds: [aIdx, bIdx, order]
      {
        name: 'O2',
        atoms: [
          { el: 'O', x: -8, y: 0 },
          { el: 'O', x: 8, y: 0 },
        ],
        bonds: [[0, 1, 2]],
      },
      {
        name: 'N2',
        atoms: [
          { el: 'N', x: -8, y: 0 },
          { el: 'N', x: 8, y: 0 },
        ],
        bonds: [[0, 1, 3]],
      },
      {
        name: 'H2',
        atoms: [
          { el: 'H', x: -7, y: 0 },
          { el: 'H', x: 7, y: 0 },
        ],
        bonds: [[0, 1, 1]],
      },
      {
        name: 'H2O',
        atoms: [
          { el: 'O', x: 0, y: 0 },
          { el: 'H', x: -10, y: 7 },
          { el: 'H', x: 10, y: 7 },
        ],
        bonds: [
          [0, 1, 1],
          [0, 2, 1],
        ],
      },
      {
        name: 'CO2',
        atoms: [
          { el: 'O', x: -14, y: 0 },
          { el: 'C', x: 0, y: 0 },
          { el: 'O', x: 14, y: 0 },
        ],
        bonds: [
          [0, 1, 2],
          [1, 2, 2],
        ],
      },
      {
        name: 'CH4',
        atoms: [
          { el: 'C', x: 0, y: 0 },
          { el: 'H', x: 0, y: -14 },
          { el: 'H', x: 12, y: 6 },
          { el: 'H', x: -12, y: 6 },
          { el: 'H', x: 0, y: 14 },
        ],
        bonds: [
          [0, 1, 1],
          [0, 2, 1],
          [0, 3, 1],
          [0, 4, 1],
        ],
      },
      {
        name: 'NH3',
        atoms: [
          { el: 'N', x: 0, y: -2 },
          { el: 'H', x: -11, y: 9 },
          { el: 'H', x: 11, y: 9 },
          { el: 'H', x: 0, y: 15 },
        ],
        bonds: [
          [0, 1, 1],
          [0, 2, 1],
          [0, 3, 1],
        ],
      },
      {
        name: 'SO2',
        atoms: [
          { el: 'S', x: 0, y: 0 },
          { el: 'O', x: -13, y: 6 },
          { el: 'O', x: 13, y: 6 },
        ],
        bonds: [
          [0, 1, 2],
          [0, 2, 2],
        ],
      },
      {
        name: 'HCl',
        atoms: [
          { el: 'H', x: -8, y: 0 },
          { el: 'Cl', x: 10, y: 0 },
        ],
        bonds: [[0, 1, 1]],
      },
      {
        name: 'C2H6',
        atoms: [
          { el: 'C', x: -9, y: 0 },
          { el: 'C', x: 9, y: 0 },
          { el: 'H', x: -18, y: -10 },
          { el: 'H', x: -18, y: 10 },
          { el: 'H', x: -9, y: -15 },
          { el: 'H', x: 18, y: -10 },
          { el: 'H', x: 18, y: 10 },
          { el: 'H', x: 9, y: -15 },
        ],
        bonds: [
          [0, 1, 1],
          [0, 2, 1],
          [0, 3, 1],
          [0, 4, 1],
          [1, 5, 1],
          [1, 6, 1],
          [1, 7, 1],
        ],
      },
    ];

    function makeMolecule() {
      const tmpl = templates[(Math.random() * templates.length) | 0];
      const atoms = tmpl.atoms.map((a) => ({
        el: a.el,
        x: a.x,
        y: a.y,
        r: elementRadius(a.el),
        c: elementColor(a.el),
      }));
      const bonds = tmpl.bonds;

      return {
        x: rand(0, width),
        y: rand(0, height),
        vx: rand(-12, 12),
        vy: rand(-12, 12),
        rot: rand(0, Math.PI * 2),
        vrot: rand(-0.35, 0.35),
        atoms,
        bonds,
      };
    }

    function rebuild() {
      molecules = [];
      const n = desiredCount();
      for (let i = 0; i < n; i++) molecules.push(makeMolecule());
    }

    function drawBond(a, b, order) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const sep = 2.2;

      const lines = order === 3 ? [-sep, 0, sep] : order === 2 ? [-sep * 0.75, sep * 0.75] : [0];
      for (let i = 0; i < lines.length; i++) {
        const o = lines[i];
        ctx.beginPath();
        ctx.moveTo(a.x + nx * o, a.y + ny * o);
        ctx.lineTo(b.x + nx * o, b.y + ny * o);
        ctx.stroke();
      }
    }

    function drawMolecule(m) {
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.rot);

      // Bonds
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(bodyRgb, 0.22);
      for (let i = 0; i < m.bonds.length; i++) {
        const [aIdx, bIdx, order] = m.bonds[i];
        const a = m.atoms[aIdx];
        const b = m.atoms[bIdx];
        drawBond(a, b, order || 1);
      }

      // Atoms
      for (let i = 0; i < m.atoms.length; i++) {
        const atom = m.atoms[i];
        const fillAlpha = atom.el === 'H' ? 0.9 : 0.65;
        ctx.fillStyle = rgba(atom.c, fillAlpha);
        ctx.beginPath();
        ctx.arc(atom.x, atom.y, atom.r, 0, Math.PI * 2);
        ctx.fill();

        // Hydrogen needs an outline to be visible on white backgrounds.
        if (atom.el === 'H') {
          ctx.strokeStyle = rgba(bodyRgb, 0.22);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      ctx.restore();
    }

    function step(ts) {
      if (!running) return;

      const minFrameMs = 1000 / config.maxFps;
      if (ts - lastTs < minFrameMs) {
        rafId = requestAnimationFrame(step);
        return;
      }
      const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
      lastTs = ts;

      ctx.clearRect(0, 0, width, height);

      // Gentle motion, no collisions: wrap-around (fast + simple).
      for (let i = 0; i < molecules.length; i++) {
        const m = molecules[i];
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        m.rot += m.vrot * dt;

        if (m.x < -24) m.x = width + 24;
        else if (m.x > width + 24) m.x = -24;

        if (m.y < -24) m.y = height + 24;
        else if (m.y > height + 24) m.y = -24;

        drawMolecule(m);
      }

      rafId = requestAnimationFrame(step);
    }

    function start() {
      if (running) return;
      if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = null;
      }
      resize();
      rebuild();
      running = true;
      lastTs = 0;
      rafId = requestAnimationFrame(step);
    }

    function stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;

      // Keep last frame for CSS fade-out.
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = setTimeout(() => {
        ctx.clearRect(0, 0, width, height);
        clearTimer = null;
      }, 260);
    }

    const ro = new ResizeObserver(() => {
      if (!running) return;
      resize();
      rebuild();
    });
    ro.observe(card);

    return {
      onEnter: () => start(),
      onLeave: () => stop(),
    };
  }
})();
