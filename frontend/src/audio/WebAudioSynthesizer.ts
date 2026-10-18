export type SoundscapeMode = 'cinematic' | 'haptics';
export type AudioInteraction = 'camera' | 'chaos' | 'rack';

export interface AudioTelemetryInput {
  frequencyHz: number;
  computeShedMw: number;
  batteryInjectionMw: number;
  auditorState: string;
  streamStatus: string;
  contingencyActive: boolean;
  sentinelAlert: boolean;
  transformerTemperatureCelsius: number;
}

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(Math.max(value, minimum), maximum);

const createSoftTapeCurve = (): Float32Array => {
  const curve = new Float32Array(1024);
  for (let index = 0; index < curve.length; index += 1) {
    const x = (index * 2) / (curve.length - 1) - 1;
    curve[index] = Math.tanh(x * 1.35) * 0.78;
  }
  return curve;
};

/** Warm, low-fatigue native Web Audio synthesis graph for the AETHERGRID deck. */
export class WebAudioSynthesizer {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private ambientBus: GainNode | null = null;
  private hapticsBus: GainNode | null = null;
  private alarmBus: GainNode | null = null;
  private ambientOscillators: OscillatorNode[] = [];
  private alarmOscillators: OscillatorNode[] = [];
  private ambientGains: GainNode[] = [];
  private ambientFilter: BiquadFilterNode | null = null;
  private alarmFilter: BiquadFilterNode | null = null;
  private alarmPulse: OscillatorNode | null = null;
  private alarmPulseDepth: GainNode | null = null;
  private chorusLfo: OscillatorNode | null = null;
  private chorusDepth: GainNode | null = null;
  private chorusDelays: DelayNode[] = [];
  private tapeWarmth: WaveShaperNode | null = null;
  private transientSources = new Set<AudioScheduledSourceNode>();
  private volume = 0.24;
  private muted = false;
  private soundscape: SoundscapeMode = 'cinematic';
  private lastTelemetry: AudioTelemetryInput | null = null;
  private enabled = false;

  get isEnabled(): boolean {
    return this.enabled;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get masterVolume(): number {
    return this.volume;
  }

  get activeSoundscape(): SoundscapeMode {
    return this.soundscape;
  }

  async enable(): Promise<void> {
    if (!this.context) this.createGraph();
    if (!this.context || !this.masterGain) return;
    await this.context.resume();
    this.enabled = true;
    this.rampMasterGain();
    this.applySoundscapeMix();
  }

  setVolume(volume: number): void {
    this.volume = clamp(volume, 0, 1);
    this.rampMasterGain();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.rampMasterGain();
  }

  setSoundscape(soundscape: SoundscapeMode): void {
    this.soundscape = soundscape;
    this.applySoundscapeMix();
  }

  playInteraction(interaction: AudioInteraction): void {
    if (!this.context || !this.hapticsBus || this.muted) return;
    const profile: Record<AudioInteraction, { startFrequency: number; endFrequency: number; peak: number; duration: number }> = {
      camera: { startFrequency: 1_080, endFrequency: 760, peak: 0.04, duration: 0.11 },
      chaos: { startFrequency: 220, endFrequency: 92, peak: 0.065, duration: 0.2 },
      rack: { startFrequency: 1_460, endFrequency: 980, peak: 0.048, duration: 0.13 },
    };
    const selected = profile[interaction];
    this.playInteractionTone(selected.startFrequency, selected.endFrequency, selected.peak, selected.duration);
  }

  update(telemetry: AudioTelemetryInput): void {
    const previous = this.lastTelemetry;
    this.lastTelemetry = telemetry;
    if (!this.context || !this.enabled) return;

    const now = this.context.currentTime;
    const frequencyRatio = clamp(telemetry.frequencyHz / 60, 0.82, 1.18);
    this.ambientOscillators.forEach((oscillator, index) => {
      const base = index === 0 ? 55 : index === 1 ? 82.5 : 110;
      oscillator.frequency.setTargetAtTime(base * frequencyRatio, now, 0.16);
    });

    const alarmActive = telemetry.streamStatus === 'LIVE' && (
      telemetry.frequencyHz < 59.8
      || telemetry.sentinelAlert
      || telemetry.transformerTemperatureCelsius > 125
      || (telemetry.contingencyActive && telemetry.auditorState !== 'CONVERGED')
    );
    const alarmTarget = alarmActive ? 0.055 : 0;
    this.alarmBus?.gain.setTargetAtTime(alarmTarget, now, alarmActive ? 0.25 : 0.6);
    this.alarmPulseDepth?.gain.setTargetAtTime(alarmActive ? 0.026 : 0, now, 0.2);
    this.alarmOscillators.forEach((oscillator, index) => {
      const base = index === 0 ? 110 : index === 1 ? 164.81 : 329.63;
      oscillator.frequency.setTargetAtTime(base * (1 + (60 - telemetry.frequencyHz) * 0.008), now, 0.2);
    });

    if (previous && telemetry.computeShedMw > previous.computeShedMw + 0.25) {
      this.playCrystalClick();
    }
    if (previous && telemetry.batteryInjectionMw > previous.batteryInjectionMw + 10) {
      this.playDistantRumble();
    }
    if (previous && previous.auditorState !== 'CONVERGED' && telemetry.auditorState === 'CONVERGED') {
      this.playResolutionChord();
    }
  }

  dispose(): void {
    this.ambientOscillators.forEach((oscillator) => this.stopSource(oscillator));
    this.alarmOscillators.forEach((oscillator) => this.stopSource(oscillator));
    this.stopSource(this.alarmPulse);
    this.stopSource(this.chorusLfo);
    this.transientSources.forEach((source) => this.stopSource(source));
    this.transientSources.clear();
    this.context?.close();
    this.context = null;
    this.enabled = false;
    this.ambientOscillators = [];
    this.alarmOscillators = [];
    this.ambientGains = [];
    this.chorusDelays = [];
    this.alarmPulse = null;
    this.chorusLfo = null;
  }

  private createGraph(): void {
    const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextConstructor) return;
    const context = new AudioContextConstructor();
    this.context = context;

    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 18;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.018;
    compressor.release.value = 0.28;
    compressor.connect(context.destination);
    this.compressor = compressor;

    const masterGain = context.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(compressor);
    this.masterGain = masterGain;

    const tapeWarmth = context.createWaveShaper();
    tapeWarmth.curve = createSoftTapeCurve();
    tapeWarmth.oversample = '2x';
    tapeWarmth.connect(masterGain);
    this.tapeWarmth = tapeWarmth;

    const ambientBus = context.createGain();
    ambientBus.gain.value = 0.72;
    const ambientFilter = context.createBiquadFilter();
    ambientFilter.type = 'lowpass';
    ambientFilter.frequency.value = 620;
    ambientFilter.Q.value = 0.85;
    ambientBus.connect(ambientFilter);
    ambientFilter.connect(tapeWarmth);
    this.ambientBus = ambientBus;
    this.ambientFilter = ambientFilter;

    const chorusLfo = context.createOscillator();
    chorusLfo.type = 'sine';
    chorusLfo.frequency.value = 0.18;
    const chorusDepth = context.createGain();
    chorusDepth.gain.value = 0.0045;
    chorusLfo.connect(chorusDepth);
    chorusLfo.start();
    this.chorusLfo = chorusLfo;
    this.chorusDepth = chorusDepth;

    [55, 82.5, 110].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = index === 1 ? 'triangle' : 'sine';
      oscillator.frequency.value = frequency;
      oscillator.detune.value = index === 0 ? -4 : index === 2 ? 5 : 0;
      const voiceGain = context.createGain();
      voiceGain.gain.value = index === 0 ? 0.11 : index === 1 ? 0.045 : 0.025;
      const panner = context.createStereoPanner();
      panner.pan.value = index === 0 ? -0.24 : index === 2 ? 0.24 : 0;
      const chorusDelay = context.createDelay(0.08);
      chorusDelay.delayTime.value = 0.022 + index * 0.004;
      chorusDepth.connect(chorusDelay.delayTime);
      oscillator.connect(voiceGain);
      voiceGain.connect(panner);
      panner.connect(ambientBus);
      panner.connect(chorusDelay);
      chorusDelay.connect(ambientBus);
      oscillator.start();
      this.ambientOscillators.push(oscillator);
      this.ambientGains.push(voiceGain);
      this.chorusDelays.push(chorusDelay);
    });

    const hapticsBus = context.createGain();
    hapticsBus.gain.value = 0.8;
    hapticsBus.connect(tapeWarmth);
    this.hapticsBus = hapticsBus;

    const alarmBus = context.createGain();
    alarmBus.gain.value = 0;
    const alarmFilter = context.createBiquadFilter();
    alarmFilter.type = 'lowpass';
    alarmFilter.frequency.value = 760;
    alarmFilter.Q.value = 1.4;
    alarmBus.connect(alarmFilter);
    alarmFilter.connect(tapeWarmth);
    this.alarmBus = alarmBus;
    this.alarmFilter = alarmFilter;

    [110, 164.81, 329.63].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = index === 2 ? 'sine' : 'triangle';
      oscillator.frequency.value = frequency;
      const gain = context.createGain();
      gain.gain.value = index === 0 ? 0.17 : index === 1 ? 0.085 : 0.035;
      oscillator.connect(gain);
      gain.connect(alarmBus);
      oscillator.start();
      this.alarmOscillators.push(oscillator);
    });

    const alarmPulse = context.createOscillator();
    alarmPulse.type = 'sine';
    alarmPulse.frequency.value = 0.48;
    const alarmPulseDepth = context.createGain();
    alarmPulseDepth.gain.value = 0;
    alarmPulse.connect(alarmPulseDepth);
    alarmPulseDepth.connect(alarmBus.gain);
    alarmPulse.start();
    this.alarmPulse = alarmPulse;
    this.alarmPulseDepth = alarmPulseDepth;
  }

  private applySoundscapeMix(): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    const ambientTarget = this.soundscape === 'cinematic' ? 1 : 0;
    const hapticsTarget = this.soundscape === 'haptics' ? 1 : 0.7;
    const alarmTarget = this.soundscape === 'haptics' ? 0.7 : 1;
    this.ambientBus?.gain.setTargetAtTime(ambientTarget, now, 0.45);
    this.hapticsBus?.gain.setTargetAtTime(hapticsTarget, now, 0.22);
    const alarmActive = this.lastTelemetry !== null && (
      this.lastTelemetry.frequencyHz < 59.8
      || this.lastTelemetry.sentinelAlert
      || this.lastTelemetry.transformerTemperatureCelsius > 125
      || (this.lastTelemetry.contingencyActive && this.lastTelemetry.auditorState !== 'CONVERGED')
    );
    this.alarmBus?.gain.setTargetAtTime(alarmActive ? 0.055 * alarmTarget : 0, now, 0.22);
    if (this.alarmFilter) this.alarmFilter.frequency.setTargetAtTime(540 + alarmTarget * 220, now, 0.3);
    this.rampMasterGain();
  }

  private rampMasterGain(): void {
    if (!this.context || !this.masterGain) return;
    const target = this.enabled && !this.muted ? this.volume : 0;
    this.masterGain.gain.setTargetAtTime(target, this.context.currentTime, 0.14);
  }

  private playCrystalClick(): void {
    if (!this.context || !this.hapticsBus || this.muted) return;
    this.playInteractionTone(1_320, 880, 0.055, 0.14);
  }

  private playInteractionTone(startFrequency: number, endFrequency: number, peak: number, duration: number): void {
    if (!this.context || !this.hapticsBus || this.muted) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(startFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration * 0.61);
    filter.type = 'highpass';
    filter.frequency.value = Math.min(startFrequency * 0.48, 760);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.hapticsBus);
    this.trackTransient(oscillator, now + duration + 0.02);
  }

  private playDistantRumble(): void {
    if (!this.context || !this.hapticsBus || this.muted) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(43, now);
    oscillator.frequency.exponentialRampToValueAtTime(31, now + 0.7);
    filter.type = 'lowpass';
    filter.frequency.value = 105;
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.095, now + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.hapticsBus);
    this.trackTransient(oscillator, now + 1.0);
  }

  private playResolutionChord(): void {
    if (!this.context || !this.hapticsBus || this.muted) return;
    const now = this.context.currentTime;
    [261.63, 329.63, 392, 523.25].forEach((frequency, index) => {
      const oscillator = this.context!.createOscillator();
      const gain = this.context!.createGain();
      oscillator.type = index === 3 ? 'sine' : 'triangle';
      oscillator.frequency.value = frequency;
      const start = now + index * 0.07;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.06, start + 0.07);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.85);
      oscillator.connect(gain);
      gain.connect(this.hapticsBus!);
      this.trackTransient(oscillator, start + 0.9);
    });
  }

  private trackTransient(source: OscillatorNode, stopAt: number): void {
    this.transientSources.add(source);
    source.onended = () => this.transientSources.delete(source);
    source.start(this.context!.currentTime);
    source.stop(stopAt);
  }

  private stopSource(source: AudioScheduledSourceNode | null): void {
    if (!source) return;
    try {
      source.stop();
    } catch {
      // A scheduled transient can already be stopped during React cleanup.
    }
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
