export async function getInfoAsync(_uri: string) {
  return { exists: false, size: undefined };
}
export default { getInfoAsync };
