export function getIOSVersion(): string {
  const match = navigator.userAgent.match(/OS (\d+)[._](\d+)(?:[._](\d+))?/);
  if (!match) return "desconhecida";
  const major = match[1];
  const minor = match[2] ?? "0";
  const patch = match[3] ?? "0";
  return `${major}.${minor}.${patch}`;
}

// Compat
export const getIOSUIEra = getIOSVersion;
