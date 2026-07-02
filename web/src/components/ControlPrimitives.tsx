import {
  useRef,
  useState,
  type ChangeEventHandler,
  type CSSProperties,
  type MouseEventHandler,
} from "react";
import { Box, Button, Slider, Stack, Text } from "@mantine/core";

export const CONTROL_BUTTON_SIZE_PX = 80;

export interface SelectOption {
  value: string;
  label: string;
}

const audioSelectOptionStyle: CSSProperties = {
  color: "#fff",
  backgroundColor: "#1a1b1e",
};

interface SquareControlButtonProps {
  title: string;
  valueLabel: string;
  onClick: () => void;
  disabled?: boolean;
  color?: string;
  borderStyle?: string;
}

// A square, left-aligned label/value tile — the DeepCW control button.
export const SquareControlButton = ({
  title,
  valueLabel,
  onClick,
  disabled = false,
  color,
  borderStyle,
}: SquareControlButtonProps) => (
  <Button
    variant="light"
    radius={4}
    onClick={onClick}
    disabled={disabled}
    color={color ?? "gray"}
    styles={{
      root: {
        width: `${CONTROL_BUTTON_SIZE_PX}px`,
        minWidth: `${CONTROL_BUTTON_SIZE_PX}px`,
        height: `${CONTROL_BUTTON_SIZE_PX}px`,
        padding: "8px",
        border: borderStyle,
        opacity: disabled ? 0.25 : 1,
      },
      inner: { height: "100%", width: "100%" },
      label: { height: "100%", width: "100%" },
    }}
  >
    <Stack
      gap={4}
      align="stretch"
      style={{
        height: "100%",
        justifyContent: "space-between",
        textAlign: "left",
        overflow: "hidden",
      }}
    >
      <Text size="xs" fw={700} c="gray.4" lh={1.1}>
        {title}
      </Text>
      <Text size="md" fw={700} c="gray.3" lh={1.15} style={{ wordBreak: "break-word" }}>
        {valueLabel}
      </Text>
    </Stack>
  </Button>
);

interface AudioSelectControlProps {
  label: string;
  data: readonly SelectOption[];
  value: string;
  onChange: ChangeEventHandler<HTMLSelectElement>;
  disabled?: boolean;
  style?: CSSProperties;
}

// A native <select> dressed as a control tile, matching DeepCW's INPUT/THRU.
export const AudioSelectControl = ({
  label,
  data,
  value,
  onChange,
  disabled = false,
  style,
}: AudioSelectControlProps) => {
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  const handleClick: MouseEventHandler<HTMLElement> = (event) => {
    if (
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLOptionElement
    ) {
      return;
    }
    const select = selectRef.current;
    if (!select) return;
    select.focus();
    try {
      select.showPicker?.();
    } catch {
      select.click();
    }
  };

  return (
    <Button
      component="label"
      variant="light"
      radius={4}
      color="gray"
      style={style}
      onClick={handleClick}
      onFocusCapture={() => setIsFocused(true)}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setIsFocused(false);
      }}
      data-disabled={disabled || undefined}
      styles={{
        root: {
          width: "100%",
          minWidth: 0,
          height: `${CONTROL_BUTTON_SIZE_PX}px`,
          padding: "8px",
          overflow: "visible",
          opacity: disabled ? 0.45 : 1,
          pointerEvents: disabled ? "none" : undefined,
          boxShadow: isFocused
            ? "0 0 0 calc(0.125rem * var(--mantine-scale)) var(--mantine-primary-color-filled)"
            : undefined,
        },
        inner: { height: "100%", width: "100%" },
        label: { height: "100%", width: "100%" },
      }}
    >
      <Stack
        gap={0}
        align="stretch"
        style={{
          width: "100%",
          height: "100%",
          justifyContent: "space-between",
          textAlign: "left",
          overflow: "hidden",
        }}
      >
        <Text size="xs" fw={700} c="gray.4" lh={1.1}>
          {label}
        </Text>
        <Box style={{ width: "100%", minWidth: 0 }}>
          <Box
            component="select"
            ref={selectRef}
            aria-label={label}
            value={value}
            disabled={disabled}
            onChange={onChange}
            style={{
              WebkitAppearance: "none",
              MozAppearance: "none",
              appearance: "none",
              display: "block",
              width: "100%",
              minWidth: 0,
              minHeight: "auto",
              height: "auto",
              padding: 0,
              border: 0,
              background: "transparent",
              boxShadow: "none",
              color: "var(--mantine-color-gray-3)",
              fontFamily: "inherit",
              fontSize: "var(--mantine-font-size-md)",
              fontWeight: 700,
              lineHeight: 1.15,
              textOverflow: "ellipsis",
              cursor: "pointer",
              outline: "none",
            }}
          >
            {data.map((option) => (
              <option key={option.value} value={option.value} style={audioSelectOptionStyle}>
                {option.label}
              </option>
            ))}
          </Box>
        </Box>
      </Stack>
    </Button>
  );
};

interface FileSelectControlProps {
  label: string;
  valueLabel: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  disabled?: boolean;
  style?: CSSProperties;
}

export const FileSelectControl = ({
  label,
  valueLabel,
  onChange,
  disabled = false,
  style,
}: FileSelectControlProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  return (
    <>
      <Button
        variant="light"
        radius={4}
        color="gray"
        style={style}
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        onFocusCapture={() => setIsFocused(true)}
        onBlurCapture={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setIsFocused(false);
        }}
        styles={{
          root: {
            width: "100%",
            minWidth: 0,
            height: `${CONTROL_BUTTON_SIZE_PX}px`,
            padding: "8px",
            overflow: "hidden",
            opacity: disabled ? 0.45 : 1,
            boxShadow: isFocused
              ? "0 0 0 calc(0.125rem * var(--mantine-scale)) var(--mantine-primary-color-filled)"
              : undefined,
          },
          inner: { height: "100%", width: "100%" },
          label: { height: "100%", width: "100%" },
        }}
      >
        <Stack
          gap={0}
          align="stretch"
          style={{
            width: "100%",
            height: "100%",
            justifyContent: "space-between",
            textAlign: "left",
            overflow: "hidden",
          }}
        >
          <Text size="xs" fw={700} c="gray.4" lh={1.1}>
            {label}
          </Text>
          <Text
            size="md"
            fw={700}
            c="gray.3"
            lh={1.15}
            style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {valueLabel}
          </Text>
        </Stack>
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        onChange={onChange}
        disabled={disabled}
        style={{ display: "none" }}
      />
    </>
  );
};

interface SliderControlProps {
  label: string;
  valueLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  // When true, clicking the tile outside the slider toggles between min and max.
  toggleOnClick?: boolean;
}

// A slider laid out as a control tile so it sits beside the square buttons.
export const SliderControl = ({
  label,
  valueLabel,
  value,
  min,
  max,
  step,
  onChange,
  toggleOnClick = false,
}: SliderControlProps) => {
  const sliderRef = useRef<HTMLDivElement | null>(null);

  const handleTileClick: MouseEventHandler<HTMLDivElement> = (event) => {
    if (!toggleOnClick) return;
    // Ignore clicks that land on the slider itself; only the surrounding tile toggles.
    if (sliderRef.current?.contains(event.target as Node | null)) return;
    onChange(value >= max ? min : max);
  };

  return (
  <Box
    onClick={handleTileClick}
    style={{
      flex: "1 1 200px",
      minWidth: 0,
      height: `${CONTROL_BUTTON_SIZE_PX}px`,
      padding: "10px 14px",
      borderRadius: 4,
      backgroundColor: "var(--mantine-color-gray-light)",
      cursor: toggleOnClick ? "pointer" : undefined,
    }}
  >
    <Stack gap={6} style={{ height: "100%", justifyContent: "space-between" }}>
      <Box
        style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}
      >
        <Text size="xs" fw={700} c="gray.4" lh={1.1}>
          {label}
        </Text>
        <Text size="sm" fw={700} c="gray.3" lh={1.1}>
          {valueLabel}
        </Text>
      </Box>
      <Box ref={sliderRef}>
        <Slider
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={onChange}
          label={null}
          color="gray.5"
          size="sm"
          styles={{
            bar: { backgroundColor: "var(--mantine-color-gray-5)" },
            thumb: {
              borderColor: "var(--mantine-color-gray-5)",
              backgroundColor: "var(--mantine-color-gray-3)",
            },
          }}
        />
      </Box>
    </Stack>
  </Box>
  );
};
