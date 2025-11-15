# Mock Auth Login (F1-01 / F1-02)

El provider mock implementado en `src/lib/auth/AuthService.ts` expone helpers para iniciar/cerrar sesión y leer el usuario/token actual.

## Credenciales fijas

```
usuario: nurse@example.com
password: password123
```

Estas credenciales están disponibles como `MOCK_CREDENTIALS` si necesitas reusarlas en código.

## Ejemplo rápido (sin UI)

```ts
import { login, getCurrentUser, getAccessToken } from '@/src/lib/auth/AuthService';

async function debugMockLogin() {
  await login({ username: 'nurse@example.com', password: 'password123' });
  const user = await getCurrentUser();
  const token = await getAccessToken();

  console.log('usuario mock', user);
  console.log('access token', token);
}
```

El estado y los tokens se persisten usando `expo-secure-store`, por lo que puedes instanciar `AuthService` en otra parte del código y se hidratará automáticamente desde almacenamiento seguro.
