import { Sinwan } from "./src";

const app = new Sinwan();


// Simple JSON response
app.get("/json", (ctx) => {
  ctx.json({ message: "Hello performance" });
});

app.listen(3001);
