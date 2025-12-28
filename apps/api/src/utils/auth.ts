/**
 * Authentication utilities for client token verification
 */

import { createHmac, timingSafeEqual } from "crypto";
import { getConfig } from "../config";

export function signClientId(clientId: string): string {
  const secret = getConfig().JWT_SECRET;
  const hmac = createHmac("sha256", secret);
  hmac.update(clientId);
  return hmac.digest("hex");
}

export function verifyToken(clientId: string, token: string): boolean {
  if (!token) return false;
  // Handle "Bearer <token>" format
  const actualToken = token.startsWith("Bearer ") ? token.slice(7) : token;
  const expected = signClientId(clientId);

  // Prevent timing attacks with constant-time comparison
  if (actualToken.length !== expected.length) {
    return false;
  }

  try {
    return timingSafeEqual(
      Buffer.from(actualToken, 'utf-8'),
      Buffer.from(expected, 'utf-8')
    );
  } catch {
    return false;
  }
}

export function verifyAdminSecret(authHeader: string | undefined, secret: string | undefined): boolean {
  if (!secret || !authHeader) return false;

  const expected = `Bearer ${secret}`;

  // Prevent timing attacks with constant-time comparison
  if (authHeader.length !== expected.length) {
    return false;
  }

  try {
    return timingSafeEqual(
      Buffer.from(authHeader, 'utf-8'),
      Buffer.from(expected, 'utf-8')
    );
  } catch {
    return false;
  }
}
