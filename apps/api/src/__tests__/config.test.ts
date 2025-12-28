import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getConfig, resetConfig } from "../config";

describe("config ADMIN_SECRET validation", () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    delete process.env.ADMIN_SECRET;
    delete process.env.NODE_ENV;
    resetConfig();
  });

  it("allows ADMIN_SECRET to be undefined", () => {
    delete process.env.ADMIN_SECRET;
    const config = getConfig();
    expect(config.ADMIN_SECRET).toBeUndefined();
  });

  it("accepts a valid ADMIN_SECRET with 32+ characters", () => {
    process.env.ADMIN_SECRET = "this-is-a-valid-secret-with-32-chars!";
    const config = getConfig();
    expect(config.ADMIN_SECRET).toBe("this-is-a-valid-secret-with-32-chars!");
  });

  it("rejects ADMIN_SECRET shorter than 32 characters", () => {
    process.env.ADMIN_SECRET = "too-short";
    expect(() => getConfig()).toThrow("ADMIN_SECRET must be at least 32 characters");
  });

  it("rejects ADMIN_SECRET that is mostly whitespace (trailing)", () => {
    // 5 chars + 27 spaces = 32 total, but only 5 after trim
    process.env.ADMIN_SECRET = "short                           ";
    expect(() => getConfig()).toThrow("ADMIN_SECRET must not be mostly whitespace");
  });

  it("rejects ADMIN_SECRET that is mostly whitespace (leading)", () => {
    // 27 spaces + 5 chars = 32 total, but only 5 after trim
    process.env.ADMIN_SECRET = "                           short";
    expect(() => getConfig()).toThrow("ADMIN_SECRET must not be mostly whitespace");
  });

  it("rejects ADMIN_SECRET with fewer than 8 unique characters", () => {
    // "abababab..." has only 2 unique characters
    process.env.ADMIN_SECRET = "abababababababababababababababab";
    expect(() => getConfig()).toThrow("ADMIN_SECRET must have at least 8 unique characters");
  });

  it("rejects ADMIN_SECRET that is a repeated character", () => {
    process.env.ADMIN_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(() => getConfig()).toThrow("ADMIN_SECRET must have at least 8 unique characters");
  });

  it("accepts a cryptographically strong secret", () => {
    process.env.ADMIN_SECRET = "xK9#mP2$vL5@nQ8!wR3^tY6&uI0*oA4%";
    const config = getConfig();
    expect(config.ADMIN_SECRET).toBe("xK9#mP2$vL5@nQ8!wR3^tY6&uI0*oA4%");
  });
});
