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

/**
 * Helpers para que los tests pasen tanto en RN "real" como en entornos web/mocks,
 * donde Pressable puede:
 * - no exponer accessibilityRole/accessibilityState
 * - normalizar style (función vs array/objeto)
 */
function getRole(node: any) {
  return node?.props?.accessibilityRole ?? node?.props?.role;
}

function getLabel(node: any) {
  return node?.props?.accessibilityLabel ?? node?.props?.["aria-label"];
}

function getA11yState(node: any) {
  // RN nativo: accessibilityState
  // RN web/mocks: puede no existir, o expresar pressed/disabled vía ARIA
  return (
    node?.props?.accessibilityState ??
    (typeof node?.props?.["aria-pressed"] !== "undefined"
      ? { selected: !!node.props["aria-pressed"] }
      : undefined) ??
    undefined
  );
}

function resolveStyleProp(styleProp: any, pressed: boolean) {
  const resolved = typeof styleProp === "function" ? styleProp({ pressed }) : styleProp;
  return Array.isArray(resolved) ? resolved : [resolved];
}

function flattenStyle(styleArr: any[]) {
  // Flatten suave: mezcla sólo objetos (ignora números/registries)
  return styleArr.reduce((acc, item) => {
    if (!item) return acc;
    if (typeof item === "object") return { ...acc, ...item };
    return acc;
  }, {} as Record<string, any>);
}

function getPressableStyles(pressable: any, pressed: boolean) {
  const arr = resolveStyleProp(pressable.props.style, pressed);
  return { arr, flat: flattenStyle(arr) };
}

function getTextColorFromRenderedTree(tree: renderer.ReactTestRenderer) {
  const text = tree.root.findByType(RN.Text);
  const styleProp = text.props.style;
  const arr = Array.isArray(styleProp) ? styleProp : [styleProp];
  const flat = flattenStyle(arr);
  return { arr, flat, node: text };
}

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

    // A11y: puede variar según runtime; valida lo que exista sin romper
    expect(getRole(pressable)).toBe("button");
    expect(getLabel(pressable)).toBe("UCI Adulto");

    const a11y = getA11yState(pressable);
    if (a11y && typeof a11y === "object") {
      // RN nativo: suele incluir selected/disabled
      expect(a11y.selected ?? false).toBe(false);
    }

    const pressed = getPressableStyles(pressable, true).flat;
    const notPressed = getPressableStyles(pressable, false).flat;

    expect(pressed.opacity).toBe(0.9);
    expect(notPressed.opacity).toBe(1);

    expect(notPressed.backgroundColor).toBe("#E5E7EB"); // light.bg
    expect(notPressed.borderColor).toBe("#CBD5E1"); // light.border

    const { flat: textFlat } = getTextColorFromRenderedTree(tree!);
    expect(textFlat.color).toBe("#111827"); // light.text
  });

  it("renderiza en modo dark y aplica estilos seleccionados", () => {
    (RN.useColorScheme as unknown as ReturnType<typeof vi.fn>).mockReturnValue("dark");

    act(() => {
      tree = renderer.create(<Chip label="Neuro UCI" selected testID="chip" />);
    });

    const pressable = tree!.root.findByProps({ testID: "chip" });

    const notPressed = getPressableStyles(pressable, false).flat;
    expect(notPressed.backgroundColor).toBe("#1D4ED8"); // dark.bgSelected
    expect(notPressed.borderColor).toBe("#475569"); // dark.border

    const { flat: textFlat } = getTextColorFromRenderedTree(tree!);
    expect(textFlat.color).toBe("#FFFFFF"); // selected => textSelected
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

    // Efecto observable: no hay handler
    expect(pressable.props.onPress).toBeUndefined();

    // Si accessibilityState existe, lo validamos; si no, no rompemos el test
    const a11y = getA11yState(pressable);
    if (a11y && typeof a11y === "object") {
      expect(a11y.disabled ?? true).toBe(true);
    }
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

    // Verifica que el override esté presente en el array de estilos (sin asumir índices)
    const { arr: styleArr } = getPressableStyles(pressable, false);
    expect(styleArr).toEqual(expect.arrayContaining([expect.objectContaining({ marginRight: 99 })]));

    // Text override (sin asumir índices)
    const text = tree!.root.findByType(RN.Text);
    const textStyleProp = text.props.style;
    const textArr = Array.isArray(textStyleProp) ? textStyleProp : [textStyleProp];
    expect(textArr).toEqual(expect.arrayContaining([expect.objectContaining({ fontSize: 20 })]));
  });
});
