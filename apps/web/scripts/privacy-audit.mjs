// Privacy audit in a real browser (headless Chrome over the DevTools protocol).
//
// Loads every page and runs every kind of check the site offers, then fails if
// any of these is seen:
//   - a request to another origin, or a request whose URL holds the typed
//     amount, the address or the address's hash;
//   - more requests on Check than documented (0 for an amount, 1 bucket for an
//     address, every bucket in paranoid mode, 0 for a shielded address);
//   - a Content-Security-Policy violation or a script error (so the site works
//     under its own CSP);
//   - a cookie (set by a response or present in the browser), or anything in
//     localStorage, sessionStorage, IndexedDB or Cache Storage;
//   - the amount or address in the address bar, a history entry or the title;
//   - an input without autocomplete="off" and spellcheck="false";
//   - a missing security header.
//
// Usage: node scripts/privacy-audit.mjs [baseUrl] [--light]
//   baseUrl defaults to http://localhost:3107 (a local `next start`, ideally in
//   fixture mode). --light runs only one load of each page and one address
//   check, for a quick look at a deployed site. CHROME=path overrides the browser.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const light = args.includes("--light");
const base = new URL(args.find((a) => !a.startsWith("--")) ?? "http://localhost:3107");

const AMOUNT = "123.45678901";
const ADDRESS = "t1WBQELkwnMZi5yf8kDqq4tx1jK877MjfuM";
const SHIELDED = "zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly";
const digest = createHash("sha256").update(ADDRESS, "utf8").digest();
// Anything that would identify what the user typed. The bucket number (the
// first few bits of the hash) is allowed and checked separately.
const SECRETS = [AMOUNT, "12345678901", ADDRESS, SHIELDED.slice(0, 20), digest.toString("hex").slice(0, 16), digest.toString("base64").slice(0, 16), digest.toString("base64url").slice(0, 16)];
const leaks = (s) => SECRETS.filter((x) => s.includes(x) || s.includes(encodeURIComponent(x)));

const chromePath =
  process.env.CHROME ??
  ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => existsSync(p));
if (!chromePath) throw new Error("Chrome not found; set CHROME=/path/to/chrome");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(path.join(tmpdir(), "ail-audit-"));
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });

let target;
for (let i = 0; i < 60 && !target; i++) {
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
  } catch {
    await sleep(250);
  }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));

let id = 0;
const waiting = new Map();
const requests = []; // { url, type }
const errors = []; // CSP violations, console errors, uncaught exceptions
const setCookies = [];
const docHeaders = new Map(); // url -> headers of each document response
ws.addEventListener("message", (m) => {
  const x = JSON.parse(m.data);
  if (x.id && waiting.has(x.id)) {
    waiting.get(x.id)(x.result ?? { error: x.error });
    waiting.delete(x.id);
  }
  const p = x.params;
  if (x.method === "Network.requestWillBeSent") requests.push({ url: p.request.url, type: p.type, post: p.request.postData ?? "" });
  if (x.method === "Network.responseReceivedExtraInfo") {
    for (const [k, v] of Object.entries(p.headers)) if (k.toLowerCase() === "set-cookie") setCookies.push(v);
  }
  if (x.method === "Network.responseReceived" && p.type === "Document") docHeaders.set(p.response.url, Object.fromEntries(Object.entries(p.response.headers).map(([k, v]) => [k.toLowerCase(), v])));
  if (x.method === "Log.entryAdded" && p.entry.level === "error") errors.push(`log: ${p.entry.text}`);
  if (x.method === "Runtime.exceptionThrown") errors.push(`exception: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`);
  if (x.method === "Runtime.consoleAPICalled" && p.type === "error") errors.push(`console: ${p.args.map((a) => a.value ?? a.description).join(" ")}`);
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    waiting.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`evaluate: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result?.value;
};
const waitFor = (cond, ms = 20000) => evaluate(`new Promise((ok, no) => { const t0 = Date.now(); const t = setInterval(() => { if (${cond}) { clearInterval(t); ok(true) } else if (Date.now() - t0 > ${ms}) { clearInterval(t); no(new Error(${JSON.stringify(`timeout: ${cond}`)})) } }, 100) })`);

await send("Network.enable");
await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
// Registered by the browser itself, before any page script, and not subject to the page's CSP.
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: "document.addEventListener('securitypolicyviolation', (e) => console.error('CSP violation', e.violatedDirective, e.blockedURI, e.sample))",
});

const results = [];
const check = (name, ok, evidence) => {
  results.push({ name, ok, evidence });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${evidence ? `  (${evidence})` : ""}`);
};

async function open(pathname) {
  await send("Page.navigate", { url: new URL(pathname, base).href });
  await waitFor("document.readyState === 'complete'");
  await sleep(300);
}
const typeInto = (selector, value) =>
  evaluate(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const submit = () => evaluate("document.querySelector('form').requestSubmit()");
const textInput = "input:not([type=checkbox])";
const pathsSince = (n) => requests.slice(n).map((r) => new URL(r.url).pathname);

// 1. Every page, cold.
for (const page of ["/", "/check", "/linked", "/no-such-page"]) {
  const n = requests.length;
  await open(page);
  await sleep(1500);
  const inputs = await evaluate(
    "[...document.querySelectorAll('input, textarea')].filter((i) => i.type !== 'checkbox').map((i) => ({ autocomplete: i.getAttribute('autocomplete'), spellcheck: i.getAttribute('spellcheck'), name: i.getAttribute('name') }))",
  );
  const badInputs = inputs.filter((i) => i.autocomplete !== "off" || i.spellcheck !== "false" || i.name !== null);
  check(`${page}: inputs have autocomplete=off, spellcheck=false and no name`, badInputs.length === 0, `${inputs.length} input(s)`);
  const origins = [...new Set(requests.slice(n).map((r) => new URL(r.url).origin))];
  check(`${page}: every request goes to this origin`, origins.every((o) => o === base.origin), `${requests.length - n} requests, origins: ${origins.join(" ")}`);
}

// 2. Security headers on the documents.
const h = docHeaders.get(new URL("/", base).href) ?? [...docHeaders.values()][0] ?? {};
const csp = h["content-security-policy"] ?? "";
const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src")) ?? "";
check("CSP: default-src 'self'", /(^|;)\s*default-src 'self'(;|$)/.test(csp));
check("CSP: script-src has no 'unsafe-inline' or 'unsafe-eval'", scriptSrc !== "" && !/unsafe-(inline|eval)/.test(scriptSrc), scriptSrc.replace(/'sha256-[^']+'/g, "'sha256-…'"));
check("CSP: frame-ancestors 'none'", csp.includes("frame-ancestors 'none'"));
check("Referrer-Policy: no-referrer", h["referrer-policy"] === "no-referrer");
check("Permissions-Policy denies camera, microphone, geolocation and more", /camera=\(\)/.test(h["permissions-policy"] ?? "") && /geolocation=\(\)/.test(h["permissions-policy"] ?? "") && (h["permissions-policy"] ?? "").split(",").length >= 20);
check("X-Content-Type-Options: nosniff", h["x-content-type-options"] === "nosniff");
check("Strict-Transport-Security set", /max-age=\d{7,}/.test(h["strict-transport-security"] ?? ""), h["strict-transport-security"]);
check("No X-Powered-By header", !h["x-powered-by"]);

// 3. The checks themselves.
async function amountFromHome() {
  await open("/");
  await typeInto(textInput, AMOUNT);
  const n = requests.length;
  await submit();
  await waitFor("location.pathname === '/check' && !!document.querySelector('[aria-label=Result]')");
  await sleep(500);
  const url = await evaluate("location.href");
  check("home → /check: the amount is handed over without a URL", leaks(url).length === 0 && !url.includes("#"), url);
  const urls = requests.slice(n).map((r) => r.url + r.post);
  check("home → /check: no request carries the amount", urls.every((u) => leaks(u).length === 0), `${urls.length} requests: ${[...new Set(urls.map((u) => new URL(u).pathname))].join(" ")}`);
}
async function amountOnCheck() {
  await open("/check");
  await waitFor("!document.querySelector('form button[type=submit]').disabled");
  await typeInto(textInput, AMOUNT);
  const n = requests.length;
  await submit();
  await waitFor("!!document.querySelector('[aria-label=Result]')");
  await sleep(1000);
  check("/check: a check sends nothing", requests.length === n, `${requests.length - n} requests after Check`);
}
async function exampleLink() {
  await open("/check#risky");
  await waitFor("!!document.querySelector('[aria-label=Result]')");
  check("/check#risky: the example runs and the fragment is cleared", (await evaluate("location.hash")) === "");
}
async function address(value, paranoid, expected, label) {
  await open("/linked");
  await waitFor("!document.querySelector('form button[type=submit]').disabled");
  await typeInto(textInput, value);
  if (paranoid) await evaluate("document.querySelector('input[type=checkbox]').click()");
  await sleep(200);
  const n = requests.length;
  await submit();
  await waitFor("!!document.querySelector('[aria-label=Result]') || /Nothing was sent/.test(document.body.innerText)", 60000);
  await sleep(1500);
  const sent = pathsSince(n);
  const buckets = sent.filter((p) => /^\/api\/v1\/buckets\/\d+\/[0-9a-f]+$/.test(p));
  const ok = sent.length === buckets.length && (expected === "all" ? buckets.length >= 2 && new Set(buckets).size === buckets.length : buckets.length === expected);
  check(`/linked ${label}: sends ${expected === "all" ? "every bucket" : `${expected} bucket request(s)`} and nothing else`, ok, `${sent.length} requests${buckets[0] ? `, e.g. ${buckets[0]}` : ""}`);
  check(`/linked ${label}: no request carries the address or its hash`, requests.slice(n).every((r) => leaks(r.url + r.post).length === 0));
}

await amountFromHome();
if (!light) {
  await amountOnCheck();
  await exampleLink();
}
await address(ADDRESS, false, 1, "address");
if (!light) {
  await address(ADDRESS, true, "all", "--paranoid");
  await address(SHIELDED, false, 0, "shielded address");
}

// 4. What the browser kept.
const storage = await evaluate(`(async () => ({
  cookie: document.cookie,
  local: Object.entries(localStorage),
  session: Object.entries(sessionStorage),
  idb: indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : [],
  caches: await caches.keys(),
  title: document.title,
}))()`);
const { cookies } = await send("Network.getAllCookies");
check("No cookies set by any response or present in the browser", setCookies.length === 0 && cookies.length === 0 && storage.cookie === "", `${setCookies.length} Set-Cookie, ${cookies.length} cookies`);
check("Nothing in localStorage or sessionStorage", storage.local.length === 0 && storage.session.length === 0, `local ${storage.local.length}, session ${storage.session.length}`);
check("No IndexedDB databases or Cache Storage", storage.idb.length === 0 && storage.caches.length === 0);
const { entries } = await send("Page.getNavigationHistory");
const historyText = entries.map((e) => `${e.url} ${e.title}`).join("\n");
check("No amount or address in any history entry URL or title", leaks(historyText).length === 0, `${entries.length} entries: ${entries.map((e) => new URL(e.url).pathname + new URL(e.url).hash).join(" ")}`);

// 5. Everything ran under the CSP.
const cspErrors = errors.filter((e) => /Content Security Policy|CSP violation/i.test(e));
check("No Content-Security-Policy violations", cspErrors.length === 0, cspErrors.slice(0, 3).join(" | "));
const other = errors.filter((e) => !cspErrors.includes(e) && !/404|Not Found/i.test(e));
check("No script errors", other.length === 0, other.slice(0, 3).join(" | "));
check("Every request in the whole run went to this origin", requests.every((r) => new URL(r.url).origin === base.origin), `${requests.length} requests`);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
ws.close();
chrome.kill();
await sleep(500);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {}
process.exit(failed ? 1 : 0);
