import { useCallback, useRef, useState, type ReactElement } from 'react';
import { AgentTerminal } from './components/AgentTerminal';
import { ChaosSuite } from './components/ChaosSuite';
import { ImpactPanel } from './components/ImpactPanel';
import { Oscilloscope } from './components/Oscilloscope';
import { SceneCanvas } from './components/SceneCanvas';
import { TacticalRail } from './components/TacticalRail';
import { TelemetryHeader } from './components/TelemetryHeader';
import { TelemetryPanels } from './components/TelemetryPanels';
import { useAudioEngine } from './audio/useAudioEngine';
import { useLiveTelemetry, type CameraMode, type RackSelection } from './lib/telemetry';
import { RackInspectorCard } from './components/RackInspectorCard';

export function App(): ReactElement {
  const { telemetry, sendCommand } = useLiveTelemetry();
  const audio = useAudioEngine(telemetry);
  const [cameraMode, setCameraMode] = useState<CameraMode>('overview');
  const [rackSelection, setRackSelection] = useState<RackSelection | null>(null);
  const rackSelectionIdRef = useRef<string | null>(null);
  const handleRackSelect = useCallback((rack: RackSelection | null) => {
    const nextRackId = rack?.id ?? null;
    if (nextRackId && nextRackId !== rackSelectionIdRef.current) audio.playInteraction('rack');
    rackSelectionIdRef.current = nextRackId;
    setRackSelection(rack);
  }, [audio.playInteraction]);
  const handleCameraModeChange = useCallback((nextMode: CameraMode) => {
    if (nextMode !== cameraMode) audio.playInteraction('camera');
    setCameraMode(nextMode);
  }, [audio.playInteraction, cameraMode]);
  const sendChaosCommand = useCallback((command: Parameters<typeof sendCommand>[0]): boolean => {
    audio.playInteraction('chaos');
    return sendCommand(command);
  }, [audio.playInteraction, sendCommand]);

  return (
    <main className="mission-app">
      <SceneCanvas load={telemetry.loadPercent} cameraMode={cameraMode} onRackSelect={handleRackSelect} />
      <div className="scene-vignette" aria-hidden="true" />
      <div className="scanline-overlay" aria-hidden="true" />
      <div className="viewport-crosshair" aria-hidden="true"><span /><span /></div>
      <div className="facility-caption" aria-hidden="true"><span>FACILITY DIGITAL TWIN</span><strong>AETHERGRID / GRID NODE 07</strong></div>

      <div className="hud-layer">
        <TelemetryHeader telemetry={telemetry} audioEnabled={audio.enabled} audioMuted={audio.muted} audioVolume={audio.volume} soundscape={audio.soundscape} onEnableAudio={() => void audio.enable()} onToggleMute={audio.toggleMute} onVolumeChange={audio.setVolume} onSoundscapeChange={audio.setSoundscape} />
        <TacticalRail telemetry={telemetry} cameraMode={cameraMode} onCameraModeChange={handleCameraModeChange} />
        <section className="center-column" aria-label="Central 3D mission viewport controls">
          <RackInspectorCard rack={rackSelection} onClose={() => setRackSelection(null)} />
          <div className="center-dock">
            <ChaosSuite telemetry={telemetry} sendCommand={sendChaosCommand} />
            <AgentTerminal telemetry={telemetry} />
          </div>
        </section>
        <aside className="telemetry-column" aria-label="Stacked telemetry column">
          <Oscilloscope telemetry={telemetry} />
          <ImpactPanel telemetry={telemetry} />
          <TelemetryPanels telemetry={telemetry} />
        </aside>
        <footer className="hud-footer">
          <span>LOCAL SIMULATION // DETERMINISTIC TELEMETRY STREAM</span>
          <span>BUILD 0.1.0 <i /> ALL SYSTEMS MONITORED</span>
        </footer>
      </div>
    </main>
  );
}
