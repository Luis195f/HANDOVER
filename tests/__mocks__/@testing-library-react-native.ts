// tests/__mocks__/@testing-library-react-native.ts
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

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
  let renderer: ReactTestRenderer | null = null;

  act(() => {
    renderer = TestRenderer.create(element);
  });

  const getRoot = () => {
    if (!renderer) throw new Error('Renderer is unmounted');
    return renderer.root;
  };

  const getTextContent = (node: ReactTestInstance | React.ReactNode): string => {
    if (node == null) return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map((child) => getTextContent(child)).join('');
    const props = (node as any)?.props;
    const titleText = typeof props?.title === 'string' ? props.title : '';
    const children = typeof props?.children !== 'undefined' ? getTextContent(props.children) : '';
    return `${titleText}${children}`;
  };

  const matchText = (node: ReactTestInstance, matcher: string | RegExp) => {
    const text = getTextContent(node);
    if (!text) return false;
    return typeof matcher === 'string' ? text.includes(matcher) : matcher.test(text);
  };

  const matchProp = (node: ReactTestInstance, prop: string, matcher: string | RegExp) => {
    const value = node.props?.[prop];
    if (typeof value !== 'string') return false;
    return typeof matcher === 'string' ? value === matcher : matcher.test(value);
  };
  const matchPlaceholder = (node: ReactTestInstance, matcher: string | RegExp) =>
    matchProp(node, 'placeholder', matcher);

  const getByText = (text: string | RegExp) => {
    const matches = getRoot().findAll((node) => matchText(node, text));
    if (matches.length === 0) {
      throw new Error(`No instances found matching text: ${String(text)}`);
    }
    const interactive = matches.find((node) => typeof (node as any).props?.onPress === 'function');
    return interactive ?? matches[0];
  };
  const queryByText = (text: string | RegExp) => {
    try {
      return getByText(text);
    } catch {
      return null;
    }
  };

  const findByText = async (text: string | RegExp) => getByText(text);

  const getByLabelText = (text: string | RegExp) =>
    getRoot().find((node) => matchProp(node, 'accessibilityLabel', text));
  const queryByLabelText = (text: string | RegExp) => {
    try {
      return getByLabelText(text);
    } catch {
      return null;
    }
  };

  const getByTestId = (testId: string | RegExp) => getRoot().find((node) => matchProp(node, 'testID', testId));
  const queryByTestId = (testId: string | RegExp) => {
    try {
      return getByTestId(testId);
    } catch {
      return null;
    }
  };

  const getByPlaceholderText = (text: string | RegExp) => getRoot().find((node) => matchPlaceholder(node, text));
  const queryByPlaceholderText = (text: string | RegExp) => {
    try {
      return getByPlaceholderText(text);
    } catch {
      return null;
    }
  };

  const matchRole = (node: ReactTestInstance, role: string | RegExp) => {
    const roleValue =
      typeof node.props?.accessibilityRole === 'string'
        ? node.props.accessibilityRole
        : typeof node.type === 'string'
          ? (node.type as string)
          : undefined;
    if (!roleValue) return false;
    const normalized = roleValue.toLowerCase();
    return typeof role === 'string' ? normalized === role.toLowerCase() : role.test(normalized);
  };

  const getAllByRole = (role: string | RegExp) =>
    getRoot().findAll((node) => matchRole(node, role));
  const getByRole = (role: string | RegExp) => {
    const all = getAllByRole(role);
    if (!all.length) throw new Error(`No instances found for role ${String(role)}`);
    return all[0];
  };
  const queryByRole = (role: string | RegExp) => {
    const all = getAllByRole(role);
    return all.length ? all[0] : null;
  };

  return {
    get root() {
      return getRoot();
    },
    getByText,
    queryByText,
    findByText,
    getByLabelText,
    queryByLabelText,
    getByTestId,
    queryByTestId,
    getByPlaceholderText,
    queryByPlaceholderText,
    getAllByRole,
    getByRole,
    queryByRole,
    toJSON: () => renderer?.toJSON(),
    update: (el) => renderer?.update(el),
    unmount: () => {
      if (!renderer) return;
      act(() => {
        renderer?.unmount();
      });
      renderer = null;
    },
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
      act(() => {
        handler(...args);
      });
    }
  }
}

fireEvent.press = (target: any) => {
  if (!target || !target.props) return;
  const handler = target.props.onPress ?? target.props.onClick;
  if (typeof handler === 'function') {
    act(() => {
      handler({});
    });
  }
};

fireEvent.changeText = (target: any, value: string) => {
  if (typeof target?.props?.onChangeText === 'function') {
    act(() => {
      target.props.onChangeText(value);
    });
  }
};

export async function waitFor(
  callback: () => void | Promise<void>,
  { timeout = 1000, interval = 20 }: { timeout?: number; interval?: number } = {},
) {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeout) {
    try {
      await act(async () => {
        await callback();
      });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
  throw lastError;
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
