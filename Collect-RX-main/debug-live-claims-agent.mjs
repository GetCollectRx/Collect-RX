const key = process.env.VAPI_API_KEY;
const res = await fetch("https://api.vapi.ai/assistant/0e45a8ae-5201-4a8f-87fa-d1ad272e1c05", {
  headers: { Authorization: `Bearer ${key}` },
});
const data = await res.json();
console.log("=== LIVE Claims_Agent system prompt ===\n");
console.log(data.model.messages[0].content);
console.log("\n=== LIVE Claims_Agent tools ===\n");
console.log(JSON.stringify(data.model.tools, null, 2));
