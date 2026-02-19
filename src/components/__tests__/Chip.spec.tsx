import React from "react";
import renderer, { act } from "react-test-renderer";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Mock de react-native "estable" para CI:
 * - Pressable y Text se convierten en host components ("RNPressable"/"RNText")
 *   para que react-test-renderer preserve props (accessibility*, style fn, onPress).
 * - StyleSheet.create devuelve el objeto tal cual (sin IDs numéricos).
 * - useColorScheme es controlable por test.
 */
vi.mock("react-native", async () => {
  const actual: any = await vi.importActual("react-native");

  const Pressable = (props: any) =>
    React.createElement("RNPressable", props, props.children);
  const Text = (props: any) => React.createElement("RNText", props, props.children);

  return {
    ...actual,
    Pressable,
    Text,
    StyleSheet: {
      ...(actual.StyleSheet ?? {}),
      create: (styles: any) => styles,
    },
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

    expect(pressable.type).toBe("RNPressable");
    expect(pressable.props.accessibilityRole).toBe("button");
    expect(pressable.props.accessibilityLabel).toBe("UCI Adulto");
    expect(pressable.props.accessibilityState).toEqual({ selected: false, disabled: undefined });

    const styleFn = pressable.props.style as (s: { pressed: boolean }) => any[];
    expect(typeof styleFn).toBe("function");

    const pressedStyles = styleFn({ pressed: true });
    const notPressedStyles = styleFn({ pressed: false });

    expect(Array.isArray(pressedStyles)).toBe(true);
    expect(Array.isArray(notPressedStyles)).toBe(true);

    // styles[0] = styles.base (de StyleSheet.create)
    // styles[1] = objeto dinámico (bg/border/opacity)
    expect(pressedStyles[1].opacity).toBe(0.9);
    expect(notPressedStyles[1].opacity).toBe(1);

    expect(notPressedStyles[1].backgroundColor).toBe("#E5E7EB"); // light.bg
    expect(notPressedStyles[1].borderColor).toBe("#CBD5E1"); // light.border

    const text = tree!.root.findByType("RNText");
    const textStyles = text.props.style as any[];
    expect(textStyles[1].color).toBe("#111827"); // light.text
    expect(text.props.children).toBe("UCI Adulto");
  });

  it("renderiza en modo dark y aplica estilos seleccionados", () => {
    (RN.useColorScheme as unknown as ReturnType<typeof vi.fn>).mockReturnValue("dark");

    act(() => {
      tree = renderer.create(<Chip label="Neuro UCI" selected testID="chip" />);
    });

    const pressable = tree!.root.findByProps({ testID: "chip" });

    const styleFn = pressable.props.style as (s: { pressed: boolean }) => any[];
    const styles = styleFn({ pressed: false });

    expect(styles[1].backgroundColor).toBe("#1D4ED8"); // dark.bgSelected
    expect(styles[1].borderColor).toBe("#475569"); // dark.border

    const text = tree!.root.findByType("RNText");
    const textStyles = text.props.style as any[];
    expect(textStyles[1].color).toBe("#FFFFFF"); // selected => textSelected
    expect(text.props.children).toBe("Neuro UCI");
  });

  it("llama onPress cuando no está disabled", () => {
    (RN.useColorScheme as unknown as ReturnType<typeof vi.fn>).mockReturnValue("light");
    const onPress = vi.fn();

    act(() => {
      tree = renderer.create(<Chip label="Oncología" onPress={onPress} testID="chip" />);
    });

    const pressable = tree!.root.findByProps({ testID: "chip" });

    // En nuestro Chip: onPress se pasa directo si disabled no está activo
    expect(typeof pressable.props.onPress).toBe("function");

    act(() => {
      pressable.props.onPress();
    });

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("cuando disabled=true NO llama onPress aunque se provea callback", () => {
    (RN.useColorScheme as unknown as ReturnType<typeof vi.fn>).mockReturnValue("light");
    const onPress = vi.fn();

    act(() => {
      tree = renderer.create(
        <Chip label="Urgencias" onPress={onPress} disabled testID="chip" />
      );
    });

    const pressable = tree!.root.findByProps({ testID: "chip" });

    // Lo importante (estable): el handler efectivo debe ser undefined
    expect(pressable.props.accessibilityState).toEqual({ selected: false, disabled: true });
    expect(pressable.props.onPress).toBeUndefined();

    // Extra defensa: aunque “forzáramos” algo raro, no debe llamarse
    act(() => {
      pressable.props.onPress?.();
    });
    expect(onPress).toHaveBeenCalledTimes(0);
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
    const styleFn = pressable.props.style as (s: { pressed: boolean }) => any[];
    const styles = styleFn({ pressed: false });

    // override va como último elemento (style)
    expect(styles[2]).toEqual({ marginRight: 99 });

    const text = tree!.root.findByType("RNText");
    const textStyles = text.props.style as any[];

    // override va como último elemento (textStyle)
    expect(textStyles[2]).toEqual({ fontSize: 20 });
  });
});
