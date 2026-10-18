import { useState, type ReactElement } from 'react';
import type { TelemetrySnapshot, WebSocketCommand } from '../lib/telemetry';
import { formatNumber } from '../lib/telemetry';

interface ChaosSuiteProps {
  telemetry: TelemetrySnapshot;
  sendCommand: (command: WebSocketCommand) => boolean;
}

interface ChaosAction {
  type: WebSocketCommand['type'];
  label: string;
  detail: string;
  payload: WebSocketCommand;
  tone: 'red' | 'amber' | 'violet' | 'cyan';
}

export function ChaosSuite({ telemetry, sendCommand }: ChaosSuiteProps): ReactElement {
  const [lastCommand, setLastCommand] = useState('STANDBY');
  const actions: ChaosAction[] = [
    {
      type: 'contingency',
      label: 'GENERATOR TRIP',
      detail: '−350 MW / INSTANT',
      payload: { type: 'contingency', trip_mw: 350 },
      tone: 'red',
    },
    {
      type: 'transformer_overload',
      label: 'TRANSFORMER HEAT',
      detail: 'CORE OVERLOAD / 240 MW',
      payload: { type: 'transformer_overload', overload_mw: 240 },
      tone: 'amber',
    },
    {
      type: 'renewable_drop',
      label: 'RENEWABLE DROP',
      detail: '−260 MW / RoCoF EVENT',
      payload: { type: 'renewable_drop', drop_mw: 260 },
      tone: 'violet',
    },
  ];

  const dispatch = (action: ChaosAction): void => {
    const requestId = `${action.type}-${Date.now()}`;
    const sent = sendCommand({ ...action.payload, request_id: requestId } as WebSocketCommand);
    setLastCommand(sent ? `${action.label} // SENT` : 'LINK OFFLINE // RETRY');
  };

  const reset = (): void => {
    const sent = sendCommand({ type: 'reset', request_id: `reset-${Date.now()}` });
    setLastCommand(sent ? 'SYSTEM RESET // SENT' : 'LINK OFFLINE // RETRY');
  };

  return (
    <section className="chaos-suite glass-panel" aria-label="Interactive chaos control suite">
      <div className="chaos-heading">
        <div><p className="eyebrow">CONTROLLED CONTINGENCY INJECTION</p><h2>CHAOS SUITE</h2></div>
        <span className={`chaos-link ${telemetry.streamStatus.toLowerCase()}`}><i />{telemetry.streamStatus}</span>
      </div>
      <div className="chaos-grid">
        {actions.map((action) => (
          <button className={`chaos-button ${action.tone}`} type="button" key={action.type} onClick={() => dispatch(action)} disabled={telemetry.streamStatus !== 'LIVE'}>
            <span className="chaos-button-pip" />
            <span><strong>{action.label}</strong><small>{action.detail}</small></span>
            <b>↯</b>
          </button>
        ))}
        <button className="chaos-button reset" type="button" onClick={reset} disabled={telemetry.streamStatus !== 'LIVE'}>
          <span className="chaos-button-pip" />
          <span><strong>SYSTEM RESET</strong><small>RECHARGE / FULL CLOCK</small></span>
          <b>↻</b>
        </button>
      </div>
      <div className="chaos-footer">
        <span className="chaos-command-status"><i />{lastCommand}</span>
        <span>XFMR {formatNumber(telemetry.transformerTemperatureCelsius, 1)} °C</span>
        <span>LOSS {formatNumber(telemetry.generatorTripMw + telemetry.transformerOverloadMw + telemetry.renewableDropMw, 0)} MW</span>
      </div>
    </section>
  );
}
