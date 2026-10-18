import { useEffect, useRef, type ReactElement } from 'react';
import type { TelemetrySnapshot } from '../lib/telemetry';
import { formatNumber } from '../lib/telemetry';

interface OscilloscopeProps {
  telemetry: TelemetrySnapshot;
}

export function Oscilloscope({ telemetry }: OscilloscopeProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const telemetryRef = useRef(telemetry);
  telemetryRef.current = telemetry;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    let animationFrame = 0;
    let width = 0;
    let height = 0;
    let devicePixelRatio = 1;

    const resize = (): void => {
      const bounds = canvas.getBoundingClientRect();
      devicePixelRatio = Math.min(window.devicePixelRatio, 2);
      width = Math.max(bounds.width, 1);
      height = Math.max(bounds.height, 1);
      canvas.width = Math.round(width * devicePixelRatio);
      canvas.height = Math.round(height * devicePixelRatio);
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    };

    const draw = (timestamp: number): void => {
      const current = telemetryRef.current;
      const normalizedFrequency = Math.abs(current.frequencyHz - 60);
      const severe = current.frequencyHz < 59.8 || Math.abs(current.rocofHzPerSecond) > 0.15;
      const warning = normalizedFrequency > 0.015 || Math.abs(current.rocofHzPerSecond) > 0.05;
      const color = severe ? '#ff3e38' : warning ? '#ffb13d' : '#04dbff';
      const glow = severe ? 'rgba(255, 45, 35, 0.78)' : warning ? 'rgba(255, 163, 47, 0.72)' : 'rgba(0, 219, 255, 0.72)';
      const nowSeconds = timestamp / 1_000;
      const viewSeconds = 0.2;
      const amplitude = Math.min(height * 0.34, height * 0.34 * (current.voltageKv / 345));

      context.fillStyle = 'rgba(2, 7, 15, 0.23)';
      context.fillRect(0, 0, width, height);
      context.strokeStyle = 'rgba(89, 191, 220, 0.12)';
      context.lineWidth = 1;
      for (let horizontal = 1; horizontal < 5; horizontal += 1) {
        const y = (height / 5) * horizontal;
        context.beginPath();
        context.moveTo(0, y + 0.5);
        context.lineTo(width, y + 0.5);
        context.stroke();
      }
      for (let vertical = 1; vertical < 10; vertical += 1) {
        const x = (width / 10) * vertical;
        context.beginPath();
        context.moveTo(x + 0.5, 0);
        context.lineTo(x + 0.5, height);
        context.stroke();
      }

      context.fillStyle = 'rgba(141, 206, 223, 0.46)';
      context.font = '8px SFMono-Regular, Consolas, monospace';
      context.fillText('mHz', 7, 13);
      context.fillText('ms', width - 23, height - 7);
      context.fillText('+0.50', 7, height * 0.2);
      context.fillText('0.00', 7, height * 0.52);
      context.fillText('-0.50', 7, height * 0.84);

      context.save();
      context.shadowColor = glow;
      context.shadowBlur = severe ? 14 + Math.sin(nowSeconds * 16) * 5 : 10;
      context.strokeStyle = color;
      context.lineWidth = severe ? 1.8 : 1.35;
      context.beginPath();
      for (let point = 0; point <= width; point += 1) {
        const progress = point / width;
        const time = nowSeconds - viewSeconds + progress * viewSeconds;
        const phase = time * current.frequencyHz * Math.PI * 2;
        const waveform = Math.sin(phase) * amplitude;
        const rocofModulation = Math.sin(time * 3.1) * current.rocofHzPerSecond * 6;
        const y = height * 0.5 - waveform - rocofModulation;
        if (point === 0) context.moveTo(point, y);
        else context.lineTo(point, y);
      }
      context.stroke();
      context.restore();

      context.strokeStyle = 'rgba(202, 248, 255, 0.35)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, height * 0.5 + 0.5);
      context.lineTo(width, height * 0.5 + 0.5);
      context.stroke();
      animationFrame = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    animationFrame = requestAnimationFrame(draw);
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrame);
    };
  }, []);

  return (
    <section className="oscilloscope-panel glass-panel" aria-label="Live 60 hertz AC waveform oscilloscope">
      <div className="oscilloscope-heading">
        <div><p className="eyebrow">LIVE POWER WAVEFORM</p><h2>AC / FREQ OSCILLOSCOPE</h2></div>
        <span className={`scope-status ${telemetry.gridState.toLowerCase()}`}><i />60 Hz REF</span>
      </div>
      <canvas ref={canvasRef} className="oscilloscope-canvas" />
      <div className="oscilloscope-readout">
        <span>FREQ <strong>{formatNumber(telemetry.frequencyHz, 3)} Hz</strong></span>
        <span>VOLT <strong>{formatNumber(telemetry.voltageKv, 1)} kV</strong></span>
        <span>ROCOF <strong>{formatNumber(telemetry.rocofHzPerSecond, 3)} Hz/s</strong></span>
      </div>
    </section>
  );
}
