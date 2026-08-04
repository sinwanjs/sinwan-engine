# Changelog

All notable changes to **Sinwan Engine** are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/) and Sinwan Engine adheres to [Semantic Versioning](https://semver.org/).

## [2.0.0] — 2026-08-04 — Breaking API Cleanup & Control-Flow Fixes

### Breaking Changes

- **`Sinwan` methods no longer return `this`** — `use()`, `get()`, `post()`, `put()`, `patch()`, `delete()`, `options()`, `head()`, `query()`, `all()`, `ws()`, `tcp()`, `udp()`, `grpc()`, `static()`, `install()`, and `register()` now return `void`. This prevents the `.get().use()` footgun at the type level (TypeScript compile error). **Migration:** replace `app.get("/a", h1).get("/b", h2)` and `app.install(p).register(m)` with standalone statements.
- **`ctx.continue()` removed** — `continue()` was an HTTP `100 Continue` response helper, NOT flow control. The name was a trap for Express/Koa users. Calling `ctx.continue()` now **throws**. **Migration:** replace `ctx.continue()` with `ctx.respondContinue()`.
- **`ctx.skip()` after response throws** — calling `skip()` when the chain has already halted (`ctx.json()`, `ctx.stop()`, `ctx.respond()`) now **throws** instead of being silently ignored.
- **Duplicate route registration throws** — registering the same `method + path` twice now **throws** instead of silently concatenating handlers.

### Added

- **`ctx.skip(count)` overload** — `skip()` now accepts an optional `count` parameter to skip multiple handlers: `ctx.skip(2)` skips the next 2 handlers. Default is `1` (backward-compatible). Calling `skip()` multiple times overwrites the count (last call wins).
- **`ctx.skipCount` getter** — returns the number of handlers to skip.
- **`ctx.respondContinue()`** — replaces the removed `ctx.continue()`. Sets an HTTP `100 Continue` response.
- **JSDoc warning on `HTTPRouterFluent.use()`** — clarifies that `use()` applies to subsequent routes only (registration-order semantics), not to a preceding route.

## [1.2.1] — 2026-08-04 — HTTP `QUERY` Method Support

### Added

- **HTTP `QUERY` method** ([draft-ietf-httpbis-safe-method-w-body](https://datatracker.ietf.org/doc/draft-ietf-httpbis-safe-method-w-body/)) — a safe, idempotent HTTP method that, unlike `GET`, carries a request body, intended for complex queries that don't fit in the URL query string. `QUERY` is now a first-class specific method in the radix router.
- **`Sinwan.prototype.query()`** — registers a `QUERY` route handler, mirroring `get`/`post`/…​ and returning `this` for fluent chaining.
- **`HTTPRouter.prototype.query()`** — underlying router registrar for `QUERY`.
- **`HTTPRouterFluent.query()`** — fluent module router registrar for `QUERY` (`createHttpModule` routes callback).
- **`Allow` header on `405 Method Not Allowed`** — `405` responses now include an RFC 9110 §15.5.5 `Allow` header listing the methods that have a handler for the matched path. `HTTPRouter.resolve()`'s `method-not-allowed` variant now carries an `allowed: SpecificMethod[]` field.

### Changed

- **CORS default `methods`** — `cors()` now advertises `GET,HEAD,PUT,PATCH,POST,DELETE,QUERY` in preflight `Access-Control-Allow-Methods` responses (previously `GET,HEAD,PUT,PATCH,POST,DELETE`). Users with an explicit `methods` config are unaffected.

## [1.2.0] — 2026-08-03 — Built-in CORS Middleware

### Added

- **Built-in CORS middleware** — port of the express `cors` package adapted to Sinwan's `ctx`-only handler model. Supports static/dynamic options, static/dynamic/regex/array origins, credentials, allowed/exposed headers, max-age, preflight short-circuit, and proper `Vary` header de-duplication. Includes `cors.preflight()` helper for explicit OPTIONS routes. No external dependencies.
  - `src/middleware/cors.ts`: middleware + types + helpers
  - `src/index.ts`: export `cors`, `CorsOptions`, `CorsOptionsDelegate`, `OriginOption`, `OriginDelegate`, `StaticOrigin`
  - `__test__/middleware/cors.test.ts`: 32 tests, 100% line coverage
  - `README.md`: CORS usage section + options table + Features bullet

## [1.1.1] — 2026-08-03 — Middleware Registration-Order Semantics

### Changed

- **`HTTPRouter` middleware** — middleware registered via `use()` now only applies to routes registered **after** the call, matching the `Sinwan.use` JSDoc. Previously, all router-level middleware was prepended to every matched route at resolve time, regardless of registration order, so middleware registered after a route still ran for it.

### Fixed

- **Middleware registration order** — `HTTPRouter.handle()` no longer re-concatenates `middlewares` + `match.handlers` per request. Each route now bakes the middleware snapshot into its handler chain once at `add()` time. This also corrects the mismatch between the `Sinwan.use` JSDoc ("applied to all routes registered after the call") and the actual order-independent behavior.
- **`HTTPRouter.mount()`** — no longer double-prepends child-router middleware. Child middleware travels with the child route's `handlers` (baked at child registration), and the parent's middleware is baked at mount time, yielding `parent mw → child mw → handlers`.

### Optimized

- **Per-request allocation** — `handle()` no longer allocates a new `[...middlewares, ...match.handlers]` array on every request (and again in the ALL-fallback branch). The chain is built once at startup, eliminating per-request array allocation and reducing GC pressure under load.

## [1.1.0] — 2026-08-03 — Architecture Cleanup & Async Refactor

### Removed

- **`step-engine.ts`** and its test file — eliminated the entire step-engine module and all references. The runtime now drives the middleware chain directly without the `StepEngine` abstraction layer.
- **`never`-typed overload stubs** for `beforeGRPC` — removed the `beforeGRPC(event: never, handler: never)` placeholder overload. The method now has a single concrete signature.

### Changed

- **`listenTCP`** and **`listenUDP`** — refactored from `.then()` chains to `async/await` for readability and error handling clarity.
- **`listenGRPC`** — refactored from `.then()` chains to `async/await`. The `never`-typed overload stub remains as a placeholder for the `sinwan-grpc` augmentation.
- **`package.json`** — moved `author`, `license`, `repository`, `bugs`, and `homepage` fields to the top of the file alongside `version` and `description` for better metadata visibility.

### Fixed

- **`middleware-patterns.ts`** example — removed invalid generic type argument `<{ durationMs: number }>` from `bus.on()` (the `E` type param is constrained to `string`, not payload shape) and completed the broken `as { durationMs: number }` cast on the payload.

## [1.0.5] — 2026-07-10 — Performance Optimizations

### Optimized

- **HTTPRouter.resolve()** — eliminated redundant URL parsing on every request. Changed signature from `resolve(method, url, start, end)` to `resolve(method, pathname)`. The router step now uses `ctx.pathname` (already parsed in `Context.setReq()`) instead of calling `getPathnameIndices()` + `url.slice()` per request. Removed dead functions `getPathnameIndices` and `segmentPathRaw`.
- **Context.setReq()** — consolidated URL parsing into a single-pass scan for `?` and `#` delimiters, with trailing-slash stripping to match route normalization. Previously, pathname parsing was split across `setReq` and `getPathnameIndices`.
- **Runtime.finalizeResponse()** — added fast-path for non-object bodies (`string`, `null`, `undefined`, `number`, `boolean`). Skips `instanceof ReadableStream`, `Symbol.asyncIterator`, and `_isSSE` checks when the body is not an object, reducing overhead on the most common response path.

### Benchmark Impact

- Reduced per-request overhead by eliminating duplicate URL parsing and short-circuiting persistent-body checks for simple responses.

## [1.0.4] — 2026-07-10 - Production Ready

### Fixed

- Fixed JSDoc import path in `modules.ts` — `from "./src/modules"` → `from "sinwan-engine"`

## [1.0.3] — 2026-07-10 — Production Ready (unpublished)

### Fixed

- Fixed JSDoc example in `register()` — `new Sinwan()` → `await Sinwan.create()`

## [1.0.2] — 2026-07-10 — Production Ready (unpublished)

### Fixed

- Fixed JSDoc example in `Sinwan.create()` — `app.listen(3000)` → `await app.listen(3000)`

## [1.0.1] — 2026-07-10 — Production Ready (unpublished)

### Changed

- Removed unused `happy-dom` devDependency
- Excluded `bench.ts` from `tsconfig.json` (imports from `./dist`, not available in CI before build)
- Switched release workflow to OIDC trusted publishing (`npm publish --provenance`)

## [1.0.0] — 2026-07-08 — Production Ready (unpublished)

### Fixed

- Fixed `StepEngine.run(ctx, bus)` signature mismatch in `internal-assets.test.ts` — all mock runtime calls now pass `runtime.bus` as second argument (29 typecheck errors resolved)
- Fixed TypeScript type inference errors in `context.test.ts` — added explicit type parameters to generic `get<T>()`, `getOnce<T>()`, `getGlobal<V>()`, `getGlobalOnce<V>()`, `update<T>()`, `updateGlobal<V>()` calls (17 typecheck errors resolved)
- Fixed `listenGRPC` overload resolution in `sinwan.test.ts` — added `as never` casts to match externally visible overload signature (2 typecheck errors resolved)
- Fixed `eventTrace[0]` possibly-undefined access with non-null assertions
- Fixed `GRPCData` type annotation on gRPC test object (widened `kind: "unary"` to `string`)
- Fixed `let received` implicit `undefined` type in event emit tests — typed as `unknown`
- Fixed `callbackInfo` null narrowing in `listen` callback test — non-null assertion added
- Fixed `HTTPRouterFluent` test assertions — captured actual router from `app.mount` call args instead of using separate router variable
- Fixed `can()` method test in `lifecycle-manager.test.ts` to reflect actual allowed state transitions
- Fixed `SinwanOptions` test payload — removed invalid `port` property, used empty object `{}`

### Added — Tests

- **`modules.test.ts`** (33 tests) — comprehensive coverage for `createStep`, `createPlugin`, `createHttpModule`, `createWSModule`, `createTCPModule`, `createUDPModule`, `createGRPCModule`, `HTTPRouterFluent` chaining (get/post/put/patch/delete/options/head/all/use/group/mount/static), and `SinwanModule` interface conformance
- **`lifecycle-manager.test.ts`** (comprehensive) — event subscription methods (`on`, `off`, `once`), lifecycle state transitions (`init`, `ready`, `shutdown`, `destroy`), error cases, state query methods (`getState`, `is`), transition validation (`can`), state assertion (`assert`), event emission payloads, and multiple listeners
- **`error-handler-integration.test.ts`** (34 tests) — real-world integration tests using `Sinwan.request()` through the full runtime pipeline:
  - Synchronous and async error propagation with correct status codes
  - Stack trace integrity (function names, actual `Error.stack`, custom error subclasses)
  - Non-Error throws (string, error-like objects, null, undefined, numbers)
  - Event bus integration (`request:error`, `error` events, listener errors, `onError` hook)
  - HTML error responses with XSS escaping and custom formatters
  - Production safety (message masking, stack stripping, status code preservation)
  - Error after partial response (no override of existing response)
  - Multiple errors in sequence with context pool reuse (no state leakage)
  - Step error propagation (sync and async)

### Added — CI/CD

- **`.github/workflows/ci.yml`** — CI pipeline with 3 parallel jobs (typecheck, test + coverage, build) triggered on push/PR to `main` and `develop`. Includes concurrency cancellation, frozen lockfile, artifact uploads (coverage + dist)
- **`.github/workflows/release.yml`** — Release pipeline triggered on `v*` tags. Two-stage: verify (typecheck + test + build) then publish to npm + create GitHub Release with auto-generated notes. Supports pre-release detection from tag name

### Coverage

- All 20 source files at **100% line coverage**
- 1027 tests passing across 18 test files
- `tsc --noEmit` passes with zero errors

## [0.1.0] — 2026-07-06 — Open Source Release

Sinwan Engine 0.1.0 is the first public release. It provides a unified server runtime for HTTP, WebSocket, TCP, UDP, and gRPC — with a step-based middleware pipeline, a typed event bus, a deterministic lifecycle manager, context pooling, and a modular route factory system, all built on Bun.
