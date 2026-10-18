import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { AgentLogEntry, TelemetrySnapshot } from '../lib/telemetry';
import { formatNumber } from '../lib/telemetry';

interface AgentTerminalProps {
  telemetry: TelemetrySnapshot;
}

const agentClasses: Record<AgentLogEntry['agent'], string> = {
  SENTINEL: 'sentinel',
  ARBITER: 'arbiter',
  DISPATCHER: 'dispatcher',
  AUDITOR: 'auditor',
};

export function AgentTerminal({ telemetry }: AgentTerminalProps): ReactElement {
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!paused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [paused, telemetry.agentLogs.length]);

  return (
    <section className="agent-terminal glass-panel" aria-label="Live four-agent swarm terminal">
      <div className="terminal-heading">
        <div className="terminal-title"><span className="terminal-prompt">&gt;_</span><div><p className="eyebrow">AUTONOMOUS COORDINATION BUS</p><h2>SWARM TERMINAL</h2></div></div>
        <div className="terminal-controls">
          <span className="terminal-state"><i />{telemetry.auditorState}</span>
          <button type="button" onClick={() => setPaused((value) => !value)}>{paused ? 'RESUME' : 'PAUSE'} {paused ? '▶' : 'Ⅱ'}</button>
        </div>
      </div>
      <div className="terminal-stream" ref={scrollRef}>
        {telemetry.agentLogs.length === 0 ? (
          <div className="terminal-empty"><span>00:00:000</span><strong>LINK</strong><em>Awaiting chronological swarm deliberation feed...</em></div>
        ) : telemetry.agentLogs.map((event) => (
          <div className="terminal-line" key={event.sequence}>
            <time>T+{formatNumber(event.time_s * 1_000, 0)}ms</time>
            <span className={`agent-badge ${agentClasses[event.agent]}`}>{event.agent}</span>
            <span className={`terminal-level ${event.level.toLowerCase()}`}>{event.level}</span>
            <span className="terminal-message">{event.message}</span>
          </div>
        ))}
      </div>
      <div className="terminal-footer">
        <span><i className="terminal-cursor" />{paused ? 'MANUAL HOLD // SCROLL LOCKED' : 'AUTOSCROLL ACTIVE'}</span>
        <span>{telemetry.agentLogs.length.toString().padStart(3, '0')} EVENTS // T+{formatNumber(telemetry.elapsedSeconds * 1_000, 0)}ms</span>
      </div>
    </section>
  );
}
