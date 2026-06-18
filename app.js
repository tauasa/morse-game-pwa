/**
 * Morse Trainer — Progressive Web App
 *
 * Hear the Morse for a hidden character, then pick it from the grid.
 * Mirrors the Spring Boot + JavaFX desktop trainer:
 *   - Modes: Letters / Digits / Letters + Digits
 *   - Correct ends the round and scores; wrong keeps the round open
 *   - Streak + accuracy tracking
 *   - "Show patterns" reveals the dot/dash code under each letter
 *   - Replay / Skip, plus keyboard play (type the letter to guess)
 *
 * Modules below: MorseCodec · Game · AudioEngine · Scope · UI
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   MORSE CODEC
   ═══════════════════════════════════════════════════════════════ */

const MORSE = {
  A: '.-',   B: '-...', C: '-.-.', D: '-..',  E: '.',    F: '..-.',
  G: '--.',  H: '....', I: '..',   J: '.---', K: '-.-',  L: '.-..',
  M: '--',   N: '-.',   O: '---',  P: '.--.', Q: '--.-', R: '.-.',
  S: '...',  T: '-',    U: '..-',  V: '...-', W: '.--',  X: '-..-',
  Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-',
  5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
};

const MorseCodec = {
  /** Morse pattern for a single character (e.g. 'A' → '.-'). */
  forChar(c) { return MORSE[c] || ''; },
};

/* ═══════════════════════════════════════════════════════════════
   GAME STATE
   ═══════════════════════════════════════════════════════════════ */

const MODES = {
  LETTERS:            charsRange('A', 'Z'),
  DIGITS:             charsRange('0', '9'),
  LETTERS_AND_DIGITS: charsRange('A', 'Z').concat(charsRange('0', '9')),
};

function charsRange(from, to) {
  const out = [];
  for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c++) {
    out.push(String.fromCharCode(c));
  }
  return out;
}

const Game = {
  mode: 'LETTERS',
  target: null,
  targetMorse: null,
  roundActive: false,
  stats: { correct: 0, incorrect: 0, streak: 0, best: 0 },

  characters() { return MODES[this.mode]; },

  setMode(mode) { if (MODES[mode]) this.mode = mode; },

  /** Pick a new random target, avoiding an immediate repeat. */
  newRound() {
    const pool = this.characters();
    let next;
    do {
      next = pool[Math.floor(Math.random() * pool.length)];
    } while (pool.length > 1 && next === this.target);
    this.target = next;
    this.targetMorse = MorseCodec.forChar(next);
    this.roundActive = true;
    return next;
  },

  /**
   * Submit a guess. Correct ends the round and scores; wrong keeps it
   * open and resets the streak. Returns { correct, guessed, target, morse }.
   */
  guess(ch) {
    if (!this.roundActive) return null;
    const guessed = String(ch).toUpperCase();
    const correct = guessed === this.target;
    if (correct) {
      this.stats.correct++;
      this.stats.streak++;
      if (this.stats.streak > this.stats.best) this.stats.best = this.stats.streak;
      this.roundActive = false;
    } else {
      this.stats.incorrect++;
      this.stats.streak = 0;
    }
    return { correct, guessed, target: this.target, morse: this.targetMorse };
  },

  total() { return this.stats.correct + this.stats.incorrect; },
  accuracy() {
    const t = this.total();
    return t === 0 ? null : (this.stats.correct * 100) / t;
  },
  resetStats() { this.stats = { correct: 0, incorrect: 0, streak: 0, best: 0 }; },
};

/* ═══════════════════════════════════════════════════════════════
   AUDIO ENGINE  (Web Audio API)
   Signal chain:  oscillator → gain → master → analyser → destination
   The analyser feeds the on-screen oscilloscope.
   ═══════════════════════════════════════════════════════════════ */

const AudioEngine = {
  ctx: null,
  master: null,
  analyser: null,
  unlocked: false,
  playing: false,
  _stop: false,

  // Timing (beginner-friendly 90 ms dot, matching the desktop default)
  FREQ: 700,
  AMP: 0.5,
  DOT_MS: 90,
  get DASH_MS() { return this.DOT_MS * 3; },
  get SYMBOL_GAP_MS() { return this.DOT_MS; },
  RAMP_MS: 10,

  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.master.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.unlocked = true;
  },

  stop() { this._stop = true; },

  /**
   * Play the dot/dash pattern. Resolves when finished or stopped.
   * Each element is a separate oscillator with a ramped gain envelope.
   */
  async play(pattern) {
    this.ensure();
    this._stop = false;
    this.playing = true;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ramp = this.RAMP_MS / 1000;

    const tone = (ms) => {
      const dur = ms / 1000;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = this.FREQ;
      osc.connect(g);
      g.connect(this.master);
      const t0 = this.ctx.currentTime;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(this.AMP, t0 + ramp);
      g.gain.setValueAtTime(this.AMP, t0 + dur - ramp);
      g.gain.linearRampToValueAtTime(0, t0 + dur);
      osc.start(t0);
      osc.stop(t0 + dur);
    };

    for (let i = 0; i < pattern.length; i++) {
      if (this._stop) break;
      if (i > 0) await sleep(this.SYMBOL_GAP_MS);
      const el = pattern[i];
      tone(el === '-' ? this.DASH_MS : this.DOT_MS);
      await sleep(el === '-' ? this.DASH_MS : this.DOT_MS);
    }

    this.playing = false;
  },
};

/* ═══════════════════════════════════════════════════════════════
   SCOPE  (live oscilloscope on a canvas)
   ═══════════════════════════════════════════════════════════════ */

const Scope = {
  canvas: null,
  ctx: null,
  raf: null,
  reduced: false,
  BARS: 40,
  ACCENT: '#4b3ff0',

  init() {
    this.canvas = document.getElementById('scope-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._resize();
    window.addEventListener('resize', () => this._resize());
    if (this.reduced) this._drawStatic();
    else this._loop();
  },

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(r.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(r.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._w = r.width;
    this._h = r.height;
    if (this.reduced) this._drawStatic();
  },

  /** Draw N mirrored vertical bars centred on the midline. */
  _drawBars(heights) {
    const { ctx, _w: w, _h: h } = this;
    ctx.clearRect(0, 0, w, h);
    const mid = h / 2;
    const n = heights.length;
    const slot = w / n;
    const barW = Math.max(2, slot * 0.55);
    ctx.fillStyle = this.ACCENT;
    for (let i = 0; i < n; i++) {
      const x = i * slot + (slot - barW) / 2;
      const half = Math.max(1.5, heights[i] * (h * 0.42));
      const r = barW / 2;
      // rounded vertical bar from mid-half to mid+half
      ctx.beginPath();
      const top = mid - half, bot = mid + half;
      ctx.moveTo(x, top + r);
      ctx.arcTo(x, top, x + r, top, r);
      ctx.arcTo(x + barW, top, x + barW, top + r, r);
      ctx.lineTo(x + barW, bot - r);
      ctx.arcTo(x + barW, bot, x + barW - r, bot, r);
      ctx.arcTo(x, bot, x, bot - r, r);
      ctx.closePath();
      ctx.fill();
    }
  },

  _drawStatic() {
    this._drawBars(new Array(this.BARS).fill(0.04));
  },

  _loop() {
    const analyser = AudioEngine.analyser;
    const heights = new Array(this.BARS);

    if (analyser) {
      const n = analyser.fftSize;
      const buf = new Uint8Array(n);
      analyser.getByteTimeDomainData(buf);
      const per = Math.floor(n / this.BARS);
      for (let b = 0; b < this.BARS; b++) {
        let peak = 0;
        for (let j = 0; j < per; j++) {
          const dev = Math.abs(buf[b * per + j] - 128) / 128;
          if (dev > peak) peak = dev;
        }
        heights[b] = peak;
      }
    } else {
      // Idle shimmer so the meter reads as "live".
      const t = performance.now() / 600;
      for (let b = 0; b < this.BARS; b++) {
        heights[b] = 0.03 + Math.abs(Math.sin(b * 0.5 + t)) * 0.03;
      }
    }

    this._drawBars(heights);
    this.raf = requestAnimationFrame(() => this._loop());
  },
};

/* ═══════════════════════════════════════════════════════════════
   UI
   ═══════════════════════════════════════════════════════════════ */

const UI = {
  cells: new Map(),       // char → cell element
  showPatterns: false,
  locked: false,          // input lock during the post-correct pause

  init() {
    this.grid       = document.getElementById('grid');
    this.prompt     = document.getElementById('prompt');
    this.feedback   = document.getElementById('feedback');
    this.replayBtn  = document.getElementById('replay-btn');
    this.skipBtn    = document.getElementById('skip-btn');
    this.toggle     = document.getElementById('patterns-toggle');
    this.modeSelect = document.getElementById('mode-select');

    this.elScore    = document.getElementById('stat-score');
    this.elStreak   = document.getElementById('stat-streak');
    this.elBest     = document.getElementById('stat-best');
    this.elAccuracy = document.getElementById('stat-accuracy');

    this._bindControls();
    this._bindKeyboard();
    this._bindAbout();
    this._bindUnlock();

    Scope.init();
    this.buildGrid();
    this.newRound(/* autoplay */ false);  // wait for first user gesture to play
  },

  // ── Controls ────────────────────────────────────────────────

  _bindControls() {
    this.replayBtn.addEventListener('click', () => this.playCurrent());
    this.skipBtn.addEventListener('click', () => this.newRound(true));

    this.toggle.addEventListener('change', () => {
      this.showPatterns = this.toggle.checked;
      this.cells.forEach((cell) => cell.classList.toggle('show-pattern', this.showPatterns));
    });

    this.modeSelect.addEventListener('change', () => {
      Game.setMode(this.modeSelect.value);
      this.buildGrid();
      this.newRound(true);
    });

    document.getElementById('reset-btn').addEventListener('click', () => {
      Game.resetStats();
      this.refreshStats();
    });
  },

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (!document.getElementById('about-overlay').hidden) return; // dialog open
      const k = e.key.toUpperCase();
      if (k === 'R' || e.key === ' ') { e.preventDefault(); this.playCurrent(); return; }
      if (e.key === 'Enter') { this.newRound(true); return; }
      if (MORSE[k] && Game.characters().includes(k)) {
        e.preventDefault();
        this.onGuess(k);
      }
    });
  },

  // Resume audio on the first interaction (browsers block audio until then).
  _bindUnlock() {
    const unlock = () => {
      if (!AudioEngine.unlocked) {
        AudioEngine.ensure();
        if (Game.roundActive) this.playCurrent();
        this.prompt.textContent = 'Listen and choose the letter';
      }
    };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
  },

  // ── Grid ─────────────────────────────────────────────────────

  buildGrid() {
    this.grid.innerHTML = '';
    this.cells.clear();

    const chars = Game.characters();
    const cols = chars.length <= 10 ? 5 : 6;
    this.grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

    for (const c of chars) {
      const cell = document.createElement('button');
      cell.className = 'cell' + (this.showPatterns ? ' show-pattern' : '');
      cell.type = 'button';
      cell.setAttribute('aria-label', `Letter ${c}`);

      const glyph = document.createElement('span');
      glyph.className = 'cell-glyph';
      glyph.textContent = c;

      const pat = document.createElement('span');
      pat.className = 'cell-pattern';
      pat.textContent = MorseCodec.forChar(c);

      cell.append(glyph, pat);
      cell.addEventListener('click', () => this.onGuess(c));
      this.grid.appendChild(cell);
      this.cells.set(c, cell);
    }
  },

  // ── Rounds ───────────────────────────────────────────────────

  newRound(autoplay) {
    this.locked = false;
    this.cells.forEach((cell) => cell.classList.remove('correct', 'wrong'));
    this.setFeedback('', '');
    Game.newRound();
    if (autoplay && AudioEngine.unlocked) this.playCurrent();
  },

  playCurrent() {
    if (!Game.targetMorse) return;
    AudioEngine.ensure();
    this.replayBtn.disabled = true;
    AudioEngine.play(Game.targetMorse).then(() => {
      this.replayBtn.disabled = false;
    });
  },

  onGuess(c) {
    if (this.locked || !Game.roundActive) return;
    const result = Game.guess(c);
    if (!result) return;

    const cell = this.cells.get(c);
    this.refreshStats();

    if (result.correct) {
      this.locked = true;
      cell.classList.add('correct');
      this.setFeedback(`Correct — ${result.target} is ${result.morse}`, 'correct');
      setTimeout(() => this.newRound(true), 1050);
    } else {
      cell.classList.add('wrong');
      this.setFeedback(`Not ${result.guessed} — try again`, 'wrong');
      setTimeout(() => cell.classList.remove('wrong'), 360);
    }
  },

  // ── Feedback + stats ─────────────────────────────────────────

  setFeedback(text, kind) {
    this.feedback.textContent = text || '\u00A0';
    this.feedback.className = 'feedback' + (kind ? ' is-' + kind : '');
  },

  refreshStats() {
    const s = Game.stats;
    this.elScore.textContent = s.correct;
    this.elStreak.textContent = s.streak;
    this.elBest.textContent = s.best;
    const acc = Game.accuracy();
    this.elAccuracy.textContent = acc === null ? '\u2014' : `${Math.round(acc)}%`;
  },

  // ── About dialog ─────────────────────────────────────────────

  _bindAbout() {
    const overlay = document.getElementById('about-overlay');
    const open = () => { overlay.hidden = false; };
    const close = () => { overlay.hidden = true; };
    document.getElementById('about-btn').addEventListener('click', open);
    document.getElementById('about-close').addEventListener('click', close);
    document.getElementById('about-ok').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  },
};

/* ═══════════════════════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  UI.init();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* offline support is best-effort; the app works without it */
    });
  }
});
