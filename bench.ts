import { Sinwan } from "./src/sinwan";

const app = new Sinwan();

// Simple JSON response
app.get("/json", (ctx) => {
  ctx.json({ message: "Hello performance" });
});

await app.init();
app.listen(3001);
