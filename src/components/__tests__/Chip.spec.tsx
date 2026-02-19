import React from "react";
import renderer, { act } from "react-test-renderer";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock parcial de react-native para controlar useColorScheme sin romper el resto
vi.mock("react-native", async () => {
  const actual: any = await vi.importActual("react-native");
  return {
    ...actual,
    useColorScheme: vi.fn(),
  };
});

import * as RN from "react-native";
import Chip from "../Chip";

describe("Chip", () => {
  let tree: renderer.ReactTestRenderer | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    tree = null;
  });

  afterEach(() => {
    // Limpia renderers para evitar leaks entre tests
    if (tree) {
      act(() => {
        tree!.unmount();
      });
      tree = null;
    }
  });

  it("renderiza en modo light y aplica estilos no seleccionados", () => {
    (RN.useColorScheme as unknown as ReturnType<typeof vi.fn>).mockReturnValue("light");

    act(() => {
      tree = renderer.create(<Chip label="UCI Adulto" selected={false} testID="chip" />);
    });

    const pressable = tree!.root.findByProps({ testID: "chip" });

    expect(pressable.props.accessibilityRole).toBe("button");
    expect(pressable.props.accessibilityLabel).toBe("UCI Adulto");
    expect(pressable.props.accessibilityState).toEqual({ selected: false, disabled: undefined });

    const styleFn = pressable.props.style as (s: { pressed: boolean }) => any;

    const stylePressed = styleFn({ pressed: true });
    const styleNotPressed = styleFn({ pressed: false });

    expect(stylePressed[1].opacity).toBe(0.9);
    expect(styleNotPressed[1].opacity).toBe(1);

    expect(styleNotPressed[1].backgroundColor).toBe("#E5E7EB"); // light.bg
    expect(styleNotPressed[1].borderColor).toBe("#CBD5E1"); // light.border

    const text = tree!.root.findByType(RN.Text);
    const textStyles = text.props.style;
    expect(textStyles[1].color).toBe("#111827"); // light.text
  });

  it("renderiza en modo dark y aplica estilos seleccionados", () => {
    (RN.useColorScheme as unknown as ReturnType<typeof vi.fn>).mockReturnValue("dark");

    act(() => {
      tree = renderer.create(<Chip label="Neuro UCI" selected testID="chip" />);
    });

    const pressable = tree!.root.findByProps({ testID: "chip" });
    const styleFn = pressable.props.style as (s: { pressed: boolean }) => any;
    const styles = styleFn({ pressed: false });

    expect(styles[1].backgroundColor).toBe("#1D4ED8"); // dark.bgSelected
    expect(styles[1].borderColor).toBe("#475569"); // dark.border

    const text = tree!.root.findByType(RN.Text);
    const textStyles = text.props.style;
    expect(textStyles[1].color).toBe("#FFFFFF"); // selected => textSelected
  });

  it("llama onPress cuando no está disabled", () => {
    (RN.useColorScheme as unknown as ReturnType<typeof vi.fn>).mockReturnValue("light");

    const onPress = vi.fn();

    act(() => {
      tree = renderer.create(<Chip label="Oncología" onPress={onPress} testID="chip" />);
    });

    const pressable = tree!.root.findByProps({ testID: "chip" });

    act(() => {
      pressable.props.onPress?.();
    });

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("no expone onPress cuando disabled=true", () => {
    (RN.useColorScheme as unknown as ReturnType<typeof vi.fn>).mockReturnValue("light");

    const onPress = vi.fn();

    act(() => {
      tree = renderer.create(<Chip label="Urgencias" onPress={onPress} disabled testID="chip" />);
    });

    const pressable = tree!.root.findByProps({ testID: "chip" });

    expect(pressable.props.accessibilityState).toEqual({ selected: false, disabled: true });
    expect(pressable.props.onPress).toBeUndefined();
  });

  it("respeta style y textStyle overrides", () => {
    (RN.useColorScheme as unknown as ReturnType<typeof vi.fn>).mockReturnValue("light");

    act(() => {
      tree = renderer.create(
        <Chip
          label="Pediatría"
          testID="chip"
          style={{ marginRight: 99 }}
          textStyle={{ fontSize: 20 }}
        />
      );
    });

    const pressable = tree!.root.findByProps({ testID: "chip" });
    const styleFn = pressable.props.style as (s: { pressed: boolean }) => any;
    const styles = styleFn({ pressed: false });

    expect(styles[2]).toEqual({ marginRight: 99 });

    const text = tree!.root.findByType(RN.Text);
    const textStyles = text.props.style;

    expect(textStyles[2]).toEqual({ fontSize: 20 });
  });
});
