/**
 * Original Web Audio chimes. Mute persists via the game (localStorage).
 */
(function (root) {
  "use strict";

  function AudioBus() {
    this.ctx = null;
    this.muted = false;
    this._unlocked = false;
  }

  AudioBus.prototype._ensure = function () {
    if (this.muted) return null;
    if (!this.ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  };

  AudioBus.prototype.unlock = function () {
    var ctx = this._ensure();
    if (ctx && !this._unlocked) {
      var b = ctx.createBuffer(1, 1, 22050);
      var s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
      this._unlocked = true;
    }
  };

  AudioBus.prototype.setMuted = function (m) {
    this.muted = !!m;
    if (this.muted && this.ctx && this.ctx.state === "running") {
      /* keep context, just skip tones */
    }
  };

  AudioBus.prototype._tone = function (freq, type, start, dur, gain, endFreq) {
    var ctx = this._ensure();
    if (!ctx) return;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), ctx.currentTime + start + dur);
    g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
    g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + dur + 0.02);
  };

  AudioBus.prototype.select = function () {
    this._tone(620, "triangle", 0, 0.07, 0.08);
  };
  AudioBus.prototype.match = function () {
    this._tone(523.25, "triangle", 0, 0.12, 0.11);
    this._tone(659.25, "triangle", 0.07, 0.14, 0.11);
    this._tone(783.99, "sine", 0.14, 0.18, 0.09);
  };
  AudioBus.prototype.combo = function (n) {
    var base = 523.25 + Math.min(n, 8) * 40;
    this._tone(base, "triangle", 0, 0.1, 0.1);
    this._tone(base * 1.25, "triangle", 0.06, 0.12, 0.1);
    this._tone(base * 1.5, "sine", 0.12, 0.2, 0.08);
  };
  AudioBus.prototype.fail = function () {
    this._tone(240, "square", 0, 0.14, 0.05, 140);
  };
  AudioBus.prototype.mismatch = function () {
    this._tone(300, "triangle", 0, 0.08, 0.05);
  };
  AudioBus.prototype.hint = function () {
    this._tone(880, "sine", 0, 0.1, 0.07);
    this._tone(1174, "sine", 0.1, 0.16, 0.06);
  };
  AudioBus.prototype.shuffle = function () {
    this._tone(400, "triangle", 0, 0.08, 0.06);
    this._tone(500, "triangle", 0.08, 0.08, 0.06);
    this._tone(350, "triangle", 0.16, 0.1, 0.06);
  };
  AudioBus.prototype.levelStart = function () {
    this._tone(392, "triangle", 0, 0.12, 0.08);
    this._tone(523, "triangle", 0.12, 0.14, 0.08);
    this._tone(659, "sine", 0.24, 0.2, 0.07);
  };
  AudioBus.prototype.levelClear = function () {
    this._tone(523, "triangle", 0, 0.12, 0.1);
    this._tone(659, "triangle", 0.1, 0.12, 0.1);
    this._tone(784, "triangle", 0.2, 0.12, 0.1);
    this._tone(1046, "sine", 0.32, 0.28, 0.09);
  };
  AudioBus.prototype.gameOver = function () {
    this._tone(392, "triangle", 0, 0.2, 0.08, 300);
    this._tone(311, "triangle", 0.18, 0.25, 0.07, 220);
    this._tone(196, "sine", 0.36, 0.4, 0.06, 140);
  };
  AudioBus.prototype.win = function () {
    this._tone(523, "triangle", 0, 0.14, 0.1);
    this._tone(659, "triangle", 0.12, 0.14, 0.1);
    this._tone(784, "triangle", 0.24, 0.14, 0.1);
    this._tone(1046, "sine", 0.36, 0.18, 0.1);
    this._tone(1318, "sine", 0.5, 0.35, 0.08);
  };
  AudioBus.prototype.lifeLost = function () {
    this._tone(180, "sawtooth", 0, 0.22, 0.04, 90);
  };

  root.AudioBus = AudioBus;
})(typeof self !== "undefined" ? self : this);
