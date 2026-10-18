import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraMode = 'overview' | 'canyon' | 'inspection' | 'director';
export type StreamStatus = 'CONNECTING' | 'LIVE' | 'RECONNECTING' | 'OFFLINE';

export type WebSocketCommand =
  | { type: 'ping'; request_id?: string }
  | { type: 'contingency'; trip_mw?: number; request_id?: string }
  | { type: 'transformer_overload'; overload_mw?: number; request_id?: string }
  | { type: 'renewable_drop'; drop_mw?: number; request_id?: string }
  | { type: 'reset'; request_id?: string };

export interface AgentLogEntry {
  sequence: number;
  time_s: number;
  agent: 'SENTINEL' | 'ARBITER' | 'DISPATCHER' | 'AUDITOR';
  level: 'INFO' | 'WARN' | 'ALERT' | 'DECISION' | 'ACTION';
  message: string;
}

export interface RackSelection {
  id: string;
  corridor: string;
  tier: 'TIER_1' | 'TIER_2' | 'TIER_3';
  temperatureCelsius: number;
  powerMw: number;
  gpuCount: number;
}

export interface FinancialImpact {
  outageBenchmarkUsd: number;
  preventedOutages: number;
  capitalPreservedUsd: number;
  activeOutageExposureUsd: number;
  avoidedSlaPenaltiesUsd: number;
  avoidedSlaByTierUsd: Record<string, number>;
  curtailmentCostUsd: number;
  lastEventAvoidedSlaUsd: number;
  lastEventCurtailedMw: number;
  lastEventRecoveryMs: number | null;
}

export interface EnvironmentalImpact {
  avoidedDieselEnergyMwh: number;
  avoidedCarbonKg: number;
  avoidedCarbonTonnes: number;
  dieselCarbonIntensityKgPerKwh: number;
}

export interface BatteryLifecycle {
  roundTripEfficiencyPercent: number;
  nominalCapacityMwh: number;
  energyRemainingMwh: number;
  energyDeliveredMwh: number;
  equivalentCycles: number;
  stateOfHealthPercent: number;
  cycleLife: number;
  endOfLifeSohPercent: number;
}

export interface TelemetrySnapshot {
  elapsedSeconds: number;
  simulationTimeMs: number;
  streamHz: number;
  streamStatus: StreamStatus;
  contingencyActive: boolean;
  loadPercent: number;
  frequencyHz: number;
  voltageKv: number;
  generatorTripMw: number;
  transformerOverloadMw: number;
  renewableDropMw: number;
  transformerTemperatureCelsius: number;
  thermalCelsius: number;
  efficiencyPercent: number;
  activeNodes: number;
  rackCount: number;
  powerMw: number;
  connectionLatencyMs: number;
  packetLossPercent: number;
  phaseAngleDegrees: number;
  coolantCelsius: number;
  transformerLoadPercent: number;
  nodeHealthPercent: number;
  alertCount: number;
  rocofHzPerSecond: number;
  generationMw: number;
  demandMw: number;
  balanceMw: number;
  computeShedMw: number;
  batteryInjectionMw: number;
  throttledGpuCount: number;
  nadirHz: number;
  sentinelState: string;
  sentinelAlert: boolean;
  arbiterState: string;
  dispatcherState: string;
  auditorState: string;
  auditorDetail: string;
  gridState: 'NOMINAL' | 'ELEVATED' | 'CRITICAL';
  financial: FinancialImpact;
  environmental: EnvironmentalImpact;
  batteryLifecycle: BatteryLifecycle;
  agentLogs: AgentLogEntry[];
}

interface LiveTelemetryEnvelope {
  type: 'telemetry';
  sequence: number;
  simulation_time_ms: number;
  stream_hz: number;
  grid: {
    frequency_hz: number;
    frequency_deviation_hz: number;
    rocof_hz_per_second: number;
    generation_mw: number;
    demand_mw: number;
    balance_mw: number;
    voltage_kv: number;
    generator_trip_mw: number;
    transformer_overload_mw: number;
    renewable_drop_mw: number;
    nadir_hz: number;
    transformer_temperature_celsius: number;
    base_capacity_mw: number;
    contingency_active: boolean;
  };
  compute: {
    total_gpu_count: number;
    active_gpu_count: number;
    cluster_nominal_power_mw: number;
    cluster_power_mw: number;
    shed_mw: number;
    throttled_gpu_count: number;
    thermal_celsius: number;
    coolant_celsius: number;
  };
  battery: {
    injection_mw: number;
  };
  agents: {
    sentinel_state: string;
    arbiter_state: string;
    dispatcher_state: string;
    auditor_state: string;
    sentinel_alert: boolean;
    last_battery_dispatch_mw: number;
    last_compute_curtailment_mw: number;
    auditor_nadir_ok: boolean;
    auditor_recovery_ok: boolean;
    auditor_detail: string;
  };
  events: AgentLogEntry[];
  financial: {
    outage_benchmark_usd: number;
    prevented_outages: number;
    capital_preserved_usd: number;
    active_outage_exposure_usd: number;
    avoided_sla_penalties_usd: number;
    avoided_sla_by_tier_usd: Record<string, number>;
    curtailment_cost_usd: number;
    last_event_avoided_sla_usd: number;
    last_event_curtailed_mw: number;
    last_event_recovery_ms: number | null;
  };
  environmental: {
    avoided_diesel_energy_mwh: number;
    avoided_carbon_kg: number;
    avoided_carbon_tonnes: number;
    diesel_carbon_intensity_kg_per_kwh: number;
  };
  battery_lifecycle: {
    round_trip_efficiency_percent: number;
    nominal_capacity_mwh: number;
    energy_remaining_mwh: number;
    energy_delivered_mwh: number;
    equivalent_cycles: number;
    state_of_health_percent: number;
    cycle_life: number;
    end_of_life_soh_percent: number;
  };
}

const TOTAL_RACKS = 48;

const emptyTelemetry = (streamStatus: StreamStatus): TelemetrySnapshot => ({
  elapsedSeconds: 0,
  simulationTimeMs: 0,
  streamHz: 20,
  streamStatus,
  contingencyActive: false,
  loadPercent: 0,
  frequencyHz: 60,
  voltageKv: 345,
  generatorTripMw: 0,
  transformerOverloadMw: 0,
  renewableDropMw: 0,
  transformerTemperatureCelsius: 68,
  thermalCelsius: 0,
  efficiencyPercent: 100,
  activeNodes: 12_000,
  rackCount: TOTAL_RACKS,
  powerMw: 0,
  connectionLatencyMs: 0,
  packetLossPercent: 0,
  phaseAngleDegrees: 0,
  coolantCelsius: 0,
  transformerLoadPercent: 0,
  nodeHealthPercent: 100,
  alertCount: 0,
  rocofHzPerSecond: 0,
  generationMw: 1_000,
  demandMw: 1_000,
  balanceMw: 0,
  computeShedMw: 0,
  batteryInjectionMw: 0,
  throttledGpuCount: 0,
  nadirHz: 60,
  sentinelState: 'MONITORING',
  sentinelAlert: false,
  arbiterState: 'STANDBY',
  dispatcherState: 'STANDBY',
  auditorState: 'MONITORING',
  auditorDetail: 'waiting for telemetry stream',
  gridState: 'NOMINAL',
  financial: {
    outageBenchmarkUsd: 10_000_000,
    preventedOutages: 0,
    capitalPreservedUsd: 0,
    activeOutageExposureUsd: 0,
    avoidedSlaPenaltiesUsd: 0,
    avoidedSlaByTierUsd: {},
    curtailmentCostUsd: 0,
    lastEventAvoidedSlaUsd: 0,
    lastEventCurtailedMw: 0,
    lastEventRecoveryMs: null,
  },
  environmental: {
    avoidedDieselEnergyMwh: 0,
    avoidedCarbonKg: 0,
    avoidedCarbonTonnes: 0,
    dieselCarbonIntensityKgPerKwh: 0.74,
  },
  batteryLifecycle: {
    roundTripEfficiencyPercent: 92,
    nominalCapacityMwh: 400,
    energyRemainingMwh: 400,
    energyDeliveredMwh: 0,
    equivalentCycles: 0,
    stateOfHealthPercent: 100,
    cycleLife: 4_000,
    endOfLifeSohPercent: 80,
  },
  agentLogs: [],
});

const isLiveTelemetryEnvelope = (value: unknown): value is LiveTelemetryEnvelope => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LiveTelemetryEnvelope>;
  return Boolean(
    candidate.type === 'telemetry' &&
      candidate.grid &&
      candidate.compute &&
      candidate.battery &&
      candidate.agents &&
      Array.isArray(candidate.events),
  );
};

const mapEnvelope = (envelope: LiveTelemetryEnvelope, streamStatus: StreamStatus, previousLogs: AgentLogEntry[]): TelemetrySnapshot => {
  const loadPercent = envelope.compute.cluster_nominal_power_mw > 0
    ? (envelope.compute.cluster_power_mw / envelope.compute.cluster_nominal_power_mw) * 100
    : 0;
  const alertCount = envelope.events.filter((event) => event.level === 'ALERT' || event.level === 'WARN').length;
  const gridState = envelope.agents.sentinel_alert || envelope.grid.frequency_hz < 59.9
    ? 'CRITICAL'
    : Math.abs(envelope.grid.rocof_hz_per_second) > 0.05 || envelope.compute.shed_mw > 0
      ? 'ELEVATED'
      : 'NOMINAL';

  const eventLog = new Map<number, AgentLogEntry>();
  [...previousLogs, ...envelope.events].forEach((event) => eventLog.set(event.sequence, event));

  return {
    elapsedSeconds: envelope.simulation_time_ms / 1_000,
    simulationTimeMs: envelope.simulation_time_ms,
    streamHz: envelope.stream_hz,
    streamStatus,
    contingencyActive: envelope.grid.contingency_active,
    loadPercent,
    frequencyHz: envelope.grid.frequency_hz,
    voltageKv: envelope.grid.voltage_kv,
    generatorTripMw: envelope.grid.generator_trip_mw,
    transformerOverloadMw: envelope.grid.transformer_overload_mw,
    renewableDropMw: envelope.grid.renewable_drop_mw,
    transformerTemperatureCelsius: envelope.grid.transformer_temperature_celsius,
    thermalCelsius: envelope.compute.thermal_celsius,
    efficiencyPercent: Math.max(0, 100 - Math.abs(envelope.grid.balance_mw) * 0.02),
    activeNodes: envelope.compute.active_gpu_count,
    rackCount: TOTAL_RACKS,
    powerMw: envelope.compute.cluster_power_mw,
    connectionLatencyMs: 1_000 / Math.max(envelope.stream_hz, 1),
    packetLossPercent: 0,
    phaseAngleDegrees: envelope.grid.frequency_deviation_hz * 12,
    coolantCelsius: envelope.compute.coolant_celsius,
    transformerLoadPercent: Math.min(100, (envelope.grid.generation_mw / envelope.grid.base_capacity_mw) * 100),
    nodeHealthPercent: (envelope.compute.active_gpu_count / envelope.compute.total_gpu_count) * 100,
    alertCount,
    rocofHzPerSecond: envelope.grid.rocof_hz_per_second,
    generationMw: envelope.grid.generation_mw,
    demandMw: envelope.grid.demand_mw,
    balanceMw: envelope.grid.balance_mw,
    computeShedMw: envelope.compute.shed_mw,
    batteryInjectionMw: envelope.battery.injection_mw,
    throttledGpuCount: envelope.compute.throttled_gpu_count,
    nadirHz: envelope.grid.nadir_hz,
    sentinelState: envelope.agents.sentinel_state,
    sentinelAlert: envelope.agents.sentinel_alert,
    arbiterState: envelope.agents.arbiter_state,
    dispatcherState: envelope.agents.dispatcher_state,
    auditorState: envelope.agents.auditor_state,
    auditorDetail: envelope.agents.auditor_detail,
    gridState,
    financial: {
      outageBenchmarkUsd: envelope.financial.outage_benchmark_usd,
      preventedOutages: envelope.financial.prevented_outages,
      capitalPreservedUsd: envelope.financial.capital_preserved_usd,
      activeOutageExposureUsd: envelope.financial.active_outage_exposure_usd,
      avoidedSlaPenaltiesUsd: envelope.financial.avoided_sla_penalties_usd,
      avoidedSlaByTierUsd: envelope.financial.avoided_sla_by_tier_usd,
      curtailmentCostUsd: envelope.financial.curtailment_cost_usd,
      lastEventAvoidedSlaUsd: envelope.financial.last_event_avoided_sla_usd,
      lastEventCurtailedMw: envelope.financial.last_event_curtailed_mw,
      lastEventRecoveryMs: envelope.financial.last_event_recovery_ms,
    },
    environmental: {
      avoidedDieselEnergyMwh: envelope.environmental.avoided_diesel_energy_mwh,
      avoidedCarbonKg: envelope.environmental.avoided_carbon_kg,
      avoidedCarbonTonnes: envelope.environmental.avoided_carbon_tonnes,
      dieselCarbonIntensityKgPerKwh: envelope.environmental.diesel_carbon_intensity_kg_per_kwh,
    },
    batteryLifecycle: {
      roundTripEfficiencyPercent: envelope.battery_lifecycle.round_trip_efficiency_percent,
      nominalCapacityMwh: envelope.battery_lifecycle.nominal_capacity_mwh,
      energyRemainingMwh: envelope.battery_lifecycle.energy_remaining_mwh,
      energyDeliveredMwh: envelope.battery_lifecycle.energy_delivered_mwh,
      equivalentCycles: envelope.battery_lifecycle.equivalent_cycles,
      stateOfHealthPercent: envelope.battery_lifecycle.state_of_health_percent,
      cycleLife: envelope.battery_lifecycle.cycle_life,
      endOfLifeSohPercent: envelope.battery_lifecycle.end_of_life_soh_percent,
    },
    agentLogs: Array.from(eventLog.values()).sort((left, right) => left.sequence - right.sequence).slice(-120),
  };
};

function telemetrySocketUrl(): string {
  const configuredUrl = import.meta.env.VITE_API_WS_URL as string | undefined;
  if (configuredUrl) return configuredUrl;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/telemetry`;
}

export function useLiveTelemetry(): { telemetry: TelemetrySnapshot; sendCommand: (command: WebSocketCommand) => boolean } {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot>(() => emptyTelemetry('CONNECTING'));
  const socketRef = useRef<WebSocket | null>(null);

  const sendCommand = useCallback((command: WebSocketCommand): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(command));
    return true;
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let disposed = false;
    let attempts = 0;

    const scheduleReconnect = (): void => {
      if (disposed) return;
      attempts += 1;
      const backoffMs = Math.min(4_000, 250 * 2 ** Math.min(attempts - 1, 4));
      setSnapshot((current) => ({ ...current, streamStatus: 'RECONNECTING' }));
      reconnectTimer = window.setTimeout(connect, backoffMs);
    };

    const connect = (): void => {
      if (disposed) return;
      setSnapshot((current) => ({ ...current, streamStatus: attempts === 0 ? 'CONNECTING' : 'RECONNECTING' }));
      socket = new WebSocket(telemetrySocketUrl());
      socketRef.current = socket;
      socket.onopen = () => {
        attempts = 0;
        setSnapshot((current) => ({ ...current, streamStatus: 'LIVE' }));
        socket?.send(JSON.stringify({ type: 'ping', request_id: `hud-${Date.now()}` }));
      };
      socket.onmessage = (event) => {
        try {
          const parsed: unknown = JSON.parse(event.data as string);
          if (isLiveTelemetryEnvelope(parsed)) {
            setSnapshot((current) => mapEnvelope(parsed, 'LIVE', current.agentLogs));
          }
        } catch {
          setSnapshot((current) => ({ ...current, streamStatus: 'RECONNECTING' }));
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        socket = null;
        socketRef.current = null;
        scheduleReconnect();
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socket?.close();
      socketRef.current = null;
    };
  }, []);

  return { telemetry: snapshot, sendCommand };
}

export function formatUtcMilliseconds(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 19).replace('T', ' ')}.${iso.slice(20, 23)}Z`;
}

export function formatNumber(value: number, digits = 1): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
