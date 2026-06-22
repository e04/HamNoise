import { useEffect, useRef, useState } from "react";
import { Box, Stack, Text } from "@mantine/core";

// Zone boundaries on the 0-100 meter scale (which maps -60dB..0dB).
// Green up to -18dB, yellow up to -6dB, red up to 0dB — like a pro mixer.
const GREEN_END = 70; // -18 dB
const YELLOW_END = 90; // -6 dB

const GREEN = "var(--mantine-color-green-6)";
const YELLOW = "var(--mantine-color-yellow-5)";
const RED = "var(--mantine-color-red-6)";

const METER_GRADIENT = `linear-gradient(to right,
  ${GREEN} 0%,
  ${GREEN} ${GREEN_END}%,
  ${YELLOW} ${GREEN_END}%,
  ${YELLOW} ${YELLOW_END}%,
  ${RED} ${YELLOW_END}%,
  ${RED} 100%)`;

// Hold the peak for a moment, then let it fall back slowly, the way a
// hardware peak-hold indicator does.
const PEAK_HOLD_MS = 1000;
const PEAK_DECAY_PER_MS = 0.025; // ~25 units/sec (≈15 dB/s) fall rate

function usePeakHold(level: number): number {
  const [peak, setPeak] = useState(0);
  const levelRef = useRef(level);
  levelRef.current = level;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let value = 0;
    let holdUntil = 0;

    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      const current = Math.max(0, Math.min(100, levelRef.current));

      if (current >= value) {
        value = current;
        holdUntil = now + PEAK_HOLD_MS;
      } else if (now > holdUntil) {
        value = Math.max(current, value - dt * PEAK_DECAY_PER_MS);
      }

      setPeak(value);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return peak;
}

interface MeterProps {
  label: string;
  level: number;
}

const Meter = ({ label, level }: MeterProps) => {
  const clamped = Math.max(0, Math.min(100, level));
  const peak = usePeakHold(level);

  return (
    <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
      <Text size="xs" fw={700} c="gray.4" lh={1.1}>
        {label}
      </Text>
      <Box
        style={{
          position: "relative",
          height: 12,
          overflow: "hidden",
          borderRadius: 2,
          backgroundColor: "var(--mantine-color-dark-6)",
          backgroundImage: METER_GRADIENT,
        }}
      >
        {/* Mask the unfilled portion with the track color. */}
        <Box
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            height: "100%",
            width: `${100 - clamped}%`,
            backgroundColor: "var(--mantine-color-dark-6)",
            transition: "width 70ms linear",
          }}
        />
        {/* Peak-hold marker. */}
        <Box
          style={{
            position: "absolute",
            top: 0,
            left: `${peak}%`,
            height: "100%",
            width: 2,
            transform: "translateX(-1px)",
            backgroundColor: "var(--mantine-color-gray-5)",
            opacity: peak > 0 ? 1 : 0,
          }}
        />
      </Box>
    </Stack>
  );
};

interface MetersProps {
  inputLevel: number;
  outputLevel: number;
}

export const Meters = ({ inputLevel, outputLevel }: MetersProps) => (
  <Box style={{ display: "flex", gap: "var(--mantine-spacing-md)" }}>
    <Meter label="INPUT LEVEL" level={inputLevel} />
    <Meter label="OUTPUT LEVEL" level={outputLevel} />
  </Box>
);
