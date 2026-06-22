import { getAutoInputGainLinear } from "./audioInputBoost";
import { ASSET_VERSION, INPUT_SOURCES, type InputSource } from "./const";

export interface DenoiseParams {
  enabled: boolean;
  wet: number;
  gain: number;
  modelId: number;
}

export interface MeterMessage {
  inputRms: number;
  outputRms: number;
  sampleRate: number;
  inputScope: Float32Array;
  outputScope: Float32Array;
}

export interface DeviceState {
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
  canSelectOutput: boolean;
}

export interface EngineCallbacks {
  onRunningChange: (running: boolean) => void;
  onDevices: (devices: DeviceState) => void;
  onMeters: (data: MeterMessage) => void;
}

export interface EngineInitialState {
  source: InputSource;
  inputDeviceId: string;
  outputDeviceId: string;
  params: DenoiseParams;
}

/**
 * Owns the Web Audio graph, the denoise AudioWorklet and the output routing.
 * Ported from the original vanilla `app.js`; the React layer drives it through
 * the setters and reads results via the callbacks.
 */
export class DenoiseEngine {
  private readonly callbacks: EngineCallbacks;
  private readonly monitor: HTMLAudioElement;

  private source: InputSource;
  private inputDeviceId: string;
  private outputDeviceId: string;
  private params: DenoiseParams;

  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private inputGainNode: GainNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private meterRaf: number | null = null;
  private wasmBytesPromise: Promise<ArrayBuffer> | null = null;
  private audioInputs: MediaDeviceInfo[] = [];

  constructor(callbacks: EngineCallbacks, initial: EngineInitialState) {
    this.callbacks = callbacks;
    this.source = initial.source;
    this.inputDeviceId = initial.inputDeviceId;
    this.outputDeviceId = initial.outputDeviceId;
    this.params = initial.params;

    this.monitor = document.createElement("audio");
    this.monitor.autoplay = true;
    this.monitor.setAttribute("playsinline", "");
    this.monitor.style.display = "none";
  }

  get isRunning(): boolean {
    return this.workletNode !== null;
  }

  private canSelectOutputDevice(): boolean {
    const canSetAudioContextSink =
      typeof AudioContext !== "undefined" &&
      typeof (AudioContext.prototype as { setSinkId?: unknown }).setSinkId === "function";
    return (
      typeof (this.monitor as { setSinkId?: unknown }).setSinkId === "function" ||
      canSetAudioContextSink
    );
  }

  async enumerateDevices(): Promise<void> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    this.audioInputs = devices.filter((device) => device.kind === "audioinput");
    this.callbacks.onDevices({
      inputs: this.audioInputs,
      outputs: devices.filter((device) => device.kind === "audiooutput"),
      canSelectOutput: this.canSelectOutputDevice(),
    });
  }

  setParams(params: DenoiseParams): void {
    this.params = params;
    this.postParams();
  }

  setSource(source: InputSource): void {
    if (this.source === source) return;
    this.source = source;
    if (this.isRunning) void this.restart();
  }

  setInputDeviceId(deviceId: string): void {
    if (this.inputDeviceId === deviceId) return;
    this.inputDeviceId = deviceId;
    if (this.isRunning) void this.restart();
  }

  setOutputDeviceId(deviceId: string): void {
    if (this.outputDeviceId === deviceId) return;
    this.outputDeviceId = deviceId;
    if (this.isRunning) {
      this.connectOutputRoute().catch((error) => this.fail(error));
    }
  }

  private postParams(): void {
    if (!this.workletNode) return;
    this.workletNode.port.postMessage({
      type: "params",
      enabled: this.params.enabled,
      wet: this.params.wet,
      gain: this.params.gain,
      modelId: this.params.modelId,
    });
  }

  private loadWasmBytes(): Promise<ArrayBuffer> {
    if (!this.wasmBytesPromise) {
      const url = `${import.meta.env.BASE_URL}denoise.wasm?v=${ASSET_VERSION}`;
      this.wasmBytesPromise = fetch(url).then((response) => {
        if (!response.ok) throw new Error(`WASM load failed: ${response.status}`);
        return response.arrayBuffer();
      });
    }
    return this.wasmBytesPromise;
  }

  private fail(error: unknown): void {
    console.error(error);
    this.stop();
  }

  start(): void {
    this.startInternal().catch((error) => this.fail(error));
  }

  private async restart(): Promise<void> {
    try {
      await this.startInternal();
    } catch (error) {
      this.fail(error);
    }
  }

  private async startInternal(): Promise<void> {
    this.stop();
    const inputSource = this.source;

    this.mediaStream = await this.createInputStream(inputSource);
    this.addInputEndedHandlers(this.mediaStream);
    if (inputSource === INPUT_SOURCES.microphone) await this.enumerateDevices();

    this.audioContext = new AudioContext({ latencyHint: "playback" });
    const wasmBytes = await this.loadWasmBytes();
    await this.audioContext.audioWorklet.addModule(
      `${import.meta.env.BASE_URL}denoise-worklet.js?v=${ASSET_VERSION}`,
    );

    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.workletNode = new AudioWorkletNode(this.audioContext, "denoise-worklet", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { wasmBytes },
    });
    this.workletNode.port.onmessage = (event) => this.handleWorkletMessage(event);

    // iOS built-in mics capture very quietly; boost them before denoising.
    // Returns 1 (no boost) off Apple mobile or for external inputs.
    const inputBoost =
      inputSource === INPUT_SOURCES.microphone
        ? getAutoInputGainLinear(this.mediaStream, this.inputDeviceId, this.audioInputs)
        : 1;
    if (inputBoost !== 1) {
      this.inputGainNode = this.audioContext.createGain();
      this.inputGainNode.gain.value = inputBoost;
      this.sourceNode.connect(this.inputGainNode);
      this.inputGainNode.connect(this.workletNode);
    } else {
      this.sourceNode.connect(this.workletNode);
    }
    await this.connectOutputRoute();

    // Drive scope/meter updates off the display refresh so the waterfall
    // scrolls smoothly instead of jumping ~10 times per second.
    const pump = () => {
      this.requestMeters();
      this.meterRaf = requestAnimationFrame(pump);
    };
    this.meterRaf = requestAnimationFrame(pump);
    this.postParams();
    this.callbacks.onRunningChange(true);
  }

  private async createInputStream(inputSource: InputSource): Promise<MediaStream> {
    if (inputSource === INPUT_SOURCES.browserTab) {
      return this.createTabAudioStream();
    }

    const inputDeviceId = this.inputDeviceId;
    return navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: inputDeviceId ? { exact: inputDeviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
  }

  private async createTabAudioStream(): Promise<MediaStream> {
    if (typeof navigator.mediaDevices.getDisplayMedia !== "function") {
      throw new Error("tab audio capture unavailable");
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: true,
      // Non-standard hints honored by Chromium for tab/system audio capture.
      preferCurrentTab: false,
      selfBrowserSurface: "exclude",
      systemAudio: "include",
      surfaceSwitching: "include",
    } as DisplayMediaStreamOptions);

    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("no tab audio shared");
    }

    return stream;
  }

  private addInputEndedHandlers(stream: MediaStream): void {
    const stopIfCurrent = () => {
      if (this.mediaStream === stream) this.stop();
    };
    stream.getTracks().forEach((track) => {
      track.addEventListener("ended", stopIfCurrent, { once: true });
    });
  }

  private disconnectOutputRoute(): void {
    if (this.workletNode) {
      try {
        this.workletNode.disconnect();
      } catch {
        // The route may already be disconnected while switching devices or stopping.
      }
    }
    if (this.destinationNode) {
      this.destinationNode.disconnect();
      this.destinationNode = null;
    }
    this.monitor.pause();
    this.monitor.srcObject = null;
  }

  private async connectOutputRoute(): Promise<void> {
    if (!this.audioContext || !this.workletNode) return;

    this.disconnectOutputRoute();

    const outputDeviceId = this.outputDeviceId;
    const contextWithSink = this.audioContext as AudioContext & {
      setSinkId?: (id: string) => Promise<void>;
    };
    if (!outputDeviceId || typeof contextWithSink.setSinkId === "function") {
      if (typeof contextWithSink.setSinkId === "function") {
        await contextWithSink.setSinkId(outputDeviceId);
      }
      this.workletNode.connect(this.audioContext.destination);
      await this.audioContext.resume();
      return;
    }

    this.destinationNode = this.audioContext.createMediaStreamDestination();
    this.workletNode.connect(this.destinationNode);
    this.monitor.srcObject = this.destinationNode.stream;
    const monitorWithSink = this.monitor as HTMLAudioElement & {
      setSinkId?: (id: string) => Promise<void>;
    };
    if (typeof monitorWithSink.setSinkId === "function") {
      await monitorWithSink.setSinkId(outputDeviceId);
    }
    await this.monitor.play();
  }

  private requestMeters(): void {
    if (!this.workletNode) return;
    this.workletNode.port.postMessage({ type: "meter" });
  }

  private handleWorkletMessage(event: MessageEvent): void {
    const data = event.data;
    if (data.type === "meter") {
      this.callbacks.onMeters(data as MeterMessage);
    } else if (data.type === "ready") {
      this.postParams();
    } else if (data.type === "error") {
      console.error("denoise worklet error:", data.message);
    }
  }

  stop(): void {
    if (this.meterRaf !== null) {
      cancelAnimationFrame(this.meterRaf);
      this.meterRaf = null;
    }
    if (this.sourceNode) this.sourceNode.disconnect();
    if (this.inputGainNode) this.inputGainNode.disconnect();
    this.disconnectOutputRoute();
    if (this.mediaStream) this.mediaStream.getTracks().forEach((track) => track.stop());
    if (this.audioContext) void this.audioContext.close();

    this.sourceNode = null;
    this.inputGainNode = null;
    this.workletNode = null;
    this.destinationNode = null;
    this.mediaStream = null;
    this.audioContext = null;
    this.monitor.srcObject = null;

    this.callbacks.onRunningChange(false);
  }

  dispose(): void {
    this.stop();
  }
}
