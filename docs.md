# SinwanJS Architecture & System Design

SinwanJS is a high-performance, deterministic web framework built natively for **Bun**. It departs from the traditional middleware-chain pattern (like Express or Koa) in favor of a structured, step-based execution model.

## The Pattern: **Linear Step Orchestration (LSO)**

The core architectural pattern used in SinwanJS is **Linear Step Orchestration (LSO)**.

### Why LSO?
Traditional frameworks use the `next()` callback pattern, which can lead to complex "middleware hell" where the flow of execution is hard to trace. 

**LSO** solves this by:
1.  **Deterministic Execution**: Steps are registered and executed in a strict, predictable sequence.
2.  **No `next()` Dependency**: Each step is a self-contained unit of work. The engine decides whether to move to the next step based on the result or context state.
3.  **Unified Context**: A single `Context` object travels through the pipeline, carrying the request, response tools, and state.
4.  **Plugin-as-a-Step**: Core features like Routing and Error Handling are themselves "Steps" in the orchestration, making the framework extremely modular.

### Middleware: Reimagined
In SinwanJS, there is no "Middleware" in the traditional sense. Instead, we have:
- **Engine Steps**: Global logic (e.g., Auth, Logging) added directly to the `StepEngine`.
- **Route Handlers**: Sequence of functions executed when a route matches.
- **Flow Control**: Instead of calling `next()`, a handler simply returns. To stop the chain, a handler calls `ctx.stop()` or sends a response.

---

## System Design Overview

SinwanJS is composed of several decoupled components that work together through an event-driven architecture.

### 1. The Core Engine (`Sinwan`)
The `Sinwan` class is the entry point. It instantiates all sub-systems and provides the high-level API (e.g., `.get()`, `.post()`, `.listen()`).

### 2. The Step Engine (`StepEngine`)
The "brain" of the framework. It manages a registry of **named steps**.
-   **Sequential**: Runs steps in the order they were added.
-   **Safe**: Detects duplicate steps to prevent ordering bugs.
-   **Reactive**: Respects stop signals (`ctx.stop()`) and automatic response detection.

### 3. The Runtime Orchestrator (`Runtime`)
Handles the low-level Bun `fetch` interface.
-   **Request Isolation**: Creates a fresh `Context` for every incoming request.
-   **Lifecycle Control**: Emits events like `request:start`, `request:end`, and `request:error`.
-   **Safety Net**: Ensures a 500 response is sent if the pipeline fails to produce any output.

### 4. The Context Object (`Context`)
A powerful, unified API for request and response handling.
-   **Request**: Access to headers, body, params, and cookies.
-   **Response**: Methods like `.json()`, `.text()`, `.file()`, and `.stream()`.
-   **State**: Local request state and Global application state management.

### 5. The Lifecycle Manager (`LifecycleManager`)
Enforces a strict state machine for the application:
`IDLE` → `INIT` → `READY` → `SHUTDOWN` → `DESTROYED`
This ensures that plugins and services are initialized and cleaned up in the correct order.

### 6. The Event Bus (`EventBus`)
A lightweight, asynchronous communication layer. Components use the bus to signal transitions and hooks without being tightly coupled.

### 7. The Error Handler (`ErrorHandler`)
A centralized safety net for error normalization and response generation.
- **Normalization**: Converts strings, objects, or standard Errors into a consistent JSON format.
- **Production Safety**: Automatically masks internal error details in production environments.
- **Hooks**: Supports an optional `onError` hook for logging or telemetry integration.

---

## Request Flow (The "Step" Journey)

When a request hits a SinwanJS server:

1.  **Entry**: Bun calls `Runtime.fetch()`.
2.  **Creation**: A new `Context` is initialized.
3.  **Start Hook**: `request:start` event is emitted.
4.  **Step Execution**:
    -   **Step 1 (Router)**: Matches the URL. If a match is found, it executes the **Route Handler Chain** (sequential middleware-like functions) until completion or a stop signal is received.
    -   **Step 2 (Custom)**: Any user-defined steps (e.g., logging, validation).
    -   **Step 3 (Finalize)**: Prepares the final response.
5.  **Stop Check**: If a step calls `ctx.json()` or `ctx.stop()`, the engine halts immediately.
6.  **Response**: The `Runtime` extracts the response from the `Context` and returns it to Bun.
7.  **Error Handling**: If an error occurs at any step, the `Runtime` catches it and hands it to the **ErrorHandler**, which ensures a structured error response is sent.
8.  **Cleanup**: Resources are disposed of (unless streaming).

---

## Key Technical Strengths

-   **Zero-Copy Streaming**: Leverages `Bun.file()` and `ReadableStream` for maximum efficiency.
-   **Type Safety**: Built from the ground up with TypeScript for a robust developer experience.
-   **Regex-Powered Routing**: Flexible path matching with named parameters and wildcard support.
-   **Memory Efficient**: Strict per-request context disposal prevents leaks.
