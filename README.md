<div align="left">
  <table border="0" width="100%" align="center">
    <tr>
      <td width="150" align="left">
        <img src="https://avatars.githubusercontent.com/u/252437356?s=400&v=4" alt="Sinwan Engine Logo" width="150" />
      </td>
      <td align="left">
        <h1>Sinwan Engine</h1>
        <p>A unified server runtime for HTTP, WebSocket, TCP, UDP, and gRPC — APIs, real-time systems, microservices, and event-driven apps from a single engine.</p>
        <p>
          <a href="https://github.com/sinwanjs/sinwan-engine/stargazers"><img src="https://img.shields.io/github/stars/sinwanjs/sinwan-engine.svg?color=ffce3b&label=stars&logo=github" alt="GitHub stars" /></a>
          <a href="https://www.npmjs.com/package/sinwan-engine"><img src="https://img.shields.io/npm/dm/sinwan-engine?color=42b883&label=downloads&logo=npm" alt="NPM Downloads" /></a>
          <a href="./LICENSE"><img src="https://img.shields.io/npm/l/sinwan-engine?color=35495e&label=license" alt="License" /></a>
        </p>
      </td>
    </tr>
  </table>
</div>

<br clear="both" />

Sinwan Engine gives you a step-based middleware pipeline, a typed event bus, a deterministic lifecycle manager, context pooling, and protocol routers for HTTP, WebSocket, TCP, UDP, and gRPC — all from a single `Sinwan` application instance built on Bun.

## Install

```sh
bun add sinwan-engine
```

> **Requires [Bun](https://bun.sh) runtime.**

## Quick Start

```ts
import { Sinwan } from "sinwan-engine";

const app = await Sinwan.create();

app
  .get("/", (ctx) => ctx.json({ hello: "world" }))
  .get("/users/:id", (ctx) => ctx.json({ id: ctx.params.id }))
  .post("/users", async (ctx) => {
    const body = await ctx.parseBody();
    ctx.json({ created: body }, 201);
  });

await app.listen(3000, ({ port }) => {
  console.log(`Server live on http://localhost:${port}`);
});
```

## Features

- **Multi-protocol**: HTTP, WebSocket, TCP, UDP, and gRPC from one engine
- **Step pipeline**: Named, deterministic middleware steps — no `next()` chaining
- **Event bus**: Typed events with wildcards, AbortSignal support, and tracing
- **Lifecycle manager**: Five-phase lifecycle (`idle → init → ready → shutdown → destroyed`)
- **Context pooling**: Reusable per-request context with state, global state, and response helpers
- **Response helpers**: `json`, `text`, `html`, `redirect`, `stream`, `iterate`, `sse`, `buffer`, `file`
- **Plugin system**: Encapsulate features as installable plugins
- **Module system**: Group routes into reusable modules (`createHttpModule`, `createWSModule`, …)
- **gRPC support**: Optional — install `sinwan-grpc` to enable typed gRPC services
- **Static files**: Serve directories with `app.static(prefix, root)`
- **Internal assets**: Built-in favicon and robots.txt handling

## HTTP Routing

```ts
app
  .get("/health", (ctx) => ctx.json({ status: "ok" }))
  .post("/users", createUser)
  .put("/users/:id", updateUser)
  .delete("/users/:id", deleteUser)
  .all("/ping", (ctx) => ctx.text("pong"));
```

### Route Groups

```ts
app.group("/api/v1", (r) => {
  r.get("/users", listUsers);
  r.post("/users", createUser);
  r.get("/posts", listPosts);
});
```

### Mount a Router

```ts
import { HTTPRouter } from "sinwan-engine";

const apiRouter = new HTTPRouter();
apiRouter.get("/users", listUsers);

app.mount("/api", apiRouter);
```

### Static Files

```ts
app.static("/public", "./public");
```

## Middleware (Steps)

Steps execute sequentially in registration order. Return `{ type: "stop" }` to halt the pipeline.

```ts
app
  .add("auth", async (ctx) => {
    const token = ctx.req.headers.get("authorization");
    if (!token) {
      ctx.json({ error: "Unauthorized" }, 401);
      return { type: "stop" };
    }
    ctx.set("user", await verifyToken(token));
  })
  .add("cors", (ctx) => {
    ctx.setHeader("Access-Control-Allow-Origin", "*");
  });
```

## Plugins

```ts
import { createPlugin, createStep } from "sinwan-engine";

const loggerStep = createStep("logger", (ctx) => {
  console.log(`${ctx.req.method} ${ctx.req.url}`);
});

const loggerPlugin = createPlugin("logger", (rt) => {
  rt.bus.on("request:start", (ctx) => {
    console.log(`${ctx.req.method} ${ctx.req.url}`);
  });
});

app.install(loggerPlugin);
app.add(loggerStep);
```

## Modules

Encapsulate routes into self-contained, reusable modules.

```ts
import { createHttpModule, createWSModule } from "sinwan-engine";

const apiModule = createHttpModule({
  prefix: "/api/v1",
  routes: (r) => {
    r.get("/users", listUsers).post("/users", createUser);
  },
});

const chatModule = createWSModule({
  path: "/chat",
  config: {
    open(ws) {
      ws.subscribe("room:1");
    },
    message(ws, msg) {
      ws.publish("room:1", msg);
    },
  },
});

app.register(apiModule, chatModule);
```

## WebSocket

```ts
app.ws("/chat", {
  upgrade(ctx) {
    ctx.set("ws:data", { userId: ctx.req.headers.get("x-user-id") });
  },
  open(ws) {
    ws.subscribe("room:1");
  },
  message(ws, msg) {
    ws.publish("room:1", msg);
  },
  close(ws) {
    ws.unsubscribe("room:1");
  },
});
```

## TCP

```ts
app.tcp("echo", {
  data(socket, data) {
    socket.write(data);
  },
});

await app.listenTCP("echo", { port: 4000 });
```

## UDP

```ts
app.udp("discovery", {
  data(socket, data, port, addr) {
    socket.sendUDP("ack", port, addr);
  },
});

await app.listenUDP("discovery", { port: 5000 });
```

## gRPC

gRPC is optional. Install `sinwan-grpc` to enable typed gRPC services.

```sh
bun add sinwan-grpc
```

```ts
import { sinwanGRPC } from "sinwan-grpc";

app.register(sinwanGRPC);

app.grpc("greeter", {
  proto: "./proto/greeter.proto",
  package: "hello.v1",
  service: "Greeter",
  methods: {
    SayHello: (ctx, request) => ({ message: `Hello ${request.name}` }),
  },
});

await app.listenGRPC({ port: 50051 });
```

## Server-Sent Events

```ts
app.get("/events", (ctx) => {
  const sse = ctx.sse();

  const interval = setInterval(() => {
    sse.send({ time: Date.now() });
  }, 1000);

  ctx.onDispose(() => clearInterval(interval));
});
```

## Lifecycle

```ts
app.lifecycle
  .on("init", async () => {
    await db.connect(process.env.DATABASE_URL);
  })
  .on("ready", ({ port }) => {
    console.log(`Ready on port ${port}`);
  })
  .on("shutdown", async () => {
    await db.close();
  });
```

## Event Bus

```ts
app.bus.on("request:start", (ctx) => {
  console.log(`${ctx.req.method} ${ctx.req.url}`);
});

app.bus.on("request:*", (ctx) => {
  // Wildcard matching
});
```

## Context

Each request gets a `Context` from the `acquireContext` method in the runtime instance to avoid creating new objects for each request. The context has state, response helpers, and protocol accessors.

```ts
app.get("/profile", (ctx) => {
  const user = ctx.get<User>("user");
  const page = ctx.query.get("page") ?? "1";
  ctx.json({ user, page });
});
```

### Response Helpers

- **`ctx.json(data, status?)`** — JSON response
- **`ctx.text(data, status?)`** — Plain text response
- **`ctx.html(html, status?)`** — HTML response
- **`ctx.redirect(path, status?)`** — Redirect response
- **`ctx.stream(readable, status?, type?)`** — Streaming response
- **`ctx.iterate(iterator, status?, type?)`** — Async iterator response
- **`ctx.sse(options?)`** — Server-Sent Events with controller
- **`ctx.buffer(data, status?, type?)`** — Binary response
- **`ctx.file(path, status?, type?)`** — File response (zero-copy via `Bun.file`)

## Testing

```ts
// No need to start a real server
const res = await app.request("/users/42");
const data = await res.json();
```

## Graceful Shutdown

```ts
await app.stop(true); // close all active connections
```

## Development

```sh
bun test
bun run typecheck
bun run build
```

## Author

Mohammed Ben Cheikh

## License

MIT — see [LICENSE](./LICENSE).
