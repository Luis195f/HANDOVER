// src/test/react-test-renderer.stub.ts
// Stub mínimo para poder montar componentes en tests de integración sin la lib real.

type JSONLike = any;

function toJSONTree(el: any): JSONLike {
  // Este stub no reconcilia; devuelve el elemento tal cual.
  return el;
}

const TestRenderer = {
  create(element: any) {
    const tree = toJSONTree(element);
    return {
      toJSON: () => tree,
      root: {
        findAll(_pred?: any) {
          // Devuelve vacío en el stub; los tests usan extracción de texto desde toJSON
          return [];
        },
      },
      update(_next: any) {
        // noop en stub
      },
      unmount() {
        // noop
      },
    };
  },
};

export async function act<T>(fn: () => Promise<T> | T): Promise<T> {
  return await fn();
}

export default TestRenderer;
