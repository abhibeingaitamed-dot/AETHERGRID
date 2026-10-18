import type { ReactElement } from 'react';
import type { TelemetrySnapshot } from '../lib/telemetry';
import { formatNumber } from '../lib/telemetry';

interface ImpactPanelProps {
  telemetry: TelemetrySnapshot;
}

const formatUsd = (value: number): string => {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value).toLocaleString('en-US')}`;
};

export function ImpactPanel({ telemetry }: ImpactPanelProps): ReactElement {
  const { financial, environmental, batteryLifecycle } = telemetry;
  const protectedCapital = Math.min(financial.capitalPreservedUsd, financial.outageBenchmarkUsd * Math.max(1, financial.preventedOutages));
  const reservePercent = batteryLifecycle.nominalCapacityMwh > 0
    ? (batteryLifecycle.energyRemainingMwh / batteryLifecycle.nominalCapacityMwh) * 100
    : 0;
  const slaTiers = ['TIER_1', 'TIER_2', 'TIER_3'];

  return (
    <section className="impact-panel glass-panel" aria-label="Financial and environmental impact telemetry">
      <div className="impact-heading">
        <div><p className="eyebrow">MISSION VALUE LEDGER</p><h2>IMPACT TELEMETRY</h2></div>
        <span className={`impact-state ${financial.preventedOutages > 0 ? 'secured' : telemetry.contingencyActive ? 'exposure' : 'armed'}`}><i />{financial.preventedOutages > 0 ? 'VALUE SECURED' : telemetry.contingencyActive ? 'RISK ACTIVE' : 'VALUE ARMED'}</span>
      </div>

      <div className="capital-band">
        <div><span>CAPITAL PRESERVED</span><strong>{formatUsd(protectedCapital)}</strong></div>
        <div className="capital-reference"><span>OUTAGE BENCHMARK</span><b>{formatUsd(financial.outageBenchmarkUsd)}+</b><small>{financial.preventedOutages} PREVENTED EVENTS</small></div>
      </div>

      <div className="impact-columns">
        <div className="impact-column">
          <div className="impact-column-title"><span>SLA AVOIDANCE</span><strong>{formatUsd(financial.avoidedSlaPenaltiesUsd)}</strong></div>
          <div className="sla-list">
            {slaTiers.map((tier) => {
              const value = financial.avoidedSlaByTierUsd[tier] ?? 0;
              const share = financial.avoidedSlaPenaltiesUsd > 0 ? (value / financial.avoidedSlaPenaltiesUsd) * 100 : 0;
              return (
                <div className="sla-row" key={tier}>
                  <div><span>{tier.replace('_', ' ')}</span><b>{formatUsd(value)}</b></div>
                  <div className="sla-track"><i style={{ width: `${Math.min(100, share)}%` }} /></div>
                </div>
              );
            })}
          </div>
          <small className="impact-caption">CURTAILMENT COST {formatUsd(financial.curtailmentCostUsd)} · {formatNumber(financial.lastEventCurtailedMw, 1)} MW LAST EVENT</small>
        </div>

        <div className="impact-column">
          <div className="impact-column-title"><span>CARBON AVOIDANCE</span><strong>{formatNumber(environmental.avoidedCarbonTonnes, 3)} t</strong></div>
          <div className="carbon-metric"><span>AVOIDED DIESEL ENERGY</span><b>{formatNumber(environmental.avoidedDieselEnergyMwh, 3)} MWh</b></div>
          <div className="carbon-metric"><span>PEAKER INTENSITY</span><b>{formatNumber(environmental.dieselCarbonIntensityKgPerKwh, 2)} kg/kWh</b></div>
          <div className="carbon-bar"><i style={{ width: `${Math.min(100, environmental.avoidedCarbonTonnes * 18)}%` }} /></div>
          <small className="impact-caption">DIESEL STARTUP AVOIDED BY FFR + DVFS</small>
        </div>
      </div>

      <div className="battery-ledger">
        <div className="battery-ledger-heading"><span>BATTERY LIFECYCLE</span><strong>{formatNumber(batteryLifecycle.stateOfHealthPercent, 3)}% SOH</strong></div>
        <div className="battery-metrics">
          <div><span>ROUND TRIP</span><b>{formatNumber(batteryLifecycle.roundTripEfficiencyPercent, 1)}%</b></div>
          <div><span>RESERVE</span><b>{formatNumber(reservePercent, 1)}%</b></div>
          <div><span>EFC</span><b>{formatNumber(batteryLifecycle.equivalentCycles, 4)} / {formatNumber(batteryLifecycle.cycleLife, 0)}</b></div>
          <div><span>DELIVERED</span><b>{formatNumber(batteryLifecycle.energyDeliveredMwh, 3)} MWh</b></div>
        </div>
        <div className="battery-track"><i style={{ width: `${Math.min(100, Math.max(0, (batteryLifecycle.stateOfHealthPercent - batteryLifecycle.endOfLifeSohPercent) / (100 - batteryLifecycle.endOfLifeSohPercent) * 100))}%` }} /></div>
      </div>
    </section>
  );
}
