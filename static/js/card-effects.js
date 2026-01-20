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

    card.addEventListener('mouseenter', (evt) => {
      setGlowVarsFromEvent(card, evt);
      const ctrl = ensureController();
      if (ctrl && ctrl.onEnter) ctrl.onEnter(evt);
    });

    card.addEventListener('mousemove', (evt) => {
      setGlowVarsFromEvent(card, evt);
      const ctrl = controllers.get(card);
      if (ctrl && ctrl.onMove) ctrl.onMove(evt);
    });

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

    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
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
})();
