const mem = new Map<string, string>();
export async function getItemAsync(k: string) { return mem.get(k) ?? null; }
export async function setItemAsync(k: string, v: string) { mem.set(k, v); }
export async function deleteItemAsync(k: string) { mem.delete(k); }
export default { getItemAsync, setItemAsync, deleteItemAsync };
