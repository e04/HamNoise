import { isAppleMobilePlatform } from "./platform";

const EXTERNAL_AUDIO_INPUT_RE =
  /\b(airpods|earpods|beats|bluetooth|headset|headphones|usb|external|dock|display|continuity|car)\b/i;

const IOS_BUILT_IN_MIC_BOOST_DB = 20;

export const IOS_BUILT_IN_MIC_BOOST_LINEAR = Math.pow(
  10,
  IOS_BUILT_IN_MIC_BOOST_DB / 20,
);

function isLikelyBuiltInAppleMobileMicLabel(label: string): boolean {
  const normalizedLabel = label.trim().toLowerCase();
  const normalizedBaseLabel = normalizedLabel.replace(/^default\s*-\s*/, "");
  if (!normalizedLabel || EXTERNAL_AUDIO_INPUT_RE.test(normalizedLabel)) {
    return false;
  }

  if (
    normalizedBaseLabel.startsWith("iphone") ||
    normalizedBaseLabel.startsWith("ipad")
  ) {
    return true;
  }

  return normalizedLabel === "microphone" && isAppleMobilePlatform();
}

function getTrackDeviceId(track: MediaStreamTrack | null): string {
  if (!track || typeof track.getSettings !== "function") {
    return "";
  }

  return track.getSettings().deviceId ?? "";
}

function getActiveAudioInputLabels(
  stream: MediaStream | null,
  selectedAudioInput: string,
  audioInputDevices: readonly MediaDeviceInfo[],
): string[] {
  const labels = new Set<string>();
  const track = stream?.getAudioTracks()[0] ?? null;

  if (track?.label) {
    labels.add(track.label);
  }

  const candidateDeviceIds = new Set<string>();
  if (selectedAudioInput) {
    candidateDeviceIds.add(selectedAudioInput);
  }

  const trackDeviceId = getTrackDeviceId(track);
  if (trackDeviceId) {
    candidateDeviceIds.add(trackDeviceId);
  }

  if (candidateDeviceIds.size > 0) {
    audioInputDevices.forEach((device) => {
      if (candidateDeviceIds.has(device.deviceId) && device.label) {
        labels.add(device.label);
      }
    });
  } else {
    audioInputDevices.forEach((device) => {
      const normalizedLabel = device.label.trim().toLowerCase();
      if (
        device.label &&
        (device.deviceId === "default" || normalizedLabel.startsWith("default"))
      ) {
        labels.add(device.label);
      }
    });

    if (labels.size === 0 && audioInputDevices.length === 1) {
      const onlyDeviceLabel = audioInputDevices[0]?.label ?? "";
      if (onlyDeviceLabel) {
        labels.add(onlyDeviceLabel);
      }
    }
  }

  return Array.from(labels);
}

/**
 * iOS built-in mics capture much quieter than desktop/USB mics, so on Apple
 * mobile we boost the built-in mic by +20 dB before denoising. Returns a linear
 * multiplier (1 = no boost). External inputs (AirPods, USB, etc.) are left
 * untouched. Ported from web-deep-cw-decoder-pro.
 */
export function getAutoInputGainLinear(
  stream: MediaStream | null,
  selectedAudioInput: string,
  audioInputDevices: readonly MediaDeviceInfo[],
): number {
  if (!isAppleMobilePlatform()) {
    return 1;
  }

  const activeLabels = getActiveAudioInputLabels(
    stream,
    selectedAudioInput,
    audioInputDevices,
  );

  return activeLabels.some(isLikelyBuiltInAppleMobileMicLabel)
    ? IOS_BUILT_IN_MIC_BOOST_LINEAR
    : 1;
}
