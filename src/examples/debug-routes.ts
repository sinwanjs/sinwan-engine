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
  });
});

// @ts-ignore - accessing private to debug
const routes = app.router.routes;
console.log("Registered Routes:");
routes.forEach((r: any) => {
  console.log(`${r.method} ${r.path}`);
});
