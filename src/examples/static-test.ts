import { Sinwan } from "../sinwan";
import { join } from "node:path";

const app = new Sinwan();

// Serve the project root directory under /assets
const projectRoot = join(import.meta.dir, "../../");
app.static("/assets", projectRoot);

// A simple route to test fall-through
app.get("/assets/manual", (ctx) => {
  ctx.text("This is a manual route overlapping with static prefix");
});

app.get("/", (ctx) => {
  ctx.text("Welcome to SinwanJS Static Server Test!");
});

// Catch-all 404
app.all("*", (ctx) => {
  ctx.text("Page Not Found", 404);
});

console.log("Starting server on http://localhost:3005");
await app.init();
app.listen(3005, async () => {
  console.log("Server ready.");

  // Test 1: Fetch package.json
  console.log("\nTest 1: Fetching /assets/package.json");
  const resp1 = await fetch("http://localhost:3005/assets/package.json");
  console.log("Status:", resp1.status);
  console.log("Content-Type:", resp1.headers.get("Content-Type"));

  if (!resp1.ok) {
    console.error(
      "Error: Failed to fetch package.json. Body:",
      await resp1.text(),
    );
    process.exit(1);
  }

  const json = (await resp1.json()) as any;
  console.log("Name in JSON:", json.name);

  // Test 2: Fetch a non-existent file (should fall through to 404 or whatever)
  console.log("\nTest 2: Fetching non-existent /assets/missing.txt");
  const resp2 = await fetch("http://localhost:3005/assets/missing.txt");
  console.log("Status:", resp2.status); // Should be 404 since no one handled it

  // Test 3: Fetch manual route
  console.log("\nTest 3: Fetching manual /assets/manual");
  const resp3 = await fetch("http://localhost:3005/assets/manual");
  console.log("Status:", resp3.status);
  console.log("Body:", await resp3.text());

  process.exit(0);
});
