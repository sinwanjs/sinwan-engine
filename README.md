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
