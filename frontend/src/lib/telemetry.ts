import { useEffect, useState } from 'react';

export type CameraMode = 'overview' | 'canyon' | 'inspection';

export interface TelemetrySnapshot {
  elapsedSeconds: number;
  loadPercent: number;
  frequencyHz: number;
  voltageKv: number;
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
  gridState: 'NOMINAL' | 'ELEVATED' | 'CRITICAL';
}

const TOTAL_NODES = 12000;
const TOTAL_RACKS = 48;

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(Math.max(value, minimum), maximum);

export function telemetryAt(elapsedSeconds: number): TelemetrySnapshot {
  const loadWave = Math.sin(elapsedSeconds * 0.115) * 0.095 + Math.sin(elapsedSeconds * 0.031 + 1.2) * 0.055;
  const load = clamp(0.68 + loadWave, 0.12, 0.97);
  const frequency = 60 + Math.sin(elapsedSeconds * 0.19) * 0.018 - load * 0.004;
  const voltage = 345 + Math.sin(elapsedSeconds * 0.073 + 0.5) * 2.6 - load * 1.7;
  const thermal = 58 + load * 28 + Math.sin(elapsedSeconds * 0.17) * 3.2;
  const coolant = 18.5 + load * 5.8 + Math.sin(elapsedSeconds * 0.12 + 2.1) * 0.8;
  const transformerLoad = clamp(0.54 + load * 0.36 + Math.sin(elapsedSeconds * 0.09) * 0.04, 0, 1);
  const loadPercent = load * 100;
  const thermalCelsius = thermal;
  const state = load > 0.9 ? 'CRITICAL' : load > 0.79 ? 'ELEVATED' : 'NOMINAL';

  return {
    elapsedSeconds,
    loadPercent,
    frequencyHz: frequency,
    voltageKv: voltage,
    thermalCelsius,
    efficiencyPercent: 99.2 - load * 2.4 + Math.sin(elapsedSeconds * 0.13) * 0.12,
    activeNodes: Math.round(TOTAL_NODES * (0.965 + Math.sin(elapsedSeconds * 0.047) * 0.012)),
    rackCount: TOTAL_RACKS,
    powerMw: 8.6 + load * 4.9,
    connectionLatencyMs: 0.74 + Math.sin(elapsedSeconds * 0.39) * 0.12 + load * 0.16,
    packetLossPercent: clamp(0.006 + load * 0.015 + Math.sin(elapsedSeconds * 0.23) * 0.003, 0.001, 0.05),
    phaseAngleDegrees: 0.8 + Math.sin(elapsedSeconds * 0.11) * 1.4 + load * 0.24,
    coolantCelsius: coolant,
    transformerLoadPercent: transformerLoad * 100,
    nodeHealthPercent: 99.94 - load * 0.6,
    alertCount: state === 'CRITICAL' ? 4 : state === 'ELEVATED' ? 2 : 0,
    gridState: state,
  };
}

export function useLocalTelemetry(): TelemetrySnapshot {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot>(() => telemetryAt(0));

  useEffect(() => {
    let frame = 0;
    let lastPublish = -Infinity;
    const publishInterval = 120;

    const tick = (timestamp: number): void => {
      if (timestamp - lastPublish >= publishInterval) {
        setSnapshot(telemetryAt(timestamp / 1000));
        lastPublish = timestamp;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return snapshot;
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
