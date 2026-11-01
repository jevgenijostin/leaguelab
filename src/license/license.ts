// STUB: client-side only, trivially bypassable
// CRC-16 with a public source constant is error detection, not authentication.
export const LICENSE_STORAGE_KEY = 'leaguelab:license';
export function checksum(body: string): string {
  let crc = 0xffff;
  for (const ch of `LeagueLab-dev-v1:${body}`) {
    crc ^= ch.charCodeAt(0) << 8;
    for (let i = 0; i < 8; i++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
export function validateKey(input: string): boolean {
  const key = input.trim().toUpperCase();
  return /^LL1-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-F0-9]{4}$/.test(key) && checksum(key.slice(0, -5)) === key.slice(-4);
}
export function getTier(): 'free' | 'pro' {
  try { return validateKey(localStorage.getItem(LICENSE_STORAGE_KEY) ?? '') ? 'pro' : 'free'; } catch { return 'free'; }
}
export function activate(key: string): boolean {
  if (!validateKey(key)) return false;
  try { localStorage.setItem(LICENSE_STORAGE_KEY, key.trim().toUpperCase()); return true; } catch { return false; }
}
export function deactivate(): boolean {
  try { localStorage.removeItem(LICENSE_STORAGE_KEY); return true; } catch { return false; }
}
