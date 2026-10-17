import type { ReactElement } from 'react';
import type { TelemetrySnapshot } from '../lib/telemetry';
import { formatNumber } from '../lib/telemetry';

interface TelemetryPanelsProps {
  telemetry: TelemetrySnapshot;
}

function Meter({ label, value, display, tone = 'cyan' }: { label: string; value: number; display: string; tone?: 'cyan' | 'amber' | 'red' }): ReactElement {
  return (
    <div className="meter-row">
      <div className="meter-label"><span>{label}</span><strong>{display}</strong></div>
      <div className="meter-track"><span className={`meter-fill ${tone}`} style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }} /></div>
    </div>
  );
}

export function TelemetryPanels({ telemetry }: TelemetryPanelsProps): ReactElement {
  const thermalTone = telemetry.thermalCelsius > 82 ? 'red' : telemetry.thermalCelsius > 76 ? 'amber' : 'cyan';
  const powerTone = telemetry.loadPercent > 90 ? 'red' : telemetry.loadPercent > 79 ? 'amber' : 'cyan';

  return (
    <div className="telemetry-dock">
      <section className="dock-card glass-panel telemetry-card">
        <div className="card-heading compact-heading">
          <span className="section-index">03</span>
          <div><p className="eyebrow">COMPUTE FABRIC</p><h2>NODE TELEMETRY</h2></div>
          <span className="live-label"><span className="status-dot" />LIVE</span>
        </div>
        <div className="node-stat-grid">
          <div><span>ACTIVE NODES</span><strong>{telemetry.activeNodes.toLocaleString('en-US')}</strong><small>/ {telemetry.rackCount * 250} NOMINAL</small></div>
          <div><span>NODE HEALTH</span><strong>{formatNumber(telemetry.nodeHealthPercent, 2)}<small>%</small></strong><small>NO DROP-OUTS</small></div>
          <div><span>THROUGHPUT</span><strong>{formatNumber(telemetry.powerMw, 2)}<small>MW</small></strong><small>AI FABRIC DRAW</small></div>
        </div>
        <Meter label="THERMAL ENVELOPE" value={(telemetry.thermalCelsius / 100) * 100} display={`${formatNumber(telemetry.thermalCelsius, 1)} °C`} tone={thermalTone} />
        <Meter label="COMPUTE LOAD" value={telemetry.loadPercent} display={`${Math.round(telemetry.loadPercent)} %`} tone={powerTone} />
      </section>

      <section className="dock-card glass-panel telemetry-card">
        <div className="card-heading compact-heading">
          <span className="section-index">04</span>
          <div><p className="eyebrow">SUBSTATION YARD</p><h2>ENERGY SILICON</h2></div>
          <span className="yard-tag">YARD-07</span>
        </div>
        <div className="energy-readout">
          <span className="energy-orbit orbit-a" />
          <span className="energy-orbit orbit-b" />
          <div><strong>{formatNumber(telemetry.transformerLoadPercent, 1)}<small>%</small></strong><span>TRANSFORMER LOAD</span></div>
        </div>
        <div className="two-up-stats">
          <div><span>COOLANT RETURN</span><strong>{formatNumber(telemetry.coolantCelsius, 1)} °C</strong></div>
          <div><span>PACKET LOSS</span><strong>{formatNumber(telemetry.packetLossPercent, 3)} %</strong></div>
        </div>
        <div className="dock-event"><span className="event-pulse" /><span>SYNC LOCK HELD</span><time>00:00:00:042</time></div>
      </section>

      <section className="dock-card glass-panel signal-card">
        <div className="card-heading compact-heading">
          <span className="section-index">05</span>
          <div><p className="eyebrow">ORCHESTRATOR LOG</p><h2>RECENT EVENTS</h2></div>
        </div>
        <ul className="event-list">
          <li><span className="event-code">GRID</span><span>Phase vector stabilized</span><time>12:44:08</time></li>
          <li><span className="event-code cyan-code">THERM</span><span>Cooling loop delta nominal</span><time>12:44:03</time></li>
          <li><span className="event-code amber-code">SYNC</span><span>{telemetry.alertCount ? `${telemetry.alertCount} envelope alerts tracked` : 'No envelope alerts tracked'}</span><time>12:43:57</time></li>
        </ul>
      </section>
    </div>
  );
}
