import React from "react";
import renderer, { act } from "react-test-renderer";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock parcial de react-native para controlar useColorScheme
vi.mock("react-native", async () => {
  const actual: any = await vi.importActual("react-native");
  return {
    ...actual,
    useColorScheme: vi.fn(),
  };
});

import { useColorScheme } from "react-native";
import Chip from "../Chip";

describe("Chip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renderiza en modo light y aplica estilos no seleccionados", () => {
    (useColorScheme as unknown as ReturnType<typeof vi.fn>).mockReturnValue("light");

    const tree = renderer.create(<Chip label="UCI Adulto" selected={false} testID="chip" />);

    const pressable = tree.root.findByProps({ testID: "chip" });
    expect(pressable.props.accessibilityRole).toBe("button");
    expect(pressable.props.accessibilityLabel).toBe("UCI Adulto");
    expect(pressable.props.accessibilityState).toEqual({ selected: false, disabled: undefined });

    // Ejecuta el callback style() para cubrir la función y ramas pressed
    const styleFn = pressable.props.style as (s: { pressed: boolean }) => any;
    const stylePressed = styleFn({ pressed: true });
    const styleNotPressed = styleFn({ pressed: false });

    // styleFn devuelve un array: [base, dynamic, styleOverride]
    expect(Array.isArray(stylePressed)).toBe(true);
    expect(stylePressed[1].opacity).toBe(0.9);
    expect(styleNotPressed[1].opacity).toBe(1);

    // Verifica color base light (no seleccionado)
    expect(styleNotPressed[1].backgroundColor).toBe("#E5E7EB");
    expect(styleNotPressed[1].borderColor).toBe("#CBD5E1");

    const text = tree.root.findByType(require("react-native").Text);
    // Text styles también es array
    const textStyles = text.props.style;
    expect(Array.isArray(textStyles)).toBe(true);
    expect(textStyles[1].color).toBe("#111827");
  });

  it("renderiza en modo dark y aplica estilos seleccionados", () => {
    (useColorScheme as unknown as ReturnType<typeof vi.fn>).mockReturnValue("dark");

    const tree = renderer.create(<Chip label="Neuro UCI" selected testID="chip" />);

    const pressable = tree.root.findByProps({ testID: "chip" });
    const styleFn = pressable.props.style as (s: { pressed: boolean }) => any;
    const styles = styleFn({ pressed: false });

    expect(styles[1].backgroundColor).toBe("#1D4ED8"); // dark.bgSelected
    expect(styles[1].borderColor).toBe("#475569");     // dark.border

    const text = tree.root.findByType(require("react-native").Text);
    const textStyles = text.props.style;
    expect(textStyles[1].color).toBe("#FFFFFF"); // selected => textSelected
  });

  it("llama onPress cuando no está disabled", () => {
    (useColorScheme as unknown as ReturnType<typeof vi.fn>).mockReturnValue("light");

    const onPress = vi.fn();
    const tree = renderer.create(<Chip label="Oncología" onPress={onPress} testID="chip" />);

    const pressable = tree.root.findByProps({ testID: "chip" });

    act(() => {
      pressable.props.onPress?.();
    });

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("no expone onPress cuando disabled=true", () => {
    (useColorScheme as unknown as ReturnType<typeof vi.fn>).mockReturnValue("light");

    const onPress = vi.fn();
    const tree = renderer.create(
      <Chip label="Urgencias" onPress={onPress} disabled testID="chip" />
    );

    const pressable = tree.root.findByProps({ testID: "chip" });
    expect(pressable.props.accessibilityState).toEqual({ selected: false, disabled: true });
    expect(pressable.props.onPress).toBeUndefined();
  });

  it("respeta style y textStyle overrides", () => {
    (useColorScheme as unknown as ReturnType<typeof vi.fn>).mockReturnValue("light");

    const tree = renderer.create(
      <Chip
        label="Pediatría"
        testID="chip"
        style={{ marginRight: 99 }}
        textStyle={{ fontSize: 20 }}
      />
    );

    const pressable = tree.root.findByProps({ testID: "chip" });
    const styleFn = pressable.props.style as (s: { pressed: boolean }) => any;
    const styles = styleFn({ pressed: false });

    // styles[2] es el override pasado por props
    expect(styles[2]).toEqual({ marginRight: 99 });

    const text = tree.root.findByType(require("react-native").Text);
    const textStyles = text.props.style;
    // textStyles[2] es el override pasado por props
    expect(textStyles[2]).toEqual({ fontSize: 20 });
  });
});
