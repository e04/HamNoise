import { Box, Flex, Stack, Text } from "@mantine/core";
import { DISPLAY_MAX_FREQUENCY } from "../audio/const";

interface ScopeProps {
  label: string;
  registerCanvas: (canvas: HTMLCanvasElement | null) => void;
}

const FREQ_RANGE_LABEL = `0-${(DISPLAY_MAX_FREQUENCY / 1000).toFixed(1)} kHz`;

const Scope = ({ label, registerCanvas }: ScopeProps) => (
  <Box className="scope-shell" style={{ flex: 1, minWidth: 0 }}>
    <Flex justify="space-between" mb={8}>
      <Text size="xs" fw={700} c="gray.4" lh={1.1}>
        {label}
      </Text>
      <Text size="xs" fw={700} c="gray.5" lh={1.1}>
        {FREQ_RANGE_LABEL}
      </Text>
    </Flex>
    <canvas ref={registerCanvas} width={720} height={180} aria-label={`${label} waterfall scope`} />
  </Box>
);

interface ScopesProps {
  registerInputScope: (canvas: HTMLCanvasElement | null) => void;
  registerOutputScope: (canvas: HTMLCanvasElement | null) => void;
}

export const Scopes = ({ registerInputScope, registerOutputScope }: ScopesProps) => (
  <Stack gap="md">
    <Scope label="ORIGINAL" registerCanvas={registerInputScope} />
    <Scope label="DENOISED" registerCanvas={registerOutputScope} />
  </Stack>
);
