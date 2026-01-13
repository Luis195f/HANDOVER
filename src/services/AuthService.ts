export async function getToken(): Promise<string | null> {
  return process.env.EXPO_PUBLIC_AUTH_TOKEN ?? null;
}

export default { getToken };
