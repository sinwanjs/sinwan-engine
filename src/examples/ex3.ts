import { Sinwan } from "../sinwan";

const app = new Sinwan();

app.use((ctx) => {
  console.log("Request received");
});

app.get("/hello", (ctx) => {
  ctx.text("Hello World");
});

app.group("/api", (router) => {
  router.use((ctx) => {
    console.log("Request received from api");
  });
  router.get("/hello", (ctx) => {
    ctx.text("Hello World0");
  });
  router.group("/v1", (router) => {
    router.get("/hello", (ctx) => {
      ctx.text("Hello World1");
    });
    router.use((ctx) => {
      console.log("Request received from api1");
    });
    router.get("/hello2", (ctx) => {
      ctx.text("Hello World2");
    });
  });
});

await app.init();
app.listen(3000, async () => {
  console.log("Server ready. on http://localhost:3000");
});
