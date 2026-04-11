// Audio - Web Audio API sound generation (no audio files needed)

import { getMuted, setMuted } from './storage.js';

const MASTER_VOLUME = 0.3;

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this._initialized = false;
    this._windNode = null;
    this._windGain = null;
    this.muted = getMuted();
  }

  // Must be called from a user gesture (click/keypress)
  init() {
    if (this._initialized) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : MASTER_VOLUME;
      this.masterGain.connect(this.ctx.destination);
      this._initialized = true;
    } catch (e) {
      // Audio not available - silently degrade
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    setMuted(this.muted);
    if (this.masterGain) {
      this.masterGain.gain.value = this.muted ? 0 : MASTER_VOLUME;
    }
    return this.muted;
  }

  _ensureCtx() {
    if (!this._initialized) this.init();
    if (!this.ctx) return false;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return true;
  }

  // Attack swoosh - short noise sweep
  playAttack() {
    if (!this._ensureCtx()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.12);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  // Hit impact - short thud
  playHit() {
    if (!this._ensureCtx()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.08);
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  // Coin pickup - bright ascending tones
  playCoin() {
    if (!this._ensureCtx()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.setValueAtTime(900, t + 0.05);
    osc.frequency.setValueAtTime(1200, t + 0.1);
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  // Guard death - descending noise
  playGuardDeath() {
    if (!this._ensureCtx()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.3);
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.35);
  }

  // Dash whoosh - quick rising sine sweep
  playDash() {
    if (!this._ensureCtx()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.14);
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  // Player hurt - short distorted noise
  playPlayerHurt() {
    if (!this._ensureCtx()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.setValueAtTime(100, t + 0.05);
    osc.frequency.setValueAtTime(150, t + 0.1);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  // Start ambient wind loop
  startWind() {
    if (!this._ensureCtx()) return;
    if (this._windNode) return; // already playing

    // Use noise buffer for wind
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    this._windNode = this.ctx.createBufferSource();
    this._windNode.buffer = buffer;
    this._windNode.loop = true;

    // Low-pass filter for wind-like sound
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 200;
    filter.Q.value = 0.5;

    this._windGain = this.ctx.createGain();
    this._windGain.gain.value = 0.04;

    this._windNode.connect(filter);
    filter.connect(this._windGain);
    this._windGain.connect(this.masterGain);
    this._windNode.start();
  }

  stopWind() {
    if (this._windNode) {
      this._windNode.stop();
      this._windNode = null;
      this._windGain = null;
    }
  }
}
