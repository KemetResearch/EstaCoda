import { describe, it, expect } from "vitest";

describe("vitest proof of life", () => {
  it("should run under bun", () => {
    expect(1 + 1).toBe(2);
  });

  it("should have process global available", () => {
    expect(typeof process).toBe("object");
  });
});
