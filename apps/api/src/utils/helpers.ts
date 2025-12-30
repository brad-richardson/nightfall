/**
 * Shared utility functions used across API routes
 */

import { FEATURE_TYPES } from "./constants";

export function getAppVersion() {
  return process.env.APP_VERSION ?? "dev";
}

export function parseBBox(value?: string) {
  if (!value) {
    return null;
  }
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return null;
  }
  return parts as [number, number, number, number];
}

export function parseTypes(value?: string) {
  if (!value) {
    return null;
  }
  const types = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && FEATURE_TYPES.has(part));

  return types.length > 0 ? types : null;
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function haversineDistanceMeters(a: [number, number], b: [number, number]) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const radLat1 = toRad(lat1);
  const radLat2 = toRad(lat2);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(radLat1) * Math.cos(radLat2) * sinDLng * sinDLng;
  return 6371000 * (2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

export function getNextReset(now: Date) {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = next.getUTCDay();
  let daysUntil = (7 - day) % 7;

  if (daysUntil === 0 && now.getUTCHours() + now.getUTCMinutes() + now.getUTCSeconds() > 0) {
    daysUntil = 7;
  }

  next.setUTCDate(next.getUTCDate() + daysUntil);
  next.setUTCHours(0, 0, 0, 0);
  return next.toISOString();
}

export function writeSseEvent(stream: NodeJS.WritableStream, event: string, payload: unknown, id?: string) {
  if (id) {
    stream.write(`id: ${id}\n`);
  }
  stream.write(`event: ${event}\n`);
  stream.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Parse ALLOWED_ORIGINS config into an array of origins or true (allow all).
 * Returns true if not specified or empty, otherwise returns filtered array.
 */
export function parseAllowedOrigins(allowedOrigins: string | undefined): string[] | true {
  if (!allowedOrigins) {
    return true;
  }
  const origins = allowedOrigins.split(',').map(o => o.trim()).filter(o => o.length > 0);
  return origins.length > 0 ? origins : true;
}
