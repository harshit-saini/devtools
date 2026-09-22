import { describe, expect, it } from "vitest";
import { decodeBase64Url, decodeJwt } from "./jwt";

describe("decodeBase64Url", () => {
  it("decodes an unpadded base64url segment", () => {
    // "hi" -> base64 "aGk=" -> base64url "aGk" (no padding)
    expect(decodeBase64Url("aGk")).toBe("hi");
  });

  it("decodes UTF-8 multi-byte characters correctly instead of mangling them", () => {
    const original = "café 🎉";
    const bytes = new TextEncoder().encode(original);
    const base64url = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    expect(decodeBase64Url(base64url)).toBe(original);
  });
});

describe("decodeJwt", () => {
  const sampleJwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

  it("decodes a well-formed JWT's header and payload", () => {
    const result = decodeJwt(sampleJwt);
    expect(result.error).toBe("");
    expect(result.header).toEqual({ alg: "HS256", typ: "JWT" });
    expect(result.payload).toMatchObject({ sub: "1234567890", name: "John Doe" });
  });

  it("reports an error for an empty token", () => {
    expect(decodeJwt("").error).not.toBe("");
  });

  it("reports an error for a token without 3 segments", () => {
    expect(decodeJwt("only.two").error).toBe("JWT must have 3 dot-separated segments.");
  });

  it("reports an error for malformed base64/JSON segments", () => {
    expect(decodeJwt("not-base64.also-not.sig").error).not.toBe("");
  });
});
