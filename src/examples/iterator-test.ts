import { Sinwan } from "../sinwan";

const app = new Sinwan();

app.get("/stream", (ctx) => {
  ctx.iterate(async function* () {
    yield "Hello ";
    await Bun.sleep(100);
    yield "from ";
    await Bun.sleep(100);
    yield "SinwanJS ";
    await Bun.sleep(100);
    yield "Async ";
    await Bun.sleep(100);
    yield "Iterators!";
  });
});

console.log("Starting iterator test server on http://localhost:3006");
await app.init();
app.listen(3006, async () => {
  console.log("Server ready.");

  console.log("\nTesting /stream...");
  const resp = await fetch("http://localhost:3006/stream");
  console.log("Status:", resp.status);
  console.log("Content-Type:", resp.headers.get("Content-Type"));

  if (!resp.body) {
    console.error("No body found");
    process.exit(1);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let result = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    console.log("Received chunk:", JSON.stringify(chunk));
    result += chunk;
  }

  console.log("\nFinal result:", result);

  if (result === "Hello from SinwanJS Async Iterators!") {
    console.log("\nSUCCESS: Streaming worked correctly.");
  } else {
    console.error("\nFAILURE: Result mismatch.");
    process.exit(1);
  }

  process.exit(0);
});
