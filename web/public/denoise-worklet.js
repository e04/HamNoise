const DOWNSAMPLE_FILTER_RADIUS = 128;
const UPSAMPLE_FILTER_RADIUS = 16;
const RENDER_QUANTUM_SAMPLES = 128;
const OUTPUT_LATENCY_HOPS = 6;
const OUTPUT_RAMP_SECONDS = 0.03;
const MODEL_FADE_SECONDS = 0.08;

class Fifo {
  constructor(capacity) {
    this.values = new Float32Array(capacity);
    this.capacity = capacity;
    this.readIndex = 0;
    this.writeIndex = 0;
    this.lengthValue = 0;
  }

  push(value) {
    if (this.lengthValue >= this.capacity) {
      this.readIndex = (this.readIndex + 1) % this.capacity;
      this.lengthValue -= 1;
    }
    this.values[this.writeIndex] = Number.isFinite(value) ? value : 0;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    this.lengthValue += 1;
  }

  shift() {
    if (this.lengthValue <= 0) return 0;
    const value = this.values[this.readIndex];
    this.readIndex = (this.readIndex + 1) % this.capacity;
    this.lengthValue -= 1;
    return value;
  }

  get length() {
    return this.lengthValue;
  }

  clear() {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.lengthValue = 0;
  }
}

class ScopeBuffer {
  constructor(capacity) {
    this.values = new Float32Array(capacity);
    this.capacity = capacity;
    this.writeIndex = 0;
    this.lengthValue = 0;
  }

  push(value) {
    this.values[this.writeIndex] = Number.isFinite(value) ? value : 0;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.lengthValue < this.capacity) this.lengthValue += 1;
  }

  drain() {
    const output = new Float32Array(this.lengthValue);
    const start = (this.writeIndex - this.lengthValue + this.capacity) % this.capacity;
    const firstCount = Math.min(this.lengthValue, this.capacity - start);
    output.set(this.values.subarray(start, start + firstCount), 0);
    if (firstCount < this.lengthValue) {
      output.set(this.values.subarray(0, this.lengthValue - firstCount), firstCount);
    }
    this.clear();
    return output;
  }

  clear() {
    this.writeIndex = 0;
    this.lengthValue = 0;
  }
}

class SincResampler {
  constructor(fromRate, toRate, onSample, radius) {
    this.fromRate = fromRate;
    this.toRate = toRate;
    this.onSample = onSample;
    this.radius = radius;
    this.step = fromRate / toRate;
    this.position = 0;
    this.baseIndex = -radius;
    this.buffer = new Array(radius).fill(0);
    this.cutoff = Math.min(fromRate, toRate) * 0.475;
    this.cutoffNorm = this.cutoff / fromRate;
  }

  process(input) {
    for (let i = 0; i < input.length; i += 1) this.buffer.push(input[i]);

    const lastIndex = this.baseIndex + this.buffer.length - 1;
    while (this.position + this.radius <= lastIndex) {
      this.onSample(this.sampleAt(this.position));
      this.position += this.step;
    }

    const keepFrom = Math.floor(this.position) - this.radius - 1;
    const drop = Math.max(0, keepFrom - this.baseIndex);
    if (drop > 0) {
      this.buffer.splice(0, drop);
      this.baseIndex += drop;
    }
  }

  sampleAt(position) {
    const center = Math.floor(position);
    let acc = 0;
    let weightSum = 0;

    for (let index = center - this.radius; index <= center + this.radius; index += 1) {
      const sample = this.buffer[index - this.baseIndex] ?? 0;
      const distance = position - index;
      const absDistance = Math.abs(distance);
      if (absDistance > this.radius) continue;

      const sincArg = 2 * this.cutoffNorm * distance;
      const sinc = Math.abs(sincArg) < 1e-8
        ? 1
        : Math.sin(Math.PI * sincArg) / (Math.PI * sincArg);
      const x = absDistance / this.radius;
      const window = 0.42 + (0.5 * Math.cos(Math.PI * x)) + (0.08 * Math.cos(2 * Math.PI * x));
      const weight = 2 * this.cutoffNorm * sinc * window;
      acc += sample * weight;
      weightSum += weight;
    }

    return Math.abs(weightSum) > 1e-8 ? acc / weightSum : 0;
  }

  reset() {
    this.position = 0;
    this.baseIndex = -this.radius;
    this.buffer = new Array(this.radius).fill(0);
  }
}

class DenoiseWorklet extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.enabled = true;
    this.wet = 1;
    this.gain = 1;
    this.modelId = 0;
    this.ready = false;
    this.error = null;
    this.denoiseRate = 9600;
    this.hopLength = 144;
    this.inputBins = 129;
    this.hopFill = 0;
    this.inputRms = 0;
    this.outputRms = 0;
    this.gains = new Float32Array(this.inputBins);
    this.inputHop = null;
    this.outputHop = null;
    this.gainsView = null;
    this.resampleInput = new Float32Array(this.hopLength);
    this.outputQueue = new Fifo(Math.max(16384, Math.ceil(sampleRate * 2)));
    this.scopeOutputQueue = new Fifo(Math.max(16384, Math.ceil(sampleRate * 2)));
    this.downsampler = new SincResampler(
      sampleRate,
      this.denoiseRate,
      (sample) => this.acceptDenoiseSample(sample),
      DOWNSAMPLE_FILTER_RADIUS
    );
    this.upsampler = new SincResampler(
      this.denoiseRate,
      sampleRate,
      (sample) => this.outputQueue.push(sample),
      UPSAMPLE_FILTER_RADIUS
    );
    this.scopeUpsampler = new SincResampler(
      this.denoiseRate,
      sampleRate,
      (sample) => this.scopeOutputQueue.push(sample),
      UPSAMPLE_FILTER_RADIUS
    );
    this.outputPrimed = false;
    this.outputLatencySamples = this.calculateOutputLatencySamples();
    this.outputRampSamples = this.calculateOutputRampSamples();
    this.outputRampRemaining = 0;
    this.modelFadeSamples = this.calculateModelFadeSamples();
    this.modelFadeRemaining = this.modelFadeSamples;
    this.lastOutputSample = 0;
    this.maxScopeSamples = Math.max(4096, Math.ceil(sampleRate * 0.25));
    this.scopeInput = new ScopeBuffer(this.maxScopeSamples);
    this.scopeOutput = new ScopeBuffer(this.maxScopeSamples);
    this.wasmBytes = options?.processorOptions?.wasmBytes ?? null;

    this.port.onmessage = (event) => this.handleMessage(event.data);
    this.loadWasm();
  }

  async loadWasm() {
    try {
      if (!this.wasmBytes) {
        throw new Error("denoise.wasm bytes were not provided");
      }
      const result = await WebAssembly.instantiate(this.wasmBytes, {
        env: {
          memory: new WebAssembly.Memory({ initial: 256 }),
          emscripten_notify_memory_growth: () => {},
        },
        wasi_snapshot_preview1: {
          proc_exit: () => {},
        },
      });

      this.exports = result.instance.exports;
      const status = this.exports.denoise_web_init();
      if (status !== 0) throw new Error(`denoise init failed: ${status}`);
      if (typeof this.exports.denoise_web_set_model === "function") {
        const modelStatus = this.exports.denoise_web_set_model(this.modelId);
        if (modelStatus !== 0) throw new Error(`model select failed: ${modelStatus}`);
      }

      this.denoiseRate = this.exports.denoise_web_sample_rate();
      this.hopLength = this.exports.denoise_web_hop_length();
      this.inputBins = this.exports.denoise_web_input_bins();
      this.gains = new Float32Array(this.inputBins);
      this.resampleInput = new Float32Array(this.hopLength);

      const memory = this.exports.memory;
      const inputPtr = this.exports.denoise_web_input_ptr();
      const outputPtr = this.exports.denoise_web_output_ptr();
      const gainsPtr = this.exports.denoise_web_gains_ptr();
      this.inputHop = new Float32Array(memory.buffer, inputPtr, this.hopLength);
      this.outputHop = new Float32Array(memory.buffer, outputPtr, this.hopLength);
      this.gainsView = new Float32Array(memory.buffer, gainsPtr, this.inputBins);
      this.downsampler = new SincResampler(
        sampleRate,
        this.denoiseRate,
        (sample) => this.acceptDenoiseSample(sample),
        DOWNSAMPLE_FILTER_RADIUS
      );
      this.upsampler = new SincResampler(
        this.denoiseRate,
        sampleRate,
        (sample) => this.outputQueue.push(sample),
        UPSAMPLE_FILTER_RADIUS
      );
      this.scopeUpsampler = new SincResampler(
        this.denoiseRate,
        sampleRate,
        (sample) => this.scopeOutputQueue.push(sample),
        UPSAMPLE_FILTER_RADIUS
      );
      this.outputQueue.clear();
      this.scopeOutputQueue.clear();
      this.outputPrimed = false;
      this.outputLatencySamples = this.calculateOutputLatencySamples();
      this.outputRampSamples = this.calculateOutputRampSamples();
      this.outputRampRemaining = 0;
      this.modelFadeSamples = this.calculateModelFadeSamples();
      this.modelFadeRemaining = this.modelFadeSamples;
      this.lastOutputSample = 0;
      this.ready = true;
      this.port.postMessage({ type: "ready" });
    } catch (error) {
      this.error = error;
      this.port.postMessage({ type: "error", message: error.message || String(error) });
    }
  }

  handleMessage(data) {
    if (data.type === "params") {
      this.enabled = Boolean(data.enabled);
      this.wet = Math.max(0, Math.min(1, Number(data.wet)));
      this.gain = Math.max(0, Math.min(2, Number(data.gain)));
      const nextModelId = Number(data.modelId);
      if (Number.isInteger(nextModelId) && nextModelId !== this.modelId) {
        this.modelId = nextModelId;
        if (this.ready && typeof this.exports?.denoise_web_set_model === "function") {
          const status = this.exports.denoise_web_set_model(this.modelId);
          if (status !== 0) {
            this.port.postMessage({ type: "error", message: `model select failed: ${status}` });
          } else {
            this.startModelFade();
          }
        }
      }
    } else if (data.type === "meter") {
      this.port.postMessage({
        type: "meter",
        inputRms: this.inputRms,
        outputRms: this.outputRms,
        sampleRate,
        inputScope: this.scopeInput.drain(),
        outputScope: this.scopeOutput.drain(),
      });
    }
  }

  startModelFade() {
    this.modelFadeSamples = this.calculateModelFadeSamples();
    this.modelFadeRemaining = this.modelFadeSamples;
    this.gains.fill(0);
  }

  appendScopeSample(target, value) {
    target.push(value);
  }

  calculateOutputLatencySamples() {
    const hopDurationSamples = (this.hopLength * sampleRate) / this.denoiseRate;
    return Math.max(
      RENDER_QUANTUM_SAMPLES * 2,
      Math.ceil(hopDurationSamples * OUTPUT_LATENCY_HOPS)
    );
  }

  calculateOutputRampSamples() {
    return Math.max(RENDER_QUANTUM_SAMPLES, Math.ceil(sampleRate * OUTPUT_RAMP_SECONDS));
  }

  calculateModelFadeSamples() {
    return Math.max(this.hopLength, Math.ceil(this.denoiseRate * MODEL_FADE_SECONDS));
  }

  nextModelFadeGain() {
    if (this.modelFadeRemaining <= 0) return 1;
    const gain = 1 - (this.modelFadeRemaining / this.modelFadeSamples);
    this.modelFadeRemaining -= 1;
    return Math.max(0, Math.min(1, gain));
  }

  acceptDenoiseSample(sample) {
    if (!this.ready) return;
    this.inputHop[this.hopFill] = sample;
    this.hopFill += 1;
    if (this.hopFill < this.hopLength) return;

    const produced = this.exports.denoise_web_process_hop(1);
    if (produced >= 0) {
      this.gains.set(this.gainsView);
      const resampleInput = this.resampleInput;
      for (let i = 0; i < this.hopLength; i += 1) {
        const dry = this.inputHop[i];
        const processed = produced ? this.outputHop[i] : 0;
        const modelFade = this.nextModelFadeGain();
        resampleInput[i] = this.enabled ? dry + (processed - dry) * this.wet * modelFade : dry;
      }
      this.upsampler.process(resampleInput);
      this.scopeUpsampler.process(produced ? this.outputHop : this.inputHop);
    }
    this.hopFill = 0;
  }

  nextOutputSample() {
    if (!this.outputPrimed) {
      if (this.outputQueue.length < this.outputLatencySamples) return 0;
      this.outputPrimed = true;
      this.outputRampRemaining = this.outputRampSamples;
    }

    if (this.outputQueue.length <= 0) {
      this.outputPrimed = false;
      this.outputRampRemaining = 0;
      this.lastOutputSample *= 0.98;
      return this.lastOutputSample;
    }

    let value = this.outputQueue.shift();
    if (this.outputRampRemaining > 0) {
      const ramp = 1 - (this.outputRampRemaining / this.outputRampSamples);
      value *= ramp;
      this.outputRampRemaining -= 1;
    }
    this.lastOutputSample = value;
    return value;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;

    if (!input || !this.ready) {
      output.fill(0);
      return true;
    }

    let inEnergy = 0;
    for (let i = 0; i < input.length; i += 1) {
      const value = input[i];
      inEnergy += value * value;
      this.appendScopeSample(this.scopeInput, value);
    }
    this.inputRms = Math.sqrt(inEnergy / input.length);

    this.downsampler.process(input);

    let outEnergy = 0;
    for (let i = 0; i < output.length; i += 1) {
      const value = Math.max(-1, Math.min(1, this.nextOutputSample() * this.gain));
      output[i] = value;
      outEnergy += value * value;
      this.appendScopeSample(this.scopeOutput, this.nextScopeOutputSample());
    }
    this.outputRms = Math.sqrt(outEnergy / output.length);
    return true;
  }

  nextScopeOutputSample() {
    if (!this.outputPrimed || this.scopeOutputQueue.length <= 0) return 0;
    return Math.max(-1, Math.min(1, this.scopeOutputQueue.shift()));
  }
}

registerProcessor("denoise-worklet", DenoiseWorklet);
