// Local, offline validation of what a user pastes into "Have I been linked?".
// Only transparent addresses leave public traces we can look up; shielded and
// unified addresses are explained, not checked. TEX addresses (ZIP 320) are
// converted to their t1 form, which is how they appear on chain.

import { sha256 } from "./sha256";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const P2PKH = [0x1c, 0xb8]; // t1
const P2SH = [0x1c, 0xbd]; // t3

function base58Decode(s: string): Uint8Array | null {
  let n = 0n;
  for (const ch of s) {
    const v = B58.indexOf(ch);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 255n));
    n >>= 8n;
  }
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

function base58Encode(b: Uint8Array): string {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)]! + s;
    n /= 58n;
  }
  for (const x of b) {
    if (x !== 0) break;
    s = "1" + s;
  }
  return s;
}

const checksum = (payload: Uint8Array) => sha256(sha256(payload)).slice(0, 4);

/** Base58Check payload (version + data), or null if the checksum fails. */
function base58CheckDecode(s: string): Uint8Array | null {
  const raw = base58Decode(s);
  if (!raw || raw.length < 5) return null;
  const payload = raw.slice(0, -4);
  const sum = checksum(payload);
  return sum.every((x, i) => x === raw[raw.length - 4 + i]) ? payload : null;
}

function base58CheckEncode(payload: Uint8Array): string {
  const out = new Uint8Array(payload.length + 4);
  out.set(payload);
  out.set(checksum(payload), payload.length);
  return base58Encode(out);
}

// ---- Bech32m (BIP 350), for TEX addresses ----

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32M_CONST = 0x2bc830a3;

function polymod(values: number[]): number {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i]!;
  }
  return chk >>> 0;
}

const hrpExpand = (hrp: string) => [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];

function convertBits(data: number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const v of data) {
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv) !== 0) return null;
  return out;
}

function bech32mDecode(s: string): { hrp: string; data: Uint8Array } | null {
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) return null;
  const str = s.toLowerCase();
  const pos = str.lastIndexOf("1");
  if (pos < 1 || pos + 7 > str.length) return null;
  const hrp = str.slice(0, pos);
  const values: number[] = [];
  for (const ch of str.slice(pos + 1)) {
    const v = CHARSET.indexOf(ch);
    if (v < 0) return null;
    values.push(v);
  }
  if (polymod([...hrpExpand(hrp), ...values]) !== BECH32M_CONST) return null;
  const bytes = convertBits(values.slice(0, -6), 5, 8, false);
  return bytes ? { hrp, data: Uint8Array.from(bytes) } : null;
}

export function bech32mEncode(hrp: string, data: Uint8Array): string {
  const values = convertBits([...data], 8, 5, true)!;
  const mod = polymod([...hrpExpand(hrp), ...values, 0, 0, 0, 0, 0, 0]) ^ BECH32M_CONST;
  const check = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...values, ...check].map((v) => CHARSET[v]).join("")}`;
}

// ---- Classification ----

export type AddressCheck =
  | { kind: "transparent"; address: string; type: "p2pkh" | "p2sh"; fromTex?: string }
  | { kind: "shielded" | "unified" | "testnet" | "invalid"; message: string };

const SHIELDED_MESSAGE =
  "This is a shielded address. Shielded addresses don't leave public traces of who sent what, so there is nothing for us to look up. Only transparent addresses (starting with t1 or t3) can be checked.";

export function checkAddress(input: string): AddressCheck {
  const s = input.trim();
  if (s === "") return { kind: "invalid", message: "Paste a transparent Zcash address (it starts with t1 or t3)." };
  const lower = s.toLowerCase();
  if (/^(tm|t2)/.test(s) || /^(utest|ztestsapling|textest)1/.test(lower)) {
    return { kind: "testnet", message: "That looks like a testnet address. This tool only covers Zcash mainnet." };
  }
  if (lower.startsWith("u1")) {
    return {
      kind: "unified",
      message:
        "This is a unified address. Its shielded receivers don't leave public traces. If your wallet also showed you a transparent address (t1…), check that one instead.",
    };
  }
  if (lower.startsWith("zs1") || lower.startsWith("zc")) return { kind: "shielded", message: SHIELDED_MESSAGE };
  if (lower.startsWith("tex1")) {
    const d = bech32mDecode(s);
    if (!d || d.hrp !== "tex" || d.data.length !== 20) return { kind: "invalid", message: "That TEX address is not valid (checksum or length)." };
    const address = base58CheckEncode(Uint8Array.from([...P2PKH, ...d.data]));
    return { kind: "transparent", address, type: "p2pkh", fromTex: s.toLowerCase() };
  }
  if (/^t[13]/.test(s)) {
    const payload = base58CheckDecode(s);
    if (!payload || payload.length !== 22) return { kind: "invalid", message: "That address is not valid: the checksum doesn't match. Check for a typo." };
    const [v0, v1] = [payload[0], payload[1]];
    if (v0 === P2PKH[0] && v1 === P2PKH[1]) return { kind: "transparent", address: s, type: "p2pkh" };
    if (v0 === P2SH[0] && v1 === P2SH[1]) return { kind: "transparent", address: s, type: "p2sh" };
    return { kind: "invalid", message: "That address has an unexpected prefix." };
  }
  return { kind: "invalid", message: "That doesn't look like a Zcash address. Transparent addresses start with t1 or t3." };
}

/** The TEX form of a t1 address (for tests and display). */
export function texFromT1(t1: string): string | null {
  const payload = base58CheckDecode(t1);
  if (!payload || payload.length !== 22 || payload[0] !== P2PKH[0] || payload[1] !== P2PKH[1]) return null;
  return bech32mEncode("tex", payload.slice(2));
}
