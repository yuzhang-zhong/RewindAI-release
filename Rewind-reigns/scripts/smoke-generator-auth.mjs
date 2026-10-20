import assert from "node:assert/strict";
import http from "node:http";

// No provider network calls: every fetch in the server is replaced before import.
// The HTTP client below reaches only this process's loopback listener.
process.env.VERCEL = "1";
const originalFetch = globalThis.fetch;
const syntheticKey = ["sk", "rewindai", "synthetic", "not", "a", "real", "key"].join("-")
  + "/+=1234567890" + "synthetic".repeat(20);
const encodedKey = encodeURIComponent(syntheticKey);
assert.notEqual(encodedKey, syntheticKey);

const providers = {
  openai: { origin: "https://api.openai.com", header: "Authorization", prefix: "Bearer " },
  deepseek: { origin: "https://api.deepseek.com", header: "Authorization", prefix: "Bearer " },
  anthropic: { origin: "https://api.anthropic.com", header: "x-api-key", prefix: "" },
  gemini: { origin: "https://generativelanguage.googleapis.com" }
};
let currentProvider;
let responseMode = "success";
let fetchCount = 0;
let observedTransport;

globalThis.fetch = async (input, init) => {
  fetchCount += 1;
  const url = new URL(String(input));
  const headers = new Headers(init.headers);
  const spec = providers[currentProvider];
  observedTransport = {
    origin: url.origin,
    credential: spec.header
      ? headers.get(spec.header)
      : url.searchParams.get("key"),
    body: init.body,
    method: init.method
  };
  if (responseMode === "network-error") {
    throw new Error(`Synthetic network failure: ${syntheticKey}; encoded=${encodedKey}`);
  }
  if (responseMode === "provider-error") {
    return new Response(`Synthetic provider failure: ${syntheticKey}; encoded=${encodedKey}`, { status: 401 });
  }
  const content = JSON.stringify({
    designNotes: `Synthetic generated content ${syntheticKey}`,
    cards: Array.from({ length: 20 }, (_, index) => ({
      id: `synthetic-${index}`,
      prompt: `Synthetic campus decision ${index}: ${syntheticKey}`,
      options: [{ direction: "left" }, { direction: "right" }]
    }))
  });
  return new Response(JSON.stringify({
    choices: [{ message: { content } }],
    content: [{ text: content }],
    candidates: [{ content: { parts: [{ text: content }] } }]
  }), { status: 200 });
};

const { default: app } = await import("../server/index.mjs");
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const port = server.address().port;

function request(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: "/api/custom-cards/generate",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, text, json: JSON.parse(text) });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    req.end(payload);
  });
}

function assertTransport(provider) {
  const spec = providers[provider];
  assert.equal(observedTransport.origin, spec.origin);
  assert.equal(observedTransport.method, "POST");
  assert.equal(observedTransport.credential, `${spec.prefix ?? ""}${syntheticKey}`,
    `${provider} must receive the original synthetic credential, not content redaction`);
  assert.ok(!observedTransport.body.includes(syntheticKey), "credential must not enter the model prompt");
}

try {
  for (const provider of Object.keys(providers)) {
    currentProvider = provider;
    const body = {
      provider,
      apiKey: `  ${syntheticKey}  `,
      background: "A synthetic student with competing campus obligations.",
      scenario: "A synthetic campus scenario about deadlines and teamwork.",
      count: 20
    };
    for (const mode of ["success", "provider-error", "network-error"]) {
      responseMode = mode;
      const before = fetchCount;
      const response = await request(body);
      assert.equal(fetchCount, before + 1);
      assertTransport(provider);
      assert.ok(!response.text.includes(syntheticKey), "public response must not expose the raw key");
      assert.ok(!response.text.includes(encodedKey), "public response must not expose the URL-encoded key");
      assert.ok(response.text.includes("[redacted]"), "redaction must remain explicit");
      if (mode === "success") {
        assert.equal(response.status, 200);
        assert.equal(response.json.cards.length, 20);
        assert.equal(response.json.provider, provider);
      } else {
        assert.equal(response.status, 502);
        assert.equal(response.json.error, mode === "provider-error"
          ? "Provider request failed (401): Synthetic provider failure: [redacted]; encoded=[redacted]"
          : "Synthetic network failure: [redacted]; encoded=[redacted]",
        "redact complete keys before truncation, so partial credential fragments cannot leak");
      }
      console.log(`PASS ${provider}: ${mode}, exact credential transport and public redaction`);
    }
  }
  for (const apiKey of [undefined, null, 123, "", "   ", "x".repeat(4097)]) {
    const before = fetchCount;
    const response = await request({
      provider: "openai",
      apiKey,
      background: "A synthetic student with competing campus obligations.",
      scenario: "A synthetic campus scenario about deadlines and teamwork."
    });
    assert.equal(response.status, 400);
    assert.equal(fetchCount, before, "invalid credential must not reach any provider");
  }
  console.log("PASS invalid credential inputs fail before provider transport");
  console.log("Scenario Studio auth smoke passed: 12 mocked provider cases and 6 invalid inputs; no external calls.");
} finally {
  globalThis.fetch = originalFetch;
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
