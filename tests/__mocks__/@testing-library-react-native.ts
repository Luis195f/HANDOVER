// tests/__mocks__/@testing-library-react-native.ts
/// <reference types="vitest" />
import React from 'react';
import TestRenderer from 'react-test-renderer';

type ReactTestRenderer = TestRenderer.ReactTestRenderer;
type ReactTestInstance = TestRenderer.ReactTestInstance;

type RenderResult = {
  root: ReactTestInstance;
  getByText: (text: string | RegExp) => ReactTestInstance;
  getAllByText: (text: string | RegExp) => ReactTestInstance[];
  queryByText: (text: string | RegExp) => ReactTestInstance | null;
  findByText: (text: string | RegExp) => Promise<ReactTestInstance>;
  getByLabelText: (text: string | RegExp) => ReactTestInstance;
  queryByLabelText: (text: string | RegExp) => ReactTestInstance | null;
  getByTestId: (testId: string | RegExp) => ReactTestInstance;
  queryByTestId: (testId: string | RegExp) => ReactTestInstance | null;
  toJSON: () =>
    | TestRenderer.ReactTestRendererJSON
    | TestRenderer.ReactTestRendererJSON[]
    | null;
  update: (element: React.ReactElement) => void;
  unmount: () => void;
};

const isTextual = (value: unknown): value is string | number =>
  typeof value === 'string' || typeof value === 'number';

const collectText = (node: ReactTestInstance): string => {
  const walk = (child: React.ReactNode): string => {
    if (isTextual(child)) return String(child);
    if (Array.isArray(child)) return child.map(walk).join('');
    if (child && typeof child === 'object' && 'children' in (child as any)) {
      return collectText(child as ReactTestInstance);
    }
    return '';
  };

  return (node.children as React.ReactNode[]).map(walk).join('');
};

const matchText = (node: ReactTestInstance, matcher: string | RegExp) => {
  const text = collectText(node);
  if (!text) return false;
  return typeof matcher === 'string' ? text.includes(matcher) : matcher.test(text);
};

const matchProp = (node: ReactTestInstance, prop: string, matcher: string | RegExp) => {
  const value = node.props?.[prop];
  if (!isTextual(value)) return false;
  const strValue = String(value);
  return typeof matcher === 'string' ? strValue === matcher : matcher.test(strValue);
};

function renderInternal(element: React.ReactElement): RenderResult {
  let renderer: ReactTestRenderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(element);
  });
  const root = renderer!.root;

  const getAllByText = (text: string | RegExp) => {
    const results = root.findAll((node) => matchText(node, text), { deep: true });
    if (results.length === 0) {
      throw new Error(`No instances found matching text: ${text.toString()}`);
    }
    return results;
  };

  const getByText = (text: string | RegExp) => getAllByText(text)[0];

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

  return {
    root,
    getByText,
    getAllByText,
    queryByText,
    findByText,
    getByLabelText,
    queryByLabelText,
    getByTestId,
    queryByTestId,
    toJSON: () => renderer.toJSON(),
    update: (el) => renderer.update(el),
    unmount: () => renderer.unmount(),
  };
}

let lastRender: RenderResult | null = null;

const cleanup = () => {
  if (lastRender) {
    lastRender.unmount();
    lastRender = null;
  }
};

export function render(element: React.ReactElement): RenderResult {
  cleanup();
  lastRender = renderInternal(element);
  return lastRender;
}

const requireLastRender = (): RenderResult => {
  if (!lastRender) {
    throw new Error('No render has been executed. Call render() first.');
  }
  return lastRender;
};

export function fireEvent(target: any, eventName?: string, ...args: any[]) {
  if (!target || !target.props) return;
  if (typeof eventName === 'string') {
    const propName =
      eventName === 'valueChange'
        ? 'onValueChange'
        : `on${eventName.charAt(0).toUpperCase()}${eventName.slice(1)}`;
    const handler = target.props[propName];
    if (typeof handler === 'function') {
      TestRenderer.act(() => {
        handler(...args);
      });
    }
  }
}

fireEvent.press = (target: any) => {
  if (!target || !target.props) return;
  const handler = target.props.onPress ?? target.props.onClick;
  if (typeof handler === 'function') {
    TestRenderer.act(() => {
      handler({});
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
  get root() {
    return requireLastRender().root;
  },
  getByText: (...args: Parameters<RenderResult['getByText']>) => requireLastRender().getByText(...args),
  getAllByText: (...args: Parameters<RenderResult['getAllByText']>) => requireLastRender().getAllByText(...args),
  queryByText: (...args: Parameters<RenderResult['queryByText']>) => requireLastRender().queryByText(...args),
  findByText: (...args: Parameters<RenderResult['findByText']>) => requireLastRender().findByText(...args),
  getByLabelText: (...args: Parameters<RenderResult['getByLabelText']>) => requireLastRender().getByLabelText(...args),
  queryByLabelText: (...args: Parameters<RenderResult['queryByLabelText']>) =>
    requireLastRender().queryByLabelText(...args),
  getByTestId: (...args: Parameters<RenderResult['getByTestId']>) => requireLastRender().getByTestId(...args),
  queryByTestId: (...args: Parameters<RenderResult['queryByTestId']>) => requireLastRender().queryByTestId(...args),
  toJSON: () => requireLastRender().toJSON(),
  update: (...args: Parameters<RenderResult['update']>) => requireLastRender().update(...args),
  unmount: () => requireLastRender().unmount(),
};

afterEach(() => {
  cleanup();
});

export default {
  render,
  fireEvent,
  waitFor,
  screen,
};
