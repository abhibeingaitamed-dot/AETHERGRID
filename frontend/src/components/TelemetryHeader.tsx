import { useEffect, useState, type ReactElement } from 'react';
import { formatNumber, formatUtcMilliseconds, type TelemetrySnapshot } from '../lib/telemetry';

interface TelemetryHeaderProps {
  telemetry: TelemetrySnapshot;
}

export function TelemetryHeader({ telemetry }: TelemetryHeaderProps): ReactElement {
  const [utcNow, setUtcNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setUtcNow(new Date()), 37);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <header className="hud-header glass-panel">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <div>
          <p className="eyebrow">AETHERGRID // SYNCHRONICITY LAYER</p>
          <h1>MISSION DECK</h1>
        </div>
      </div>

      <div className="header-readout operational-readout">
        <span className="status-dot" />
        <div>
          <span className="readout-label">SYSTEM READINESS</span>
          <strong>OPERATIONAL</strong>
        </div>
      </div>

      <div className="header-readout">
        <span className="readout-label">UTC MASTER CLOCK</span>
        <strong className="mono-value clock-value">{formatUtcMilliseconds(utcNow)}</strong>
      </div>

      <div className="header-readout compact-readout">
        <span className="readout-label">GRID FREQ</span>
        <strong className="mono-value">{formatNumber(telemetry.frequencyHz, 3)} <small>Hz</small></strong>
      </div>

      <div className="header-readout compact-readout">
        <span className="readout-label">LINK DIAGNOSTICS</span>
        <strong className={`mono-value connection-value ${telemetry.streamStatus.toLowerCase()}`}><span className="signal-bars" aria-hidden="true"><i /><i /><i /><i /></span> {telemetry.streamStatus}</strong>
        <span className="sub-readout">{formatNumber(telemetry.streamHz, 0)} Hz PHYSICS LINK · {formatNumber(telemetry.connectionLatencyMs, 1)} ms TICK</span>
      </div>
    </header>
  );
}
