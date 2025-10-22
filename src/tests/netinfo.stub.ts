let listener: ((s: { isConnected: boolean }) => void) | undefined;
export const addEventListener = (fn: any) => {
  listener = fn;
  return { unsubscribe() { listener = undefined; } };
};
export const fetch = async () => ({ isConnected: true });
export const __emit = (s: { isConnected: boolean }) => listener?.(s);
export default { addEventListener, fetch };
