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
          <img src="https://img.shields.io/badge/coverage-100%25-brightgreen?logo=bun" alt="100% Test Coverage" />
        </p>
      </td>
    </tr>
  </table>
</div>

<br clear="both" />

Sinwan Engine gives you an engine-driven request pipeline, a typed event bus, a deterministic lifecycle manager, context pooling, and protocol routers for HTTP, WebSocket, TCP, UDP, and gRPC — all from a single `Sinwan` application instance built on Bun.

## Install

```sh
bun add sinwan-engine
```

> **Requires [Bun](https://bun.sh) runtime.**

## Quick Start

```ts
import { Sinwan } from "sinwan-engine";

const app = await Sinwan.create();

app.use((ctx) => {
  console.log(`[HTTP] ${ctx.req.method} ${ctx.req.url}`);
});

app.get("/", (ctx) => ctx.json({ hello: "world" }));

app.get("/users/:id", (ctx) => ctx.json({ id: ctx.params.id }));

app.post("/users", async (ctx) => {
  const body = await ctx.parseBody();
  ctx.json({ created: body }, 201);
});

await app.listen(3000, ({ port }) => {
  console.log(`Server live on http://localhost:${port}`);
});
```

## Middleware Patterns

Sinwan uses an **engine-driven** chain runner — handlers receive only `ctx` (no `next()`). The engine advances the chain itself, so you can't forget to call `next()`. For before/after middleware, use these substitutes:

### Before (runs before route handlers)

```ts
app.use((ctx) => {
  console.log(`[HTTP] ${ctx.req.method} ${ctx.req.url}`);
});
```

### After a handler commits a response

```ts
app.get("/users", async (ctx) => {
  ctx.once("response:set", (c, { statusCode }) => {
    console.log(`responded ${statusCode}`);
  });
  ctx.json(await listUsers());
});
```

### After the request finishes (app-level timing)

```ts
app.bus.on("request:end", (ctx, { durationMs }) => {
  console.log(`${ctx.req.method} ${ctx.req.url} — ${durationMs.toFixed(1)}ms`);
});
```

### Cleanup after the response is sent

```ts
app.use((ctx) => {
  const handle = acquireHandle();
  ctx.onDispose(() => handle.release()); // runs during context teardown
});
```

### Catch errors from async operations

```ts
app.get("/risky", async (ctx) => {
  try {
    ctx.json(await riskyOp());
  } catch (error) {
    await ctx.catch(error); // delegates to the ErrorHandler, sets an error response
  }
});
```

## CORS

Sinwan ships with a built-in `cors` middleware — a faithful port of the popular express `cors` package, adapted to Sinwan's `ctx`-only handler model. No external dependencies required.

```ts
import { Sinwan, cors } from "sinwan-engine";

const app = await Sinwan.create();

// Default: allow any origin
app.use(cors());

// Configured: allow-list, credentials, preflight cache
app.use(
  cors({
    origin: ["https://app.example.com", "https://admin.example.com"],
    credentials: true,
    maxAge: 86400,
  }),
);

// Dynamic origin delegate
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, false);
      cb(null, origin.endsWith(".example.com") ? origin : false);
    },
  }),
);
```

### Preflight (OPTIONS)

In Sinwan, middleware is baked into specific routes at registration time. For preflight (OPTIONS) requests to be handled by the `cors` middleware, register an OPTIONS route — the middleware short-circuits it automatically with a `204` (configurable via `optionsSuccessStatus`):

```ts
// cors() handles OPTIONS automatically when an OPTIONS route exists
app.options("/api/*", (ctx) => {}); // cors() short-circuits before this runs

// Or use cors.preflight() for an explicit, always-terminating handler
app.options("/api/*", cors.preflight({ origin: "*", maxAge: 3600 }));
```

### Options

| Option                 | Type                                                        | Default                                | Description                                                    |
| ---------------------- | ----------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------- |
| `origin`               | `boolean \| string \| string[] \| RegExp \| OriginDelegate` | `"*"`                                  | Origin policy. `false` disables CORS.                          |
| `methods`              | `string \| string[]`                                        | `GET,HEAD,PUT,PATCH,POST,DELETE,QUERY` | Allowed methods (preflight `Access-Control-Allow-Methods`).    |
| `allowedHeaders`       | `string \| string[]`                                        | _(reflect request)_                    | Allowed request headers (`Access-Control-Allow-Headers`).      |
| `exposedHeaders`       | `string \| string[]`                                        | _(none)_                               | Response headers exposed to the client.                        |
| `credentials`          | `boolean`                                                   | `false`                                | Send `Access-Control-Allow-Credentials: true`.                 |
| `maxAge`               | `number \| string`                                          | _(none)_                               | Preflight cache lifetime in seconds.                           |
| `preflightContinue`    | `boolean`                                                   | `false`                                | If `true`, don't short-circuit OPTIONS — pass to next handler. |
| `optionsSuccessStatus` | `number`                                                    | `204`                                  | Status code for short-circuited preflight responses.           |

See `examples/http/cors.ts` for a runnable example.

## HTTP `QUERY` Method

Sinwan supports the HTTP `QUERY` method ([draft-ietf-httpbis-safe-method-w-body](https://datatracker.ietf.org/doc/draft-ietf-httpbis-safe-method-w-body/)) — a safe, idempotent method that, unlike `GET`, carries a request body. It is designed for complex queries that don't fit in the URL query string (large/structured query payloads, sensitive parameters that shouldn't appear in URLs).

Register a `QUERY` route with `app.query()` (also available on `HTTPRouter` and the fluent module router). Read the query payload with `ctx.parseBody()` / `ctx.req.json()` like any other body-carrying method:

```ts
import { Sinwan } from "sinwan-engine";

const app = await Sinwan.create();

app.query("/search", async (ctx) => {
  const { q, limit = 10 } = await ctx.parseBody<{
    q: string;
    limit?: number;
  }>();
  ctx.json({ results: await search(q, limit) });
});

// curl -X QUERY http://localhost:3000/search \
//   -H "Content-Type: application/json" \
//   -d '{"q":"hello","limit":5}'
```

`QUERY` is included in the default CORS `Access-Control-Allow-Methods` and is advertised in the RFC 9110 `Allow` header on `405 Method Not Allowed` responses. There is no `QUERY`→`GET` fallback (the spec defines none); use `app.all()` if you want a single handler to cover multiple methods.

## Features

- **Multi-protocol**: HTTP, WebSocket, TCP, UDP, and gRPC from one engine
- **HTTP `QUERY` method**: Safe, idempotent, body-carrying queries via `app.query()`
- **Engine-driven pipeline**: Explicit orchestration in `Runtime.fetch()` — no `next()` chaining
- **Event bus**: Typed events with wildcards, AbortSignal support, and tracing
- **Lifecycle manager**: Five-phase lifecycle (`idle → init → ready → shutdown → destroyed`)
- **Context pooling**: Reusable per-request context with state, global state, and response helpers
- **Response helpers**: `json`, `text`, `html`, `redirect`, `stream`, `iterate`, `sse`, `buffer`, `file`
- **Built-in CORS**: `cors` middleware with dynamic origin, credentials, and preflight handling
- **Plugin system**: Encapsulate features as installable plugins
- **Module system**: Group routes into reusable modules (`createHttpModule`, `createWSModule`, …)
- **gRPC support**: Optional — install `sinwan-grpc` to enable typed gRPC services
- **Static files**: Serve directories with `app.static(prefix, root)`
- **Internal assets**: Built-in favicon and robots.txt handling
- **100% test coverage**: Every line in the engine is covered by automated tests

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
