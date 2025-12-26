/**
 * Shared formatting utilities
 */

/**
 * Format a number with thousands separators
 * @example formatNumber(1234567) => "1,234,567"
 */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

/**
 * Format a decimal as a percentage
 * @example formatPercent(0.853) => "85%"
 */
export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Format a label by capitalizing first letter and replacing underscores
 * @example formatLabel("some_label_here") => "Some label here"
 */
export function formatLabel(str: string): string {
  return str
    .split("_")
    .map((word, idx) => (idx === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}
