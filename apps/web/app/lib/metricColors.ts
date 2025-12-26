export function getHealthColor(percent: number): string {
  if (percent >= 70) return "#10b981";
  if (percent >= 40) return "#f59e0b";
  return "#ef4444";
}

export function getRustColor(percent: number): string {
  if (percent >= 60) return "#92400e";
  if (percent >= 30) return "#d97706";
  return "#fbbf24";
}
