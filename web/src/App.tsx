import { Box, Container, Flex, Stack, Text } from "@mantine/core";
import { useDenoise } from "./hooks/useDenoise";
import { INPUT_SOURCES, MODEL_OPTIONS } from "./audio/const";
import {
  AudioSelectControl,
  SliderControl,
  SquareControlButton,
  type SelectOption,
} from "./components/ControlPrimitives";
import { Meters } from "./components/Meters";
import { Scopes } from "./components/Scopes";

const REPO_URL = "https://github.com/e04/HamNoise";

function deviceOptions(
  devices: readonly MediaDeviceInfo[],
  fallbackLabel: string,
): SelectOption[] {
  return [
    { value: "", label: fallbackLabel },
    ...devices.map((device, index) => ({
      value: device.deviceId,
      label: device.label || `${fallbackLabel} ${index + 1}`,
    })),
  ];
}

// A controlled <select> only stays selected when its value is a known option;
// fall back to the default entry otherwise (e.g. a saved device that is gone).
function resolveValue(options: readonly SelectOption[], value: string): string {
  return options.some((option) => option.value === value) ? value : "";
}

function App() {
  const denoise = useDenoise();
  const {
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
  } = denoise;

  const inputOptions = deviceOptions(devices.inputs, "Default input");
  const outputOptions = deviceOptions(devices.outputs, "Default output");
  const isMicrophone = source === INPUT_SOURCES.microphone;
  const modelLabel = MODEL_OPTIONS.find((option) => option.value === modelId)?.label ?? "CW";

  return (
    <Container size={800} px={0} py={8}>
      <Stack gap={8}>
        <Box px={8}>
          <a href={REPO_URL} style={{ textDecoration: "none" }}>
            <Text
              size="xl"
              fw={800}
              c="white"
              style={{
                fontFamily: '"Doto", monospace',
                letterSpacing: "0.03em",
              }}
            >
              HamNoise
            </Text>
          </a>
        </Box>

        <Box px={8}>
          <Stack gap={12}>
            <Flex gap="sm" wrap="wrap">
              <SquareControlButton
                title="POWER"
                valueLabel={running ? "ON" : "OFF"}
                onClick={running ? stop : start}
                disabled={!supported}
                color={running ? "green" : "red"}
                borderStyle={
                  running
                    ? "1px solid var(--mantine-color-green-6)"
                    : "1px solid var(--mantine-color-pink-9)"
                }
              />
              <SquareControlButton
                title="SOURCE"
                valueLabel={isMicrophone ? "MIC" : "TAB"}
                onClick={() =>
                  setSource(
                    isMicrophone ? INPUT_SOURCES.browserTab : INPUT_SOURCES.microphone,
                  )
                }
              />
              <SquareControlButton
                title="MODEL"
                valueLabel={modelLabel}
                onClick={() => setModelId(modelId === 0 ? 1 : 0)}
              />
            </Flex>

            <Flex gap="sm" wrap="wrap">
              <AudioSelectControl
                style={{ flex: "1 1 240px" }}
                label="INPUT"
                data={inputOptions}
                value={resolveValue(inputOptions, inputDeviceId)}
                onChange={(event) => setInputDeviceId(event.currentTarget.value)}
                disabled={!isMicrophone}
              />
              <AudioSelectControl
                style={{ flex: "1 1 240px" }}
                label="OUTPUT"
                data={outputOptions}
                value={resolveValue(outputOptions, outputDeviceId)}
                onChange={(event) => setOutputDeviceId(event.currentTarget.value)}
                disabled={!devices.canSelectOutput}
              />
            </Flex>

            <Flex gap="sm" wrap="wrap">
              <SliderControl
                label="WET"
                valueLabel={`${Math.round(wet * 100)}%`}
                value={wet}
                min={0}
                max={1}
                step={0.01}
                onChange={setWet}
                toggleOnClick
              />
              <SliderControl
                label="OUTPUT GAIN"
                valueLabel={`${gain.toFixed(2)}×`}
                value={gain}
                min={0}
                max={2}
                step={0.01}
                onChange={setGain}
              />
            </Flex>
          </Stack>
        </Box>

        <Box px={8}>
          <Meters inputLevel={inputLevel} outputLevel={outputLevel} />
        </Box>

        <Box px={8}>
          <Scopes
            registerInputScope={denoise.registerInputScope}
            registerOutputScope={denoise.registerOutputScope}
          />
        </Box>

        <Box px={8}>
          <Flex justify="right">
            <Text component="a" c="dimmed" href="https://github.com/e04/">
              Copyright © 2026 e04
            </Text>
          </Flex>
        </Box>
      </Stack>
    </Container>
  );
}

export default App;
