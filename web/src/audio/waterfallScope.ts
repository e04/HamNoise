import { DISPLAY_MAX_FREQUENCY } from "./const";

// Scrolling waterfall spectrogram rendered with a hand-rolled DFT, ported
// from the original vanilla web UI.
export class WaterfallScope {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly fftSize = 1024;
  private readonly hopSize = 256;
  private readonly maxFrequency = DISPLAY_MAX_FREQUENCY;
  private readonly window: Float32Array;
  // Twiddle-factor tables so the per-column DFT does array lookups instead of
  // calling Math.cos/Math.sin ~200k times per frame on the main thread.
  private readonly cosTable: Float32Array;
  private readonly sinTable: Float32Array;
  private samples: number[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2d canvas context unavailable");
    this.ctx = ctx;
    this.window = Float32Array.from({ length: this.fftSize }, (_, index) => {
      return 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (this.fftSize - 1));
    });
    this.cosTable = new Float32Array(this.fftSize);
    this.sinTable = new Float32Array(this.fftSize);
    for (let k = 0; k < this.fftSize; k += 1) {
      const phase = (-2 * Math.PI * k) / this.fftSize;
      this.cosTable[k] = Math.cos(phase);
      this.sinTable[k] = Math.sin(phase);
    }
    this.clear();
  }

  clear(): void {
    const { width, height } = this.canvas;
    this.samples = [];
    this.ctx.fillStyle = "#05070a";
    this.ctx.fillRect(0, 0, width, height);
  }

  append(samples: Float32Array | undefined, sampleRate: number): void {
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

  private drawFrame(frame: number[], sampleRate: number): void {
    const { width, height } = this.canvas;
    this.ctx.drawImage(this.canvas, 1, 0, width - 1, height, 0, 0, width - 1, height);

    const magnitudes = this.calculateMagnitudes(frame, sampleRate);
    const x = width - 1;
    for (let y = 0; y < height; y += 1) {
      const frequencyPosition = 1 - y / Math.max(1, height - 1);
      const index = Math.floor(frequencyPosition * (magnitudes.length - 1));
      this.ctx.fillStyle = this.colorForLevel(magnitudes[index]);
      this.ctx.fillRect(x, y, 1, 1);
    }
  }

  private calculateMagnitudes(frame: number[], sampleRate: number): Float32Array {
    const maxBin = Math.max(
      1,
      Math.min(this.fftSize / 2, Math.floor((this.maxFrequency / sampleRate) * this.fftSize)),
    );
    const magnitudes = new Float32Array(maxBin + 1);
    // Pre-window the frame once instead of multiplying inside every bin loop.
    const windowed = new Float32Array(this.fftSize);
    for (let i = 0; i < this.fftSize; i += 1) windowed[i] = frame[i] * this.window[i];

    const mask = this.fftSize - 1; // fftSize is a power of two, so (k & mask) == k % fftSize
    for (let bin = 0; bin <= maxBin; bin += 1) {
      let re = 0;
      let im = 0;
      let k = 0;
      for (let i = 0; i < this.fftSize; i += 1) {
        const value = windowed[i];
        re += value * this.cosTable[k];
        im += value * this.sinTable[k];
        k = (k + bin) & mask;
      }
      const magnitude = Math.sqrt(re * re + im * im) / (this.fftSize * 0.5);
      const db = 20 * Math.log10(magnitude + 1e-8);
      magnitudes[bin] = Math.max(0, Math.min(1, (db + 90) / 70));
    }
    return magnitudes;
  }

  private colorForLevel(level: number): string {
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
    const r = Math.round(a[0] + (b[0] - a[0]) * mix);
    const g = Math.round(a[1] + (b[1] - a[1]) * mix);
    const blue = Math.round(a[2] + (b[2] - a[2]) * mix);
    return `rgb(${r}, ${g}, ${blue})`;
  }
}
