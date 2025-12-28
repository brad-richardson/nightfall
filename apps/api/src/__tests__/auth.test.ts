import { describe, expect, it, vi } from "vitest";

// Mock config before importing auth module
vi.mock("../config", () => ({
  getConfig: () => ({ JWT_SECRET: "test-secret-key" })
}));

import { signClientId, verifyToken, verifyAdminSecret } from "../utils/auth";

describe("auth utilities", () => {
  describe("signClientId", () => {
    it("returns consistent signature for same client ID", () => {
      const sig1 = signClientId("client-123");
      const sig2 = signClientId("client-123");
      expect(sig1).toBe(sig2);
    });

    it("returns different signatures for different client IDs", () => {
      const sig1 = signClientId("client-123");
      const sig2 = signClientId("client-456");
      expect(sig1).not.toBe(sig2);
    });

    it("returns hex-encoded signature", () => {
      const sig = signClientId("test-client");
      expect(sig).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe("verifyToken", () => {
    it("returns true for valid token", () => {
      const clientId = "test-client";
      const token = signClientId(clientId);
      expect(verifyToken(clientId, token)).toBe(true);
    });

    it("returns true for valid Bearer token", () => {
      const clientId = "test-client";
      const token = `Bearer ${signClientId(clientId)}`;
      expect(verifyToken(clientId, token)).toBe(true);
    });

    it("returns false for invalid token", () => {
      expect(verifyToken("client-123", "invalid-token")).toBe(false);
    });

    it("returns false for empty token", () => {
      expect(verifyToken("client-123", "")).toBe(false);
    });

    it("returns false for token with wrong length", () => {
      const clientId = "test-client";
      const validToken = signClientId(clientId);
      const shortToken = validToken.slice(0, -1);
      expect(verifyToken(clientId, shortToken)).toBe(false);
    });

    it("returns false for token for different client", () => {
      const token = signClientId("client-A");
      expect(verifyToken("client-B", token)).toBe(false);
    });
  });

  describe("verifyAdminSecret", () => {
    it("returns true for valid admin secret", () => {
      const secret = "admin-secret-123";
      const authHeader = `Bearer ${secret}`;
      expect(verifyAdminSecret(authHeader, secret)).toBe(true);
    });

    it("returns false for invalid secret", () => {
      const authHeader = "Bearer wrong-secret";
      expect(verifyAdminSecret(authHeader, "correct-secret")).toBe(false);
    });

    it("returns false for undefined auth header", () => {
      expect(verifyAdminSecret(undefined, "secret")).toBe(false);
    });

    it("returns false for undefined secret", () => {
      expect(verifyAdminSecret("Bearer token", undefined)).toBe(false);
    });

    it("returns false for missing Bearer prefix", () => {
      expect(verifyAdminSecret("secret", "secret")).toBe(false);
    });

    it("returns false for header with different length", () => {
      expect(verifyAdminSecret("Bearer short", "much-longer-secret")).toBe(false);
    });
  });
});
