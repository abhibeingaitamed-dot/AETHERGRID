import { useCallback, useEffect, useRef, useState } from 'react';
import type { TelemetrySnapshot } from '../lib/telemetry';
import { WebAudioSynthesizer } from './WebAudioSynthesizer';
import type { SoundscapeMode } from './WebAudioSynthesizer';

export function useAudioEngine(telemetry: TelemetrySnapshot): {
  enabled: boolean;
  muted: boolean;
  volume: number;
  soundscape: SoundscapeMode;
  enable: () => Promise<void>;
  toggleMute: () => void;
  setVolume: (value: number) => void;
  setSoundscape: (soundscape: SoundscapeMode) => void;
} {
  const engineRef = useRef<WebAudioSynthesizer | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolumeState] = useState(0.34);
  const [soundscape, setSoundscapeState] = useState<SoundscapeMode>('cinematic');

  if (!engineRef.current) engineRef.current = new WebAudioSynthesizer();

  useEffect(() => {
    engineRef.current?.update(telemetry);
  }, [telemetry]);

  useEffect(() => () => {
    engineRef.current?.dispose();
  }, []);

  const enable = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    await engine.enable();
    engine.setVolume(volume);
    engine.setMuted(muted);
    engine.setSoundscape(soundscape);
    engine.update(telemetry);
    setEnabled(true);
  }, [muted, soundscape, telemetry, volume]);

  const toggleMute = useCallback(() => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    engineRef.current?.setMuted(nextMuted);
  }, [muted]);

  const setVolume = useCallback((value: number) => {
    const nextVolume = Math.min(Math.max(value, 0), 1);
    setVolumeState(nextVolume);
    engineRef.current?.setVolume(nextVolume);
  }, []);

  const setSoundscape = useCallback((nextSoundscape: SoundscapeMode) => {
    setSoundscapeState(nextSoundscape);
    engineRef.current?.setSoundscape(nextSoundscape);
  }, []);

  return { enabled, muted, volume, soundscape, enable, toggleMute, setVolume, setSoundscape };
}
