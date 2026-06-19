const inputSourceSelect = document.querySelector("#inputSource");
const inputSelect = document.querySelector("#inputDevice");
const outputSelect = document.querySelector("#outputDevice");
const modelSelect = document.querySelector("#modelSelect");
const startButton = document.querySelector("#startButton");
const stopButton = document.querySelector("#stopButton");
const enabledToggle = document.querySelector("#enabledToggle");
const wetControl = document.querySelector("#wetControl");
const gainControl = document.querySelector("#gainControl");
const statusEl = document.querySelector("#status");
const inputMeter = document.querySelector("#inputMeter");
const outputMeter = document.querySelector("#outputMeter");
const monitor = document.querySelector("#monitor");
const inputScopeCanvas = document.querySelector("#inputScope");
const outputScopeCanvas = document.querySelector("#outputScope");
const assetVersion = "sr-9600-voice-switch-stateful-fade";
const displayMaxFrequency = 4800;

let audioContext = null;
let mediaStream = null;
let sourceNode = null;
let workletNode = null;
let destinationNode = null;
let meterTimer = null;
let wasmBytesPromise = null;

const inputSources = {
  microphone: "microphone",
  browserTab: "browser-tab",
};

gainControl.value = "1";

class WaterfallScope {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.fftSize = 1024;
    this.hopSize = 256;
    this.maxFrequency = displayMaxFrequency;
    this.samples = [];
    this.window = Float32Array.from({ length: this.fftSize }, (_, index) => {
      return 0.5 - (0.5 * Math.cos((2 * Math.PI * index) / (this.fftSize - 1)));
    });
    this.clear();
  }

  clear() {
    const { width, height } = this.canvas;
    this.samples = [];
    this.ctx.fillStyle = "#05070a";
    this.ctx.fillRect(0, 0, width, height);
    this.drawGrid();
  }

  append(samples, sampleRate) {
    if (!samples?.length || !Number.isFinite(sampleRate) || sampleRate <= 0) return;
    for (let i = 0; i < samples.length; i += 1) this.samples.push(samples[i]);
    while (this.samples.length >= this.fftSize) {
      this.drawFrame(this.samples.slice(0, this.fftSize), sampleRate);
      this.samples.splice(0, this.hopSize);
    }
    const maxBuffered = this.fftSize * 4;
    if (this.samples.length > maxBuffered) {
      this.samples.splice(0, this.samples.length - maxBuffered);
    }
  }

  drawFrame(frame, sampleRate) {
    const { width, height } = this.canvas;
    this.ctx.drawImage(this.canvas, 0, 1, width, height - 1, 0, 0, width, height - 1);

    const magnitudes = this.calculateMagnitudes(frame, sampleRate);
    const y = height - 1;
    for (let x = 0; x < width; x += 1) {
      const index = Math.floor((x / Math.max(1, width - 1)) * (magnitudes.length - 1));
      this.ctx.fillStyle = this.colorForLevel(magnitudes[index]);
      this.ctx.fillRect(x, y, 1, 1);
    }
  }

  calculateMagnitudes(frame, sampleRate) {
    const maxBin = Math.max(1, Math.min(this.fftSize / 2, Math.floor((this.maxFrequency / sampleRate) * this.fftSize)));
    const magnitudes = new Float32Array(maxBin + 1);
    for (let bin = 0; bin <= maxBin; bin += 1) {
      let re = 0;
      let im = 0;
      const phaseStep = (-2 * Math.PI * bin) / this.fftSize;
      for (let i = 0; i < this.fftSize; i += 1) {
        const phase = phaseStep * i;
        const value = frame[i] * this.window[i];
        re += value * Math.cos(phase);
        im += value * Math.sin(phase);
      }
      const magnitude = Math.sqrt((re * re) + (im * im)) / (this.fftSize * 0.5);
      const db = 20 * Math.log10(magnitude + 1e-8);
      magnitudes[bin] = Math.max(0, Math.min(1, (db + 90) / 70));
    }
    return magnitudes;
  }

  colorForLevel(level) {
    const v = Math.max(0, Math.min(1, level));
    const stops = [
      [5, 7, 10],
      [18, 42, 84],
      [20, 132, 150],
      [232, 128, 42],
      [255, 246, 191],
    ];
    const scaled = v * (stops.length - 1);
    const index = Math.min(stops.length - 2, Math.floor(scaled));
    const mix = scaled - index;
    const a = stops[index];
    const b = stops[index + 1];
    const r = Math.round(a[0] + ((b[0] - a[0]) * mix));
    const g = Math.round(a[1] + ((b[1] - a[1]) * mix));
    const blue = Math.round(a[2] + ((b[2] - a[2]) * mix));
    return `rgb(${r}, ${g}, ${blue})`;
  }

  drawGrid() {
    const { width, height } = this.canvas;
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
    this.ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      const x = Math.round((width * i) / 4) + 0.5;
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, height);
      this.ctx.stroke();
    }
  }
}

const inputScope = new WaterfallScope(inputScopeCanvas);
const outputScope = new WaterfallScope(outputScopeCanvas);

const setStatus = (text) => {
  statusEl.textContent = text;
};

const dbFromRms = (rms) => {
  if (!Number.isFinite(rms) || rms <= 0.000001) return -Infinity;
  return 20 * Math.log10(rms);
};

const meterWidth = (db) => {
  if (!Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
};

const canSelectOutputDevice = () => {
  const canSetAudioContextSink = typeof AudioContext !== "undefined"
    && typeof AudioContext.prototype.setSinkId === "function";
  return typeof monitor.setSinkId === "function" || canSetAudioContextSink;
};

async function enumerateDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((device) => device.kind === "audioinput");
  const outputs = devices.filter((device) => device.kind === "audiooutput");

  fillSelect(inputSelect, inputs, "Default input");
  fillSelect(outputSelect, outputs, "Default output");
  outputSelect.disabled = !canSelectOutputDevice();
}

function fillSelect(select, devices, fallbackLabel) {
  const selected = select.value;
  select.replaceChildren();

  const defaultOption = new Option(fallbackLabel, "");
  select.append(defaultOption);

  devices.forEach((device, index) => {
    const label = device.label || `${fallbackLabel} ${index + 1}`;
    select.append(new Option(label, device.deviceId));
  });

  if ([...select.options].some((option) => option.value === selected)) {
    select.value = selected;
  }
}

function updateInputControls() {
  inputSelect.disabled = inputSourceSelect.value !== inputSources.microphone;
}

function postParams() {
  if (!workletNode) return;
  workletNode.port.postMessage({
    type: "params",
    enabled: enabledToggle.checked,
    wet: Number(wetControl.value),
    gain: Number(gainControl.value),
    modelId: Number(modelSelect.value),
  });
}

function loadWasmBytes() {
  if (!wasmBytesPromise) {
    wasmBytesPromise = fetch(`./denoise.wasm?v=${assetVersion}`).then((response) => {
      if (!response.ok) {
        throw new Error(`WASM load failed: ${response.status}`);
      }
      return response.arrayBuffer();
    });
  }
  return wasmBytesPromise;
}

async function startDemo() {
  stopDemo();
  const inputSource = inputSourceSelect.value;
  setStatus(inputSource === inputSources.browserTab ? "choose tab" : "starting");

  mediaStream = await createInputStream(inputSource);
  addInputEndedHandlers(mediaStream);
  if (inputSource === inputSources.microphone) await enumerateDevices();

  audioContext = new AudioContext({ latencyHint: "playback" });
  const wasmBytes = await loadWasmBytes();
  await audioContext.audioWorklet.addModule(`./denoise-worklet.js?v=${assetVersion}`);

  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  workletNode = new AudioWorkletNode(audioContext, "denoise-worklet", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { wasmBytes },
  });
  workletNode.port.onmessage = handleWorkletMessage;

  sourceNode.connect(workletNode);
  await connectOutputRoute();

  meterTimer = window.setInterval(requestMeters, 100);
  postParams();
  startButton.disabled = true;
  stopButton.disabled = false;
  updateInputControls();
}

async function createInputStream(inputSource) {
  if (inputSource === inputSources.browserTab) {
    return createTabAudioStream();
  }

  const inputDeviceId = inputSelect.value;
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

async function createTabAudioStream() {
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
    preferCurrentTab: false,
    selfBrowserSurface: "exclude",
    systemAudio: "include",
    surfaceSwitching: "include",
  });

  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("no tab audio shared");
  }

  return stream;
}

function addInputEndedHandlers(stream) {
  const stopIfCurrent = () => {
    if (mediaStream === stream) stopDemo("input ended");
  };
  stream.getTracks().forEach((track) => {
    track.addEventListener("ended", stopIfCurrent, { once: true });
  });
}

function disconnectOutputRoute() {
  if (workletNode) {
    try {
      workletNode.disconnect();
    } catch (error) {
      // The route may already be disconnected while switching devices or stopping.
    }
  }
  if (destinationNode) {
    destinationNode.disconnect();
    destinationNode = null;
  }
  monitor.pause();
  monitor.srcObject = null;
}

async function connectOutputRoute() {
  if (!audioContext || !workletNode) return;

  disconnectOutputRoute();

  const outputDeviceId = outputSelect.value;
  if (!outputDeviceId || typeof audioContext.setSinkId === "function") {
    if (typeof audioContext.setSinkId === "function") {
      await audioContext.setSinkId(outputDeviceId);
    }
    workletNode.connect(audioContext.destination);
    await audioContext.resume();
    return;
  }

  destinationNode = audioContext.createMediaStreamDestination();
  workletNode.connect(destinationNode);
  monitor.srcObject = destinationNode.stream;
  if (typeof monitor.setSinkId === "function") {
    await monitor.setSinkId(outputDeviceId);
  }
  await monitor.play();
}

function requestMeters() {
  if (!workletNode) return;
  workletNode.port.postMessage({ type: "meter" });
}

function handleWorkletMessage(event) {
  if (event.data.type === "meter") {
    updateMeters(event.data);
  } else if (event.data.type === "ready") {
    postParams();
    setStatus("running");
  } else if (event.data.type === "error") {
    setStatus(event.data.message);
  }
}

function updateMeters(data) {
  const inDb = dbFromRms(data.inputRms);
  const outDb = dbFromRms(data.outputRms);
  inputMeter.style.width = `${meterWidth(inDb)}%`;
  outputMeter.style.width = `${meterWidth(outDb)}%`;
  inputScope.append(data.inputScope, data.sampleRate);
  outputScope.append(data.outputScope, data.sampleRate);
}

function stopDemo(statusText = "idle") {
  if (meterTimer !== null) {
    window.clearInterval(meterTimer);
    meterTimer = null;
  }
  if (sourceNode) sourceNode.disconnect();
  disconnectOutputRoute();
  if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop());
  if (audioContext) audioContext.close();

  sourceNode = null;
  workletNode = null;
  destinationNode = null;
  mediaStream = null;
  audioContext = null;
  monitor.srcObject = null;

  startButton.disabled = false;
  stopButton.disabled = true;
  updateInputControls();
  inputScope.clear();
  outputScope.clear();
  setStatus(statusText);
}

startButton.addEventListener("click", () => {
  startDemo().catch((error) => {
    console.error(error);
    stopDemo();
    setStatus(error.message || "failed");
  });
});
stopButton.addEventListener("click", stopDemo);
enabledToggle.addEventListener("input", postParams);
wetControl.addEventListener("input", postParams);
gainControl.addEventListener("input", postParams);
modelSelect.addEventListener("input", postParams);
inputSelect.addEventListener("change", () => {
  if (!workletNode) return;
  startDemo().catch((error) => {
    console.error(error);
    stopDemo();
    setStatus(error.message || "failed");
  });
});
outputSelect.addEventListener("change", async () => {
  if (!workletNode) return;
  connectOutputRoute().catch((error) => {
    console.error(error);
    stopDemo();
    setStatus(error.message || "failed");
  });
});
inputSourceSelect.addEventListener("change", () => {
  updateInputControls();
  if (!workletNode) return;
  startDemo().catch((error) => {
    console.error(error);
    stopDemo();
    setStatus(error.message || "failed");
  });
});

if (!navigator.mediaDevices?.getUserMedia) {
  setStatus("getUserMedia unavailable");
} else {
  enumerateDevices().catch((error) => setStatus(error.message));
  navigator.mediaDevices.addEventListener("devicechange", enumerateDevices);
}
updateInputControls();
