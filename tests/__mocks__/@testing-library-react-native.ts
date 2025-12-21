// tests/__mocks__/@testing-library-react-native.ts
import React from 'react';
import TestRenderer from 'react-test-renderer';

type ReactTestRenderer = TestRenderer.ReactTestRenderer;
type ReactTestInstance = TestRenderer.ReactTestInstance;

type RenderResult = {
  root: ReactTestInstance;
  getByText: (text: string | RegExp) => ReactTestInstance;
  queryByText: (text: string | RegExp) => ReactTestInstance | null;
  findByText: (text: string | RegExp) => Promise<ReactTestInstance>;
  getByLabelText: (text: string | RegExp) => ReactTestInstance;
  queryByLabelText: (text: string | RegExp) => ReactTestInstance | null;
  getByTestId: (testId: string | RegExp) => ReactTestInstance;
  queryByTestId: (testId: string | RegExp) => ReactTestInstance | null;
  getByPlaceholderText: (text: string | RegExp) => ReactTestInstance;
  queryByPlaceholderText: (text: string | RegExp) => ReactTestInstance | null;
  toJSON: () =>
    | TestRenderer.ReactTestRendererJSON
    | TestRenderer.ReactTestRendererJSON[]
    | null;
  update: (element: React.ReactElement) => void;
  unmount: () => void;
};

export function render(element: React.ReactElement): RenderResult {
  let renderer: ReactTestRenderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(element);
  });
  const root = renderer!.root;

  const matchText = (node: ReactTestInstance, matcher: string | RegExp) => {
    const text = node.props.children;
    if (typeof text !== 'string') return false;
    return typeof matcher === 'string' ? text.includes(matcher) : matcher.test(text);
  };

  const matchProp = (node: ReactTestInstance, prop: string, matcher: string | RegExp) => {
    const value = node.props?.[prop];
    if (typeof value !== 'string') return false;
    return typeof matcher === 'string' ? value === matcher : matcher.test(value);
  };
  const matchPlaceholder = (node: ReactTestInstance, matcher: string | RegExp) =>
    matchProp(node, 'placeholder', matcher);

  const getByText = (text: string | RegExp) => root.find((node) => matchText(node, text));
  const queryByText = (text: string | RegExp) => {
    try {
      return getByText(text);
    } catch {
      return null;
    }
  };

  const findByText = async (text: string | RegExp) => getByText(text);

  const getByLabelText = (text: string | RegExp) =>
    root.find((node) => matchProp(node, 'accessibilityLabel', text));
  const queryByLabelText = (text: string | RegExp) => {
    try {
      return getByLabelText(text);
    } catch {
      return null;
    }
  };

  const getByTestId = (testId: string | RegExp) => root.find((node) => matchProp(node, 'testID', testId));
  const queryByTestId = (testId: string | RegExp) => {
    try {
      return getByTestId(testId);
    } catch {
      return null;
    }
  };

  const getByPlaceholderText = (text: string | RegExp) => root.find((node) => matchPlaceholder(node, text));
  const queryByPlaceholderText = (text: string | RegExp) => {
    try {
      return getByPlaceholderText(text);
    } catch {
      return null;
    }
  };

  return {
    root,
    getByText,
    queryByText,
    findByText,
    getByLabelText,
    queryByLabelText,
    getByTestId,
    queryByTestId,
    getByPlaceholderText,
    queryByPlaceholderText,
    toJSON: () => renderer.toJSON(),
    update: (el) => renderer.update(el),
    unmount: () => renderer.unmount(),
  };
}

export function fireEvent(target: any, eventName?: string, ...args: any[]) {
  if (!target || !target.props) return;
  if (typeof eventName === 'string') {
    const propName =
      eventName === 'valueChange'
        ? 'onValueChange'
        : `on${eventName.charAt(0).toUpperCase()}${eventName.slice(1)}`;
    const handler = target.props[propName];
    if (typeof handler === 'function') {
      return TestRenderer.act(async () => {
        await handler(...args);
      });
    }
  }
}

fireEvent.press = (target: any) => {
  if (!target || !target.props) return;
  const handler = target.props.onPress ?? target.props.onClick;
  if (typeof handler === 'function') {
    return TestRenderer.act(async () => {
      await handler({});
    });
  }
};

fireEvent.changeText = (target: any, value: string) => {
  if (typeof target?.props?.onChangeText === 'function') {
    TestRenderer.act(() => {
      target.props.onChangeText(value);
    });
  }
};

export async function waitFor(
  callback: () => void | Promise<void>,
  { timeout = 200, interval = 10 }: { timeout?: number; interval?: number } = {},
) {
  const start = Date.now();
  // Pequeña implementación de waitFor que reintenta hasta que el callback no falle
  // o se alcance el timeout.
  // Uso mínimo para nuestros tests: sin configuraciones avanzadas.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await callback();
      return;
    } catch (error) {
      if (Date.now() - start >= timeout) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
}

export const screen = {
  render,
};

export const act = TestRenderer.act;

export default {
  render,
  fireEvent,
  waitFor,
  screen,
  act,
};
