import { useCallback, useEffect, useRef, useState } from "react";
import {
  DenoiseEngine,
  type DeviceState,
  type MeterMessage,
} from "../audio/denoiseEngine";
import { WaterfallScope } from "../audio/waterfallScope";
import { INPUT_SOURCES, dbFromRms, meterWidth, type InputSource } from "../audio/const";
import { usePersistedState } from "./usePersistedState";

const isInputSource = (value: unknown): value is InputSource =>
  value === INPUT_SOURCES.microphone || value === INPUT_SOURCES.browserTab;
const isString = (value: unknown): value is string => typeof value === "string";
const isModelId = (value: unknown): value is number => value === 0 || value === 1;
const isUnitRange = (value: unknown): value is number =>
  typeof value === "number" && value >= 0 && value <= 1;
const isGainRange = (value: unknown): value is number =>
  typeof value === "number" && value >= 0 && value <= 2;

const EMPTY_DEVICES: DeviceState = { inputs: [], outputs: [], canSelectOutput: false };

export function useDenoise() {
  const engineRef = useRef<DenoiseEngine | null>(null);
  const inputScopeRef = useRef<WaterfallScope | null>(null);
  const outputScopeRef = useRef<WaterfallScope | null>(null);
  const lastMeterPaintRef = useRef(0);

  const [running, setRunning] = useState(false);
  const [devices, setDevices] = useState<DeviceState>(EMPTY_DEVICES);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [supported] = useState(() => Boolean(navigator.mediaDevices?.getUserMedia));

  const [source, setSource] = usePersistedState<InputSource>(
    "source",
    INPUT_SOURCES.microphone,
    isInputSource,
  );
  const [inputDeviceId, setInputDeviceId] = usePersistedState("inputDeviceId", "", isString);
  const [outputDeviceId, setOutputDeviceId] = usePersistedState("outputDeviceId", "", isString);
  const [modelId, setModelId] = usePersistedState<number>("modelId", 0, isModelId);
  const [wet, setWet] = usePersistedState<number>("wet", 1, isUnitRange);
  const [gain, setGain] = usePersistedState<number>("gain", 1, isGainRange);

  // Create the engine once. It captures the initial persisted values; later
  // changes are pushed through the sync effects below.
  useEffect(() => {
    const engine = new DenoiseEngine(
      {
        onRunningChange: setRunning,
        onDevices: setDevices,
        onMeters: (data: MeterMessage) => {
          // The pump runs at display refresh (~60Hz) for a smooth waterfall, but
          // the meter bars only need ~15Hz (the 70ms CSS transition smooths the
          // rest), so throttle the React state updates to avoid 60 re-renders/s.
          const now = performance.now();
          if (now - lastMeterPaintRef.current >= 66) {
            lastMeterPaintRef.current = now;
            setInputLevel(meterWidth(dbFromRms(data.inputRms)));
            setOutputLevel(meterWidth(dbFromRms(data.outputRms)));
          }
          inputScopeRef.current?.append(data.inputScope, data.sampleRate);
          outputScopeRef.current?.append(data.outputScope, data.sampleRate);
        },
      },
      {
        source,
        inputDeviceId,
        outputDeviceId,
        // Denoising is always on; the worklet still expects an `enabled` flag.
        params: { enabled: true, wet, gain, modelId },
      },
    );
    engineRef.current = engine;

    if (supported) {
      engine.enumerateDevices().catch((error) => console.error(error));
      navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
    }

    function onDeviceChange() {
      engine.enumerateDevices().catch(() => undefined);
    }

    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setParams({ enabled: true, wet, gain, modelId });
  }, [wet, gain, modelId]);

  useEffect(() => {
    engineRef.current?.setSource(source);
  }, [source]);

  useEffect(() => {
    engineRef.current?.setInputDeviceId(inputDeviceId);
  }, [inputDeviceId]);

  useEffect(() => {
    engineRef.current?.setOutputDeviceId(outputDeviceId);
  }, [outputDeviceId]);

  const start = useCallback(() => engineRef.current?.start(), []);
  const stop = useCallback(() => engineRef.current?.stop(), []);

  const registerInputScope = useCallback((canvas: HTMLCanvasElement | null) => {
    inputScopeRef.current = canvas ? new WaterfallScope(canvas) : null;
  }, []);
  const registerOutputScope = useCallback((canvas: HTMLCanvasElement | null) => {
    outputScopeRef.current = canvas ? new WaterfallScope(canvas) : null;
  }, []);

  return {
    running,
    supported,
    devices,
    inputLevel,
    outputLevel,
    source,
    setSource,
    inputDeviceId,
    setInputDeviceId,
    outputDeviceId,
    setOutputDeviceId,
    modelId,
    setModelId,
    wet,
    setWet,
    gain,
    setGain,
    start,
    stop,
    registerInputScope,
    registerOutputScope,
  };
}
