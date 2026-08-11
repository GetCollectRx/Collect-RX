const key = process.env.VAPI_API_KEY;
console.log("VAPI_API_KEY present:", Boolean(key), "length:", key ? key.length : 0);

const res = await fetch("https://api.vapi.ai/assistant?limit=100", {
  headers: { Authorization: `Bearer ${key}` },
});
console.log("status:", res.status, res.statusText);
console.log("content-type:", res.headers.get("content-type"));
const text = await res.text();
console.log("body (first 1000 chars):");
console.log(text.slice(0, 1000));
