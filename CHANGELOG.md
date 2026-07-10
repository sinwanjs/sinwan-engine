# Changelog

All notable changes to **Sinwan Engine** are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/) and Sinwan Engine adheres to [Semantic Versioning](https://semver.org/).

## [1.0.3] — 2026-07-10

### Fixed

- Fixed JSDoc example in `register()` — `new Sinwan()` → `await Sinwan.create()`

## [1.0.2] — 2026-07-10

### Fixed

- Fixed JSDoc example in `Sinwan.create()` — `app.listen(3000)` → `await app.listen(3000)`

## [1.0.1] — 2026-07-10 - Production Ready

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
