// tests/__mocks__/@testing-library-react-native.ts
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

type ReactTestRenderer = TestRenderer.ReactTestRenderer;
type ReactTestInstance = TestRenderer.ReactTestInstance;

type RenderResult = {
  root: ReactTestInstance;
  getByText: (text: string | RegExp) => ReactTestInstance;
  queryByText: (text: string | RegExp) => ReactTestInstance | null;
  toJSON: () =>
    | TestRenderer.ReactTestRendererJSON
    | TestRenderer.ReactTestRendererJSON[]
    | null;
  update: (element: React.ReactElement) => void;
  unmount: () => void;
};

export function render(element: React.ReactElement): RenderResult {
  let renderer!: ReactTestRenderer;

  act(() => {
    renderer = TestRenderer.create(element);
  });

  const root = renderer.root;

  const matchText = (node: ReactTestInstance, matcher: string | RegExp) => {
    const text = node.props.children;
    if (typeof text !== 'string') return false;

    if (typeof matcher === 'string') {
      return text.includes(matcher);
    }
    return matcher.test(text);
  };

  function getByText(text: string | RegExp): ReactTestInstance {
    return root.find((node) => matchText(node, text));
  }

  function queryByText(text: string | RegExp): ReactTestInstance | null {
    try {
      return getByText(text);
    } catch {
      return null;
    }
  }

  return {
    root,
    getByText,
    queryByText,
    toJSON: () => renderer.toJSON(),
    update: (el) =>
      act(() => {
        renderer.update(el);
      }),
    unmount: () =>
      act(() => {
        renderer.unmount();
      }),
  };
}

export const fireEvent = {
  press(target: any) {
    const props = target?.props ?? {};
    const parentProps = target?.parent?.props ?? {};
    if (props.disabled || parentProps.disabled) return;

    const handler =
      typeof props.onPress === 'function'
        ? props.onPress
        : typeof props.onClick === 'function'
          ? props.onClick
        : typeof parentProps.onPress === 'function'
          ? parentProps.onPress
          : typeof parentProps.onClick === 'function'
            ? parentProps.onClick
          : null;
    if (handler) {
      handler({});
    }
  },
  changeText(target: any, value: string) {
    if (typeof target.props.onChangeText === 'function') {
      target.props.onChangeText(value);
    }
  },
};

export async function waitFor(
  callback: () => void | Promise<void>,
): Promise<void> {
  await act(async () => {
    await callback();
  });
}

export const screen = {
  render,
};

const defaultExport = {
  render,
  fireEvent,
  waitFor,
  screen,
};

export default defaultExport;
