import type { ReactElement } from 'react';
import type { RackSelection } from '../lib/telemetry';
import { formatNumber } from '../lib/telemetry';

interface RackInspectorCardProps {
  rack: RackSelection | null;
  onClose: () => void;
}

export function RackInspectorCard({ rack, onClose }: RackInspectorCardProps): ReactElement | null {
  if (!rack) return null;

  return (
    <section className="rack-inspector glass-panel" aria-label={`Rack inspection ${rack.id}`}>
      <div className="rack-inspector-heading">
        <div><p className="eyebrow">RACK RAYCAST LOCK</p><h2>{rack.id}</h2></div>
        <button type="button" onClick={onClose} aria-label="Close rack inspector">×</button>
      </div>
      <div className="rack-inspector-status"><i />LIVE // {rack.corridor}</div>
      <div className="rack-inspector-metrics">
        <div><span>CORE TEMP</span><strong>{formatNumber(rack.temperatureCelsius, 1)} °C</strong></div>
        <div><span>DRAW</span><strong>{formatNumber(rack.powerMw, 2)} MW</strong></div>
        <div><span>WORKLOAD</span><strong>{rack.tier.replace('_', ' ')}</strong></div>
        <div><span>GPU NODES</span><strong>{rack.gpuCount.toLocaleString('en-US')}</strong></div>
      </div>
      <div className="rack-inspector-footer"><span>TELEMETRY LOCK</span><b>0.8 ms</b></div>
    </section>
  );
}
