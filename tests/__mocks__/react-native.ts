export const Platform = { OS: 'test', select: (o: any) => ('test' in o ? o.test : o.default) };
export const StyleSheet = { create: (s: any) => s };
export default {};
