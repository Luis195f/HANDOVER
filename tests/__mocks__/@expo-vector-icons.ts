// tests/__mocks__/@expo-vector-icons.ts
// Stub mínimo de @expo/vector-icons para tests en Vitest

// Componente icono “vacío”: no renderiza nada, solo satisface a React
const IconStub = (_props: any) => null;

// Proxy para devolver siempre IconStub ante cualquier acceso de propiedad.
// Así cubrimos importaciones como:
//   import { Ionicons } from '@expo/vector-icons'
//   import { MaterialIcons } from '@expo/vector-icons'
const IconsProxy: any = new Proxy(
  {},
  {
    get() {
      return IconStub;
    },
  },
);

// Export por defecto (poco habitual, pero lo dejamos por compatibilidad)
export default IconsProxy;

// Algunos exports nombrados comunes
export const AntDesign = IconStub;
export const Ionicons = IconStub;
export const MaterialIcons = IconStub;
export const MaterialCommunityIcons = IconStub;
export const FontAwesome = IconStub;
export const Feather = IconStub;
