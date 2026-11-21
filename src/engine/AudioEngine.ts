import type { MusicIntensity } from '../types/game';

/**
 * Procedural Web Audio synthesizer delivering an adaptive dark synthwave/industrial
 * soundtrack inspired by Cyberpunk 2077 ("The Rebel Path") plus punchy weapon,
 * Sandevistan, Lev Smasher, ECG monitor, and Soulkiller sound effects.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private masterVolume = 0.65;
  private intensity: MusicIntensity = 'silent';
  private stepTimer: number | null = null;
  private stepIndex = 0;
  private sandevistanPitchScale = 1.0;
  private paused = false;

  // D minor cyberpunk bassline (Hz)
  private readonly bassPatternCombat = [
    73.42, 73.42, 87.31, 73.42, 65.41, 73.42, 110.0, 98.0,
    73.42, 73.42, 87.31, 73.42, 116.54, 110.0, 98.0, 87.31,
  ];
  private readonly bassPatternBoss = [
    55.0, 55.0, 65.41, 55.0, 73.42, 55.0, 82.41, 77.78,
    55.0, 55.0, 65.41, 55.0, 98.0, 87.31, 82.41, 65.41,
  ];
  private readonly leadArp = [
    293.66, 0, 349.23, 440.0, 0, 392.0, 349.23, 329.63,
    293.66, 0, 440.0, 523.25, 0, 466.16, 440.0, 349.23,
  ];

  unlock(): void {
    this.paused = false;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this.masterVolume;
    master.connect(ctx.destination);
    this.masterGain = master;

    const music = ctx.createGain();
    music.gain.value = 0.36;
    music.connect(master);
    this.musicGain = music;

    const sfx = ctx.createGain();
    sfx.gain.value = 0.82;
    sfx.connect(master);
    this.sfxGain = sfx;

    this.noiseBuffer = this.createNoiseBuffer(ctx, 1.5);
    this.startSequencer();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!this.ctx) return;
    if (paused && this.ctx.state === 'running') {
      void this.ctx.suspend();
    } else if (!paused && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  private createNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  setVolume(value: number): void {
    this.masterVolume = Math.max(0, Math.min(1, value));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.04);
    }
  }

  setSandevistanMode(active: boolean): void {
    this.sandevistanPitchScale = active ? 0.68 : 1.0;
  }

  setMusicIntensity(mode: MusicIntensity): void {
    this.intensity = mode;
  }

  private startSequencer(): void {
    if (this.stepTimer !== null) return;
    // 16th-note pulse (~124 BPM -> ~120ms)
    this.stepTimer = window.setInterval(() => {
      this.tickMusic();
    }, 122);
  }

  private tickMusic(): void {
    if (this.paused || !this.ctx || !this.musicGain || this.ctx.state !== 'running') return;
    if (this.intensity === 'silent') return;

    const now = this.ctx.currentTime;
    const step = this.stepIndex % 16;
    this.stepIndex++;

    if (this.intensity === 'operating') {
      // Sparse sterile heartbeat & eerie dark drone
      if (step === 0 || step === 8) {
        this.playEcgBeep(step === 0 ? 880 : 840, 0.14, true);
      }
      if (step === 0) {
        this.playDrone(55, 1.8, 0.14);
      }
      return;
    }

    if (this.intensity === 'soulkiller') {
      // Escalating dissonant harmonic swarm
      if (step % 2 === 0) {
        const freq = 110 + ((this.stepIndex * 19) % 240);
        this.playSynthNote(freq, 'sawtooth', 0.22, 0.14, 1400);
      }
      if (step % 4 === 0) {
        this.playKick(now, 0.35);
      }
      return;
    }

    const pitch = this.sandevistanPitchScale;
    const isBoss = this.intensity === 'boss';
    const isCombat = this.intensity === 'combat' || isBoss;

    // Bassline
    const pattern = isBoss ? this.bassPatternBoss : this.bassPatternCombat;
    const bassFreq = pattern[step] * pitch;
    if (this.intensity === 'title' || this.intensity === 'ambient') {
      if (step % 2 === 0) {
        this.playSynthNote(bassFreq, 'sawtooth', 0.22, 0.16, 420);
      }
      if (step === 0) {
        this.playDrone(73.42 * pitch, 1.9, 0.13);
      }
    } else if (isCombat) {
      this.playSynthNote(bassFreq, 'sawtooth', 0.13, isBoss ? 0.30 : 0.24, isBoss ? 1200 : 880);
      if (step % 4 === 0) {
        this.playKick(now, isBoss ? 0.52 : 0.4);
      }
      if (step % 8 === 4) {
        this.playSnare(now, isBoss ? 0.30 : 0.22);
      }
      if (step % 2 === 1) {
        this.playHat(now, 0.06);
      }
      const lead = this.leadArp[step];
      if (lead > 0 && (isBoss || (this.stepIndex >> 4) % 2 === 1)) {
        this.playSynthNote(lead * pitch, 'square', 0.11, isBoss ? 0.11 : 0.08, 1900);
      }
    }
  }

  private playSynthNote(
    freq: number,
    type: OscillatorType,
    duration: number,
    gainVal: number,
    cutoff: number,
  ): void {
    if (!this.ctx || !this.musicGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * 0.25), now + duration);
    filter.Q.value = 3.5;

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(gainVal, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private playDrone(freq: number, duration: number, gainVal: number): void {
    if (!this.ctx || !this.musicGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(gainVal, now + 0.35);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(this.musicGain);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  private playKick(now: number, volume: number): void {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(145, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.11);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(gain);
    gain.connect(this.musicGain);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  private playSnare(now: number, volume: number): void {
    if (!this.ctx || !this.musicGain || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1600;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    src.start(now);
    src.stop(now + 0.13);
  }

  private playHat(now: number, volume: number): void {
    if (!this.ctx || !this.musicGain || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 6500;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    src.start(now);
    src.stop(now + 0.05);
  }

  // --- Gameplay SFX ---

  playMalorianShot(): void {
    if (!this.ctx || !this.sfxGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;

    // Heavy low-end cannon punch
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(210 * this.sandevistanPitchScale, now);
    sub.frequency.exponentialRampToValueAtTime(38, now + 0.14);
    subGain.gain.setValueAtTime(0.75, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    sub.connect(subGain);
    subGain.connect(this.sfxGain);
    sub.start(now);
    sub.stop(now + 0.17);

    // Metallic gunshot crack
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1400, now);
    bp.Q.value = 0.8;
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.55, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
    noise.connect(bp);
    bp.connect(nGain);
    nGain.connect(this.sfxGain);
    noise.start(now);
    noise.stop(now + 0.2);

    // Cyberpunk high-tech transient ping
    const ping = this.ctx.createOscillator();
    const pGain = this.ctx.createGain();
    ping.type = 'sawtooth';
    ping.frequency.setValueAtTime(920 * this.sandevistanPitchScale, now);
    ping.frequency.exponentialRampToValueAtTime(260, now + 0.08);
    pGain.gain.setValueAtTime(0.18, now);
    pGain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
    ping.connect(pGain);
    pGain.connect(this.sfxGain);
    ping.start(now);
    ping.stop(now + 0.09);
  }

  playFlameMelee(): void {
    if (!this.ctx || !this.sfxGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'bandpass';
    lp.frequency.setValueAtTime(420, now);
    lp.frequency.exponentialRampToValueAtTime(1800, now + 0.12);
    lp.frequency.exponentialRampToValueAtTime(260, now + 0.42);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.65, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    src.connect(lp);
    lp.connect(gain);
    gain.connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.46);
  }

  playReload(): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const clicks = [0, 0.22, 0.56];
    const freqs = [520, 740, 1080];
    clicks.forEach((offset, idx) => {
      if (!this.ctx || !this.sfxGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freqs[idx], now + offset);
      osc.frequency.exponentialRampToValueAtTime(freqs[idx] * 0.5, now + offset + 0.05);
      gain.gain.setValueAtTime(0.22, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.06);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now + offset);
      osc.stop(now + offset + 0.065);
    });
  }

  playHitMarker(headshot: boolean): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = headshot ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(headshot ? 1750 : 980, now);
    osc.frequency.exponentialRampToValueAtTime(headshot ? 2450 : 620, now + 0.06);
    gain.gain.setValueAtTime(headshot ? 0.34 : 0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  playSandevistan(activate: boolean): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    if (activate) {
      osc.frequency.setValueAtTime(640, now);
      osc.frequency.exponentialRampToValueAtTime(75, now + 0.42);
    } else {
      osc.frequency.setValueAtTime(95, now);
      osc.frequency.exponentialRampToValueAtTime(520, now + 0.28);
    }
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.44);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.46);
  }

  playDash(): void {
    if (!this.ctx || !this.sfxGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(220, now + 0.18);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.2);
  }

  playMaxDoc(): void {
    if (!this.ctx || !this.sfxGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    // Pressurized hiss
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2600;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.26, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    src.connect(hp);
    hp.connect(gain);
    gain.connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.28);

    // Chime
    const osc = this.ctx.createOscillator();
    const g2 = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now + 0.08);
    osc.frequency.exponentialRampToValueAtTime(1040, now + 0.25);
    g2.gain.setValueAtTime(0.18, now + 0.08);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(g2);
    g2.connect(this.sfxGain);
    osc.start(now + 0.08);
    osc.stop(now + 0.32);
  }

  playEnemyShot(heavy = false): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = heavy ? 'sawtooth' : 'square';
    osc.frequency.setValueAtTime((heavy ? 240 : 480) * this.sandevistanPitchScale, now);
    osc.frequency.exponentialRampToValueAtTime(heavy ? 65 : 140, now + 0.09);
    gain.gain.setValueAtTime(heavy ? 0.22 : 0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  playPlayerHurt(heavy = false): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(heavy ? 115 : 165, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + (heavy ? 0.35 : 0.16));
    gain.gain.setValueAtTime(heavy ? 0.55 : 0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (heavy ? 0.38 : 0.18));
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + (heavy ? 0.4 : 0.2));
  }

  playExplosion(big = false): void {
    if (!this.ctx || !this.sfxGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const dur = big ? 0.85 : 0.42;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(big ? 750 : 950, now);
    lp.frequency.exponentialRampToValueAtTime(65, now + dur);
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(big ? 0.72 : 0.45, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(lp);
    lp.connect(nGain);
    nGain.connect(this.sfxGain);
    src.start(now);
    src.stop(now + dur + 0.05);

    const sub = this.ctx.createOscillator();
    const sGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(big ? 110 : 140, now);
    sub.frequency.exponentialRampToValueAtTime(24, now + dur * 0.8);
    sGain.gain.setValueAtTime(big ? 0.8 : 0.5, now);
    sGain.gain.exponentialRampToValueAtTime(0.001, now + dur * 0.85);
    sub.connect(sGain);
    sGain.connect(this.sfxGain);
    sub.start(now);
    sub.stop(now + dur);
  }

  playSmasherRoar(): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    for (const detune of [-12, 0, 15]) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(92, now);
      osc.detune.value = detune;
      osc.frequency.linearRampToValueAtTime(58, now + 0.75);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 460;
      gain.gain.setValueAtTime(0.24, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.82);
      osc.connect(lp);
      lp.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.85);
    }
  }

  playTinnitus(durationSec = 2.6): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(3420, now);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + durationSec + 0.05);
  }

  playHoloChime(): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const notes = [660, 880, 1320];
    notes.forEach((f, i) => {
      if (!this.ctx || !this.sfxGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + i * 0.065);
      gain.gain.setValueAtTime(0.13, now + i * 0.065);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.065 + 0.18);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now + i * 0.065);
      osc.stop(now + i * 0.065 + 0.2);
    });
  }

  playTerminalHack(): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const notes = [440, 587.33, 880, 1174.66];
    notes.forEach((f, i) => {
      if (!this.ctx || !this.sfxGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now + i * 0.075);
      gain.gain.setValueAtTime(0.2, now + i * 0.075);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.075 + 0.14);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now + i * 0.075);
      osc.stop(now + i * 0.075 + 0.16);
    });
  }

  playEcgBeep(freq = 880, volume = 0.09, toMusic = false): void {
    const dest = toMusic ? this.musicGain : this.sfxGain;
    if (!this.ctx || !dest) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  playSoulkillerSurge(durationSec = 4.5): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = 'sawtooth';
    osc2.type = 'square';
    osc1.frequency.setValueAtTime(75, now);
    osc1.frequency.exponentialRampToValueAtTime(980, now + durationSec);
    osc2.frequency.setValueAtTime(112, now);
    osc2.frequency.exponentialRampToValueAtTime(1520, now + durationSec);

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(300, now);
    bp.frequency.exponentialRampToValueAtTime(3200, now + durationSec);
    bp.Q.value = 2.4;

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.32, now + durationSec * 0.75);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec + 0.4);

    osc1.connect(bp);
    osc2.connect(bp);
    bp.connect(gain);
    gain.connect(this.sfxGain);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + durationSec + 0.45);
    osc2.stop(now + durationSec + 0.45);
  }

  playElevatorDing(): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const tones = [
      { freq: 1046.5, delay: 0, dur: 0.55 },
      { freq: 1318.5, delay: 0.14, dur: 0.72 },
    ];
    for (const t of tones) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(t.freq, now + t.delay);
      gain.gain.setValueAtTime(0.001, now + t.delay);
      gain.gain.linearRampToValueAtTime(0.24, now + t.delay + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + t.delay + t.dur);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now + t.delay);
      osc.stop(now + t.delay + t.dur + 0.04);
    }
  }

  playElevatorFloorTick(): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1480, now);
    gain.gain.setValueAtTime(0.045, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.032);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.04);
  }

  playElevatorRide(durationSec = 4.2): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const dur = Math.max(1.0, durationSec);

    // Low mechanical maglev hum with smooth acceleration and deceleration pitch curve
    const hum = this.ctx.createOscillator();
    const whine = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    hum.type = 'sawtooth';
    hum.frequency.setValueAtTime(48, now);
    hum.frequency.linearRampToValueAtTime(74, now + dur * 0.28);
    hum.frequency.setValueAtTime(74, now + dur * 0.72);
    hum.frequency.linearRampToValueAtTime(44, now + dur);

    whine.type = 'sine';
    whine.frequency.setValueAtTime(160, now);
    whine.frequency.linearRampToValueAtTime(340, now + dur * 0.3);
    whine.frequency.setValueAtTime(340, now + dur * 0.72);
    whine.frequency.linearRampToValueAtTime(140, now + dur);

    filter.type = 'lowpass';
    filter.frequency.value = 460;

    const fadeInEnd = Math.min(0.35, dur * 0.25);
    const fadeOutStart = Math.max(fadeInEnd + 0.05, dur - 0.55);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.16, now + fadeInEnd);
    gain.gain.setValueAtTime(0.15, now + fadeOutStart);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    hum.connect(filter);
    whine.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    hum.start(now);
    whine.start(now);
    hum.stop(now + dur + 0.05);
    whine.stop(now + dur + 0.05);
  }

  dispose(): void {
    if (this.stepTimer !== null) {
      window.clearInterval(this.stepTimer);
      this.stepTimer = null;
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
