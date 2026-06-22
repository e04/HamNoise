export const ASSET_VERSION = "sr-9600-voice-switch-stateful-fade";
export const DISPLAY_MAX_FREQUENCY = 4800;

export const INPUT_SOURCES = {
  microphone: "microphone",
  browserTab: "browser-tab",
} as const;

export type InputSource = (typeof INPUT_SOURCES)[keyof typeof INPUT_SOURCES];

export const MODEL_OPTIONS = [
  { value: 0, label: "CW" },
  { value: 1, label: "Voice" },
] as const;

export const dbFromRms = (rms: number): number => {
  if (!Number.isFinite(rms) || rms <= 0.000001) return -Infinity;
  return 20 * Math.log10(rms);
};

// Map a level in dB to a 0-100 meter fill, matching the original web UI.
export const meterWidth = (db: number): number => {
  if (!Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
};
