export interface AudioTelemetryInput {
  frequencyHz: number;
  computeShedMw: number;
  batteryInjectionMw: number;
  auditorState: string;
  streamStatus: string;
  sentinelAlert: boolean;
  transformerTemperatureCelsius: number;
}

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(Math.max(value, minimum), maximum);

/** Native Web Audio synthesis graph for the AETHERGRID operations deck. */
export class WebAudioSynthesizer {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private baselineBus: GainNode | null = null;
  private alarmBus: GainNode | null = null;
  private alarmLowPass: BiquadFilterNode | null = null;
  private alarmLfoDepth: GainNode | null = null;
  private baselineOscillators: OscillatorNode[] = [];
  private alarmOscillators: OscillatorNode[] = [];
  private alarmLfo: OscillatorNode | null = null;
  private volume = 0.34;
  private muted = false;
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

  async enable(): Promise<void> {
    if (!this.context) this.createGraph();
    if (!this.context || !this.masterGain) return;
    await this.context.resume();
    this.enabled = true;
    this.rampMasterGain();
  }

  setVolume(volume: number): void {
    this.volume = clamp(volume, 0, 1);
    this.rampMasterGain();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.rampMasterGain();
  }

  update(telemetry: AudioTelemetryInput): void {
    const previous = this.lastTelemetry;
    this.lastTelemetry = telemetry;
    if (!this.context || !this.enabled) return;

    const now = this.context.currentTime;
    const frequency = clamp(telemetry.frequencyHz, 45, 75);
    this.baselineOscillators.forEach((oscillator, index) => {
      const harmonic = index === 0 ? 1 : index === 1 ? 3 : 5;
      oscillator.frequency.setTargetAtTime(frequency * harmonic, now, 0.045);
    });

    const alarmActive = telemetry.streamStatus === 'LIVE' && (
      telemetry.frequencyHz < 59.8
      || telemetry.sentinelAlert
      || telemetry.transformerTemperatureCelsius > 125
    );
    const alarmTarget = alarmActive ? 0.105 : 0;
    this.alarmBus?.gain.setTargetAtTime(alarmTarget, now, alarmActive ? 0.028 : 0.16);
    this.alarmLfoDepth?.gain.setTargetAtTime(alarmActive ? 0.055 : 0, now, 0.04);
    this.alarmOscillators.forEach((oscillator, index) => {
      const base = index === 0 ? 735 : 925;
      oscillator.frequency.setTargetAtTime(base + (60 - frequency) * 22, now, 0.04);
    });

    if (previous && telemetry.computeShedMw > previous.computeShedMw + 0.25) {
      this.playRelayClick();
    }
    if (previous && telemetry.batteryInjectionMw > previous.batteryInjectionMw + 10) {
      this.playBatteryRumble();
    }
    if (previous && previous.auditorState !== 'CONVERGED' && telemetry.auditorState === 'CONVERGED') {
      this.playStabilizationChime();
    }
  }

  dispose(): void {
    this.baselineOscillators.forEach((oscillator) => oscillator.stop());
    this.alarmOscillators.forEach((oscillator) => oscillator.stop());
    this.alarmLfo?.stop();
    this.context?.close();
    this.context = null;
    this.enabled = false;
    this.baselineOscillators = [];
    this.alarmOscillators = [];
    this.alarmLfo = null;
  }

  private createGraph(): void {
    const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextConstructor) return;
    const context = new AudioContextConstructor();
    this.context = context;

    const masterGain = context.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(context.destination);
    this.masterGain = masterGain;

    const baselineBus = context.createGain();
    baselineBus.gain.value = 0.12;
    baselineBus.connect(masterGain);
    this.baselineBus = baselineBus;

    [1, 3, 5].forEach((harmonic, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = index === 0 ? 'sine' : 'triangle';
      oscillator.frequency.value = 60 * harmonic;
      const gain = context.createGain();
      gain.gain.value = index === 0 ? 0.72 : index === 1 ? 0.11 : 0.045;
      oscillator.connect(gain);
      gain.connect(baselineBus);
      oscillator.start();
      this.baselineOscillators.push(oscillator);
    });

    const alarmBus = context.createGain();
    alarmBus.gain.value = 0;
    this.alarmBus = alarmBus;
    const alarmLowPass = context.createBiquadFilter();
    alarmLowPass.type = 'lowpass';
    alarmLowPass.frequency.value = 2_400;
    alarmLowPass.Q.value = 0.8;
    alarmBus.connect(alarmLowPass);
    alarmLowPass.connect(masterGain);
    this.alarmLowPass = alarmLowPass;

    [735, 925].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = index === 0 ? 'sawtooth' : 'square';
      oscillator.frequency.value = frequency;
      const gain = context.createGain();
      gain.gain.value = index === 0 ? 0.085 : 0.045;
      oscillator.connect(gain);
      gain.connect(alarmBus);
      oscillator.start();
      this.alarmOscillators.push(oscillator);
    });

    const alarmLfo = context.createOscillator();
    alarmLfo.type = 'square';
    alarmLfo.frequency.value = 1.45;
    const alarmLfoDepth = context.createGain();
    alarmLfoDepth.gain.value = 0;
    alarmLfo.connect(alarmLfoDepth);
    alarmLfoDepth.connect(alarmBus.gain);
    alarmLfo.start();
    this.alarmLfo = alarmLfo;
    this.alarmLfoDepth = alarmLfoDepth;
  }

  private rampMasterGain(): void {
    if (!this.context || !this.masterGain) return;
    const target = this.enabled && !this.muted ? this.volume : 0;
    this.masterGain.gain.setTargetAtTime(target, this.context.currentTime, 0.085);
  }

  private playRelayClick(): void {
    if (!this.context || !this.masterGain) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(1_900, now);
    oscillator.frequency.exponentialRampToValueAtTime(630, now + 0.055);
    filter.type = 'bandpass';
    filter.frequency.value = 1_200;
    filter.Q.value = 2.2;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    oscillator.start(now);
    oscillator.stop(now + 0.09);
  }

  private playBatteryRumble(): void {
    if (!this.context || !this.masterGain) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(46, now);
    oscillator.frequency.exponentialRampToValueAtTime(29, now + 0.42);
    filter.type = 'lowpass';
    filter.frequency.value = 110;
    filter.Q.value = 0.8;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.23, now + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.58);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    oscillator.start(now);
    oscillator.stop(now + 0.62);
  }

  private playStabilizationChime(): void {
    if (!this.context || !this.masterGain) return;
    const now = this.context.currentTime;
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      const oscillator = this.context!.createOscillator();
      const gain = this.context!.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      const start = now + index * 0.055;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.095, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);
      oscillator.connect(gain);
      gain.connect(this.masterGain!);
      oscillator.start(start);
      oscillator.stop(start + 0.46);
    });
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
