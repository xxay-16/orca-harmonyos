export function isHarmonyWebPlatform(userAgent: string): boolean {
  return /\b(?:OpenHarmony|HarmonyOS)\b/.test(userAgent)
}
