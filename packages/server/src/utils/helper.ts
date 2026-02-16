/**
 * Helper to safely validate Enums from string input
 */
export function parseEnum<T>(value: any, enumObj: T, fallback: any): any {
  return Object.values(enumObj as any).includes(value) ? value : fallback;
}
