import type { ReactElement } from 'react';
import type { CameraMode, TelemetrySnapshot } from '../lib/telemetry';
import { formatNumber } from '../lib/telemetry';

interface TacticalRailProps {
  telemetry: TelemetrySnapshot;
  cameraMode: CameraMode;
  onCameraModeChange: (mode: CameraMode) => void;
}

const cameraModes: Array<{ id: CameraMode; label: string; detail: string }> = [
  { id: 'overview', label: 'MACRO ORBIT', detail: 'FACILITY OVERVIEW' },
  { id: 'canyon', label: 'RACK CANYON', detail: 'LOW-ANGLE FLY-THROUGH' },
  { id: 'inspection', label: 'TRANSFORMER', detail: 'HV YARD INSPECTION' },
  { id: 'director', label: 'DIRECTOR TOUR', detail: 'AUTOPILOT DRONE FLIGHT' },
];

export function TacticalRail({ telemetry, cameraMode, onCameraModeChange }: TacticalRailProps): ReactElement {
  return (
    <aside className="tactical-rail">
      <section className="rail-card glass-panel">
        <div className="card-heading">
          <span className="section-index">01</span>
          <div>
            <p className="eyebrow">PERSPECTIVE CONTROL</p>
            <h2>CAMERA RIG</h2>
          </div>
        </div>
        <div className="camera-list">
          {cameraModes.map((mode) => (
            <button
              className={`camera-button ${cameraMode === mode.id ? 'is-active' : ''}`}
              key={mode.id}
              type="button"
              aria-pressed={cameraMode === mode.id}
              onClick={() => onCameraModeChange(mode.id)}
            >
              <span className="camera-button-index">0{cameraModes.indexOf(mode) + 1}</span>
              <span>
                <strong>{mode.label}</strong>
                <small>{mode.detail}</small>
              </span>
              <span className="camera-chevron">↗</span>
            </button>
          ))}
        </div>
      </section>

      <section className="rail-card glass-panel rail-signal-card">
        <div className="card-heading compact-heading">
          <span className="section-index">02</span>
          <div>
            <p className="eyebrow">LIVE POWER FLOW</p>
            <h2>GRID VECTOR</h2>
          </div>
          <span className={`state-chip ${telemetry.gridState.toLowerCase()}`}>{telemetry.gridState}</span>
        </div>
        <div className="power-flow-visual">
          <div className="flow-ring ring-one" />
          <div className="flow-ring ring-two" />
          <div className="flow-core"><span>{Math.round(telemetry.loadPercent)}%</span><small>LOAD</small></div>
        </div>
        <div className="mini-metrics">
          <div><span>BUS VOLTAGE</span><strong>{formatNumber(telemetry.voltageKv, 1)} <small>kV</small></strong></div>
          <div><span>PHASE ANGLE</span><strong>{formatNumber(telemetry.phaseAngleDegrees, 2)}°</strong></div>
        </div>
      </section>
    </aside>
  );
}
