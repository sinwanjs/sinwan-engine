import { Sinwan } from "./dist";

const app = await Sinwan.create();

// Simple JSON response
app.get("/json", (ctx) => {
  ctx.json({ message: "Hello performance" });
});

app.listen(3001);
