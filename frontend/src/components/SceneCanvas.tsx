import { useEffect, useRef, type ReactElement } from 'react';
import type { CameraMode } from '../lib/telemetry';
import { MissionScene } from '../scene/MissionScene';

interface SceneCanvasProps {
  load: number;
  cameraMode: CameraMode;
}

export function SceneCanvas({ load, cameraMode }: SceneCanvasProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<MissionScene | null>(null);

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const scene = new MissionScene(hostRef.current);
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setLoad(load / 100);
  }, [load]);

  useEffect(() => {
    sceneRef.current?.setCameraMode(cameraMode);
  }, [cameraMode]);

  return <div ref={hostRef} className="scene-host" aria-label="Interactive AETHERGRID digital twin" />;
}
