export type JwtObject = Record<string, unknown>;

export type DecodedJwt = {
  header: JwtObject | null;
  payload: JwtObject | null;
  signature: string;
  signingInput: string;
  error: string;
};

export function decodeBase64Url(segment: string): string {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  // atob() returns a Latin-1/binary string, but JWT payloads are UTF-8 encoded JSON - decoding
  // straight from that binary string (rather than the underlying bytes as UTF-8) mangles any
  // non-ASCII claim (accented names, CJK text, emoji).
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

export function decodeJwt(token: string): DecodedJwt {
  const trimmed = token.trim();
  if (!trimmed) {
    return {
      header: null,
      payload: null,
      signature: "",
      signingInput: "",
      error: "Paste a JWT to decode.",
    };
  }

  const parts = trimmed.split(".");
  if (parts.length !== 3) {
    return {
      header: null,
      payload: null,
      signature: "",
      signingInput: "",
      error: "JWT must have 3 dot-separated segments.",
    };
  }

  try {
    const header = JSON.parse(decodeBase64Url(parts[0])) as JwtObject;
    const payload = JSON.parse(decodeBase64Url(parts[1])) as JwtObject;

    return {
      header,
      payload,
      signature: parts[2],
      signingInput: `${parts[0]}.${parts[1]}`,
      error: "",
    };
  } catch {
    return {
      header: null,
      payload: null,
      signature: "",
      signingInput: "",
      error: "Could not decode this token. Check the format.",
    };
  }
}
