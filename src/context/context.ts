/**
 * SinwanJS Core Runtime — Context
 *
 * Per-request state container. Holds the incoming Request,
 * outgoing response data, and control flags.
 *
 * Design:
 *  - Once a response is set (via json/text), the context is
 *    marked as "responded" and further mutations are rejected
 *    with a thrown error (loud failure > silent corruption).
 *  - stop() halts step execution but does NOT set a response.
 *  - Context can interact with the EventBus when attached.
 */

import {
  type CookieMap,
  type Server,
  type ServerWebSocket,
  type Socket,
  randomUUIDv7,
} from "bun";
import type { EventBus } from "../event-bus";
import type {
  EmitOptions,
  EmitResult,
  EventHandler,
  EventMeta,
  EventTraceEntry,
  EventTraceOptions,
  ListenerOptions,
  SSEController,
  SSEOptions,
  Request,
  SaveFileOptions,
  ResponseKind,
} from "../types";
import type { SinwanUDPSocket } from "../routers/udp-router";
import { SocketHelper } from "./socket-helper";
import type { ErrorHandler } from "../error-handler";

export interface WSSData {
  path: string;
  data: unknown;
  /** Snapshot of the Context state from the upgrade request. */
  state?: Record<string, unknown>;
}

export interface TCPData {
  name: string;
  data: unknown;
}

export interface UDPData {
  name: string;
  data: unknown;
}

export interface GRPCData {
  name: string;
  package?: string;
  service: string;
  method: string;
  path: string;
  kind: "unary" | "serverStream" | "clientStream" | "bidi";
  request?: unknown;
  call: unknown;
  metadata: unknown;
  data: unknown;
}

export interface ContextOptions {
  requestId?: string;
  bus?: EventBus;
  trace?: EventTraceOptions;
  server?: any;
  errorHandler: ErrorHandler;
  global?: Map<string, any>;
}

/**
 * Custom HTTP error class for handling HTTP-specific errors.
 * Extends the native Error class with a statusCode property.
 */
class HttpError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

export class Context {
  /** The incoming Bun/Web API Request. */
  public req: Request;

  /** Cached pathname parsed from the request URL. */
  public pathname: string = "";

  /**
   * The Bun Server instance (if provided).
   * Guards added in clientIP / setTimeout before access.
   */
  public server: Server<any> | undefined;

  private errorHandler: ErrorHandler;

  public ws?: ServerWebSocket<WSSData>;

  public tcp?: Socket<TCPData>;

  public udp?: SinwanUDPSocket<UDPData>;

  public grpc?: GRPCData;

  /** HTTP status code for the response. */
  public statusCode: number = 200;

  /** Response body — set via json() or text(). */
  public body: unknown = null;

  /** Response headers. */
  private _headers?: Headers;
  get headers(): Headers {
    if (!this._headers) this._headers = new Headers();
    return this._headers;
  }

  /** Arbitrary per-request state for steps/plugins. */
  private _state?: Map<string, any>;
  get state(): Map<string, any> {
    if (!this._state) this._state = new Map();
    return this._state;
  }

  /** Shared application-level state. */
  private readonly global: Map<string, any>;
  public params: Record<string, string> = {};
  private _requestId: string = "";

  public maxBodySize: number = 10 * 1024 * 1024; // Default 10MB

  get requestId(): string {
    if (this._requestId === "") {
      this._requestId = `sinwan-request-${randomUUIDv7()}`;
    }
    return this._requestId;
  }

  set requestId(value: string) {
    this._requestId = value;
  }

  // ─── Internal Flags ─────────────────────────────────────

  private _status: number = 0;
  private static readonly STOPPED = 1 << 0;
  private static readonly RESPONDED = 1 << 1;
  private static readonly DISPOSED = 1 << 2;
  private static readonly STREAMING = 1 << 3;

  private _parsedBody: unknown = undefined;
  private _formData?: FormData;
  private _bus?: EventBus;
  private _onDisposeCallbacks: (() => void)[] = [];
  private _released = false;
  private readonly _sockets = new SocketHelper(this);

  /** @internal */
  public _meta: any = {
    name: "",
    event: "",
    timestamp: 0,
    sequence: 0,
    requestId: "",
    source: undefined,
  };

  private readonly traceOptions: Required<EventTraceOptions>;
  private _eventTrace?: EventTraceEntry[];
  private _traceStart: number = 0;
  private _traceSize: number = 0;

  get eventTrace(): EventTraceEntry[] {
    const buffer = this.getTraceBuffer();
    if (this._traceSize === 0) return buffer;
    if (this._traceStart === 0 && this._traceSize === buffer.length)
      return buffer;

    const ordered = new Array<EventTraceEntry>(this._traceSize);
    const len = buffer.length;
    for (let i = 0; i < this._traceSize; i += 1) {
      ordered[i] = buffer[(this._traceStart + i) % len]!;
    }
    return ordered;
  }

  private _scopedHandlers?: Map<string, Map<EventHandler, Set<EventHandler>>>;
  get scopedHandlers(): Map<string, Map<EventHandler, Set<EventHandler>>> {
    if (!this._scopedHandlers) this._scopedHandlers = new Map();
    return this._scopedHandlers;
  }

  constructor(options: ContextOptions) {
    this.req = undefined as unknown as Request;
    this.server = options.server;
    if (options.requestId) this._requestId = options.requestId;
    this._bus = options.bus;

    this.traceOptions = {
      enabled: options.trace?.enabled ?? true,
      maxEntries: options.trace?.maxEntries ?? 100,
      includePayload: options.trace?.includePayload ?? false,
    };

    this.global = options.global ?? new Map();
    this.errorHandler = options.errorHandler;
  }

  /**
   * Reset the context for reuse in a pool.
   */
  reset(options: ContextOptions): void {
    this.req = undefined as unknown as Request;
    this.pathname = "";
    this.server = options.server;
    this.ws = undefined;
    this.tcp = undefined;
    this.udp = undefined;
    this.grpc = undefined;
    this.statusCode = 200;
    this.body = null;
    this.params = {};
    this._requestId = options.requestId || "";
    this._status = 0;
    this._parsedBody = undefined;
    this._formData = undefined;
    this._bus = options.bus;
    this._onDisposeCallbacks.length = 0;
    this._released = false;

    // Reset meta
    this._meta.name = "";
    this._meta.event = "";
    this._meta.timestamp = 0;
    this._meta.sequence = 0;
    this._meta.requestId = options.requestId || "";
    this._meta.source = undefined;

    // Fast clear for reused objects
    if (this._headers) this._headers = undefined;
    if (this._state) this._state.clear();
    if (this._eventTrace) this._eventTrace.length = 0;
    this._traceStart = 0;
    this._traceSize = 0;
    this._scopedHandlers = undefined;
  }

  /**
   * Handle an error that occurred during request processing.
   * This method is called by the server when an error is thrown.
   */
  catch(error: unknown, ctx: Context, showMessageInProduction: boolean) {
    this.errorHandler.handle(error, ctx, showMessageInProduction);
  }

  /**
   * Mark this context as released to the pool.
   * Returns `true` if it was already released (double-release guard).
   */
  markReleased(): boolean {
    const wasReleased = this._released;
    this._released = true;
    return wasReleased;
  }

  /**
   * Set the request (must be called before execute)
   */
  setReq(req: Request): void {
    this.req = req;
    const url = req.url;
    const start = url.indexOf("//") + 2;
    const pathStart = url.indexOf("/", start);
    const queryStart = url.indexOf("?", pathStart);
    this.pathname =
      pathStart === -1
        ? "/"
        : queryStart === -1
          ? url.slice(pathStart)
          : url.slice(pathStart, queryStart);
  }

  /**
   * Set the WebSocket (must be called before execute)
   */
  setWS(ws: ServerWebSocket<WSSData>): void {
    this.ws = ws;
  }

  /**
   * Set the TCP socket (must be called before execute)
   */
  setTCP(tcp: Socket<TCPData>): void {
    this.tcp = tcp;
  }

  /**
   * Set the UDP socket (must be called before execute)
   */
  setUDP(udp: SinwanUDPSocket<UDPData>): void {
    this.udp = udp;
  }

  /**
   * Set the gRPC call data (must be called before execute)
   */
  setGRPC(grpc: GRPCData): void {
    this.grpc = grpc;
  }

  // ─── State Management ───────────────────────────────────
  /** Set a value in the request state. */
  set<V>(key: string, value: V): void {
    this.state.set(key, value);
  }

  /** Get a value from the request state. */
  get<T>(key: string): T | undefined {
    return this.state.get(key) as T;
  }

  /** Get a value from the request state and remove it. */
  getOnce<T>(key: string): T | undefined {
    const value = this.state.get(key) as T | undefined;
    this.state.delete(key);
    return value;
  }

  /** Export the current state as a plain object (for WS bridge).
   * Keys starting with `_` are excluded to protect internal data. */
  exportState(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of this.state) {
      if (!key.startsWith("_")) result[key] = value;
    }
    return result;
  }

  /** Import a state snapshot into this context (from WS upgrade). */
  importState(state: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(state)) {
      this.state.set(key, value);
    }
  }

  /** Update an existing value in the request state. */
  update<T>(key: string, updater: (prev: T | undefined) => T): T {
    const nextValue = updater(this.get(key));
    this.state.set(key, nextValue);
    return nextValue;
  }

  /** Remove a value from the request state. */
  clear(key: string): boolean {
    return this.state.delete(key);
  }

  /** Remove all values from the request state. */
  clearAll(): void {
    this.state.clear();
  }

  /** Check if a value exists in the request state. */
  has(key: string): boolean {
    return this.state.has(key);
  }

  /**
   * Get a snapshot of the current request state as a readonly object.
   * This is useful for debugging and logging.
   */
  snapshot(): Readonly<Record<string, unknown>> {
    return Object.freeze(
      Object.fromEntries(this.state) as Record<string, unknown>,
    );
  }

  // ─── Global State Management ──────────────────────────────

  /** Set a value in the global application state. */
  setGlobal<V>(key: string, value: V): void {
    this.global.set(key, value);
  }

  /** Get a value from the global application state. */
  getGlobal<V>(key: string): V | undefined {
    return this.global.get(key) as V | undefined;
  }

  /** Get a value from the global application state and remove it. */
  getGlobalOnce<V>(key: string): V | undefined {
    const value = this.global.get(key) as V | undefined;
    this.global.delete(key);
    return value;
  }

  /** Update an existing value in the global application state. */
  updateGlobal<V>(key: string, updater: (prev: V | undefined) => V): V {
    const nextValue = updater(this.getGlobal(key));
    this.global.set(key, nextValue);
    return nextValue;
  }

  /** Remove a value from the global application state. */
  clearGlobal(key: string): boolean {
    return this.global.delete(key);
  }

  /** Remove all values from the global application state. */
  clearAllGlobal(): void {
    this.global.clear();
  }

  /** Check if a value exists in the global application state. */
  hasGlobal(key: string): boolean {
    return this.global.has(key);
  }

  /**
   * Get all global state as readonly object.
   * This is useful for debugging and logging.
   */
  snapshotGlobal(): Readonly<Record<string, unknown>> {
    return Object.freeze(
      Object.fromEntries(this.global) as Record<string, unknown>,
    );
  }

  // ─── Response Methods ───────────────────────────────────

  /**
   * Set a JSON response body.
   * Throws if a response has already been set.
   */
  json(data: unknown, status?: number): void {
    this.guardDoubleResponse();
    // Store raw object; buildResponse() will use Response.json() for native serialization
    this.commitResponse("json", data, status, "application/json");
  }

  /**
   * Set a plain-text response body.
   * Throws if a response has already been set.
   */
  text(data: string, status?: number): void {
    this.guardDoubleResponse();
    this.commitResponse("text", data, status, "text/plain");
  }

  /**
   * Set an HTML response body.
   * Throws if a response has already been set.
   */
  html(
    html: string | Promise<string> | any,
    status?: number,
  ): void | Promise<void> {
    if (html instanceof Promise) {
      return html.then((str) => {
        this.guardDoubleResponse();
        this.commitResponse("text", str, status, "text/html; charset=UTF-8");
      });
    }
    this.guardDoubleResponse();

    this.commitResponse("text", html, status, "text/html; charset=UTF-8");
  }

  /**
   * Redirect to a location.
   */
  redirect(path: string, status: number = 302): void {
    this.guardDoubleResponse();
    const url = new URL(path, this.req.url);
    this.headers.set("Location", url.toString());
    this.commitResponse("redirect", null, status);
  }

  /**
   * Redirect to a location with temporary data.
   * Data is stored in global state using a unique ephemeral key.
   */
  redirectWith<T>(
    path: string,
    data: T,
    options: {
      status?: 301 | 302 | 303 | 307 | 308;
      keyParam?: string;
    } = {},
  ): void {
    const { status = 302, keyParam = "redirect" } = options;

    // Generate unique temporary key
    const dataKey = `id_${crypto.randomUUID()}`;

    // Store redirect payload
    this.setGlobal(dataKey, data);

    // Build safe URL
    const url = new URL(path, this.req.url);
    url.searchParams.set(keyParam, dataKey);

    this.guardDoubleResponse();

    this.headers.set("Location", url.toString());

    this.commitResponse("redirect", null, status);
  }

  /**
   * Retrieve and consume redirect data.
   * The stored payload is removed immediately after access.
   */
  redirectData<V>(keyParam: string = "redirect"): V | undefined {
    const url = new URL(this.req.url);

    const dataKey = url.searchParams.get(keyParam);

    if (!dataKey) {
      return undefined;
    }

    // Prevent arbitrary global access
    if (!dataKey.startsWith("id_")) {
      return undefined;
    }

    return this.getGlobalOnce<V>(dataKey);
  }

  /**
   * Set a streaming response body.
   */
  stream(
    readable: ReadableStream,
    status?: number,
    contentType: string = "application/octet-stream",
  ): void {
    this.guardDoubleResponse();

    // Mark as streaming to prevent premature pool reuse
    this._status |= Context.STREAMING;

    this.commitResponse(
      "stream",
      this.wrapStreamWithDisposal(readable),
      status,
      contentType,
    );
  }

  /**
   * Set a streaming response body using an async iterator or generator function.
   * Leveraging Bun's native support for streaming async iterables.
   * The iterator is wrapped to ensure context disposal on completion.
   */
  iterate(
    iterator: AsyncIterable<any> | (() => AsyncGenerator<any>),
    status?: number,
    contentType: string = "text/plain",
  ): void {
    this.guardDoubleResponse();

    // Mark as streaming to prevent premature pool reuse
    this._status |= Context.STREAMING;

    // Wrap iterator to ensure disposal on completion
    const wrappedIterator = this.wrapIteratorWithDisposal(iterator);
    this.commitResponse("iterator", wrappedIterator, status, contentType);
  }

  /** Start a Server-Sent Events response and return a controller for sending events. */
  sse(options: SSEOptions = {}): SSEController {
    this.guardDoubleResponse();

    // Mark as streaming to prevent premature pool reuse
    this._status |= Context.STREAMING;

    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let closed = false;

    // The cancel arrow function correctly captures `this` (Context instance)
    // from the enclosing scope — no change needed here.
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        controller = ctrl;
      },
      cancel: (_reason) => {
        closed = true;
        this.dispose();
      },
    });

    const enqueue = (value: string) => {
      if (closed) return;
      controller.enqueue(encoder.encode(value));
    };

    const send = (
      data: string | object,
      event?: string,
      id?: string,
      retry?: number,
    ) => {
      if (closed) return;

      if (retry !== undefined) enqueue(`retry: ${retry}\n`);
      if (id !== undefined) enqueue(`id: ${id}\n`);
      if (event !== undefined) enqueue(`event: ${event}\n`);

      const payload = typeof data === "string" ? data : JSON.stringify(data);
      payload.split("\n").forEach((line) => enqueue(`data: ${line}\n`));
      enqueue("\n");
    };

    const comment = (text: string) => {
      if (closed) return;
      enqueue(`: ${text}\n\n`);
    };

    const close = () => {
      if (closed) return;
      closed = true;
      try {
        controller.close();
      } catch {
        // Ignore errors if already closed
      }
      this.dispose();
    };

    this.headers.set("Cache-Control", "no-cache");
    this.headers.set("Connection", "keep-alive");

    if (options.timeout !== undefined) {
      this.setTimeout(options.timeout);
    }

    this.commitResponse(
      "sse",
      stream,
      options.status ?? 200,
      "text/event-stream",
    );

    if (options.retry !== undefined) {
      enqueue(`retry: ${options.retry}\n`);
    }
    comment("ok");

    return { send, comment, close };
  }

  buffer(
    data: Uint8Array | ArrayBuffer,
    status?: number,
    contentType: string = "application/octet-stream",
  ): void {
    this.guardDoubleResponse();
    this.commitResponse("buffer", data, status, contentType);
  }

  /**
   * Set a file response body leveraging Bun.file() for zero-copy streaming.
   * Automatically infers Content-Type based on file extension.
   */
  file(path: string, status?: number, contentType?: string): void {
    this.guardDoubleResponse();
    const file = Bun.file(path);
    // Use provided contentType, or file's inferred type (which Bun provides),
    // or fallback to octet-stream if inference failed.
    const finalType =
      contentType ??
      (file.type !== "" ? file.type : "application/octet-stream");
    this.commitResponse("file", file, status, finalType);
  }

  /** Append or overwrite a single response header. */
  setHeader(key: string, value: string): void {
    this.headers.set(key, value);
    if (this._bus && this._bus.hasListeners("header:set")) {
      this._bus.emitSync(
        "header:set",
        this,
        { key, value },
        { source: "context" },
      );
    }
  }

  // ─── Bun Native Integrations ────────────────────────────

  /** Access the CookieMap from the incoming Bun request. */
  get cookies(): CookieMap {
    return this.req.cookies;
  }

  /**
   * Get the client IP and port from the Bun server.
   */
  get clientIP(): ReturnType<Server<any>["requestIP"]> | undefined {
    return this.server?.requestIP(this.req);
  }

  /**
   * Override the global idle timeout for this specific request.
   * Useful for long-lived streams like Server-Sent Events.
   * @param seconds Timeout in seconds, 0 to disable.
   */
  setTimeout(seconds: number): void {
    this.server?.timeout(this.req, seconds);
  }

  // WebSocket Methods

  /**
   * Get the number of pending WebSocket connections.
   */
  get pendingWebSockets(): number {
    return this.getServer().pendingWebSockets;
  }

  /**
   * Publish a message to a topic.
   */
  publishToTopic(
    topic: string,
    data: Parameters<Server<any>["publish"]>[1],
    compress?: boolean,
  ): number {
    return this.getServer().publish(topic, data, compress);
  }

  /**
   * Get the data associated with this WebSocket.
   */
  wsData<T>(): T | undefined {
    return this._sockets.wsData<T>();
  }

  /**
   * Get the path of this WebSocket.
   */
  get path(): string {
    return this._sockets.path;
  }

  /**
   * Get the remote address of this WebSocket.
   */
  get remoteAddress(): string {
    return this._sockets.remoteAddress;
  }

  /**
   * Get the ready state of this WebSocket.
   */
  get readyState(): number {
    return this._sockets.readyState;
  }

  /**
   * Get the subscriptions of this WebSocket.
   */
  get subscriptions(): string[] {
    return this._sockets.subscriptions;
  }

  /**
   * Send a message to this WebSocket.
   */
  send(message: string | ArrayBuffer | Uint8Array, compress?: boolean): number {
    return this._sockets.send(message, compress);
  }

  /**
   * Close this WebSocket.
   */
  close(code?: number, reason?: string): void {
    this._sockets.close(code, reason);
  }

  /**
   * Subscribe to a topic [webSocket].
   */
  subscribe(topic: string): void {
    this._sockets.subscribe(topic);
  }

  /**
   * Unsubscribe from a topic [webSocket].
   */
  unsubscribe(topic: string): void {
    this._sockets.unsubscribe(topic);
  }

  /**
   * Publish a message to a topic [webSocket].
   */
  publish(
    topic: string,
    message: string | ArrayBuffer | Uint8Array,
    compress?: boolean,
  ): number {
    return this._sockets.publish(topic, message, compress);
  }

  /**
   * Check if this WebSocket is subscribed to a topic [webSocket].
   */
  isSubscribed(topic: string): boolean {
    return this._sockets.isSubscribed(topic);
  }

  /**
   * Cork this WebSocket.
   */
  cork(cb: (ctx: Context) => void): void {
    this._sockets.cork(cb);
  }

  // TCP Socket Methods

  /**
   * Get the data associated with this TCP socket.
   */
  tcpData<T>(): T | undefined {
    return this._sockets.tcpData<T>();
  }

  /**
   * Get the name of this TCP socket.
   */
  get tcpName(): string {
    return this._sockets.tcpName;
  }

  /**
   * Get the remote address of this TCP socket.
   */
  get tcpRemoteAddress(): string {
    return this._sockets.tcpRemoteAddress;
  }

  /**
   * Get the local address of this TCP socket.
   */
  get tcpLocalAddress(): string {
    return this._sockets.tcpLocalAddress;
  }

  /**
   * Write data to this TCP socket.
   */
  write(
    data: Parameters<Socket<TCPData>["write"]>[0],
    byteOffset?: number,
    byteLength?: number,
  ): number {
    return this._sockets.write(data, byteOffset, byteLength);
  }

  /**
   * End this TCP socket.
   */
  end(
    data?: Parameters<Socket<TCPData>["write"]>[0],
    byteOffset?: number,
    byteLength?: number,
  ): number {
    return this._sockets.end(data, byteOffset, byteLength);
  }

  /**
   * Flush this TCP socket.
   */
  flush(): void {
    this._sockets.flush();
  }

  /**
   * Set the timeout for this TCP socket.
   */
  timeout(seconds: number): void {
    this._sockets.timeout(seconds);
  }

  // UDP Socket Methods

  /**
   * Get the data associated with this UDP socket.
   */
  udpData<T>(): T | undefined {
    return this._sockets.udpData<T>();
  }

  /**
   * Get the name of this UDP socket.
   */
  get udpName(): string {
    return this._sockets.udpName;
  }

  /**
   * Get the address of this UDP socket.
   */
  get udpAddress(): import("bun").SocketAddress {
    return this._sockets.udpAddress;
  }

  /**
   * Check if this UDP socket is closed.
   */
  get udpClosed(): boolean {
    return this._sockets.udpClosed;
  }

  /**
   * Send data to a UDP socket.
   */
  sendUDP(
    data: Parameters<SinwanUDPSocket<unknown>["send"]>[0],
    port?: number,
    address?: string,
  ): boolean {
    return this._sockets.sendUDP(data, port, address);
  }

  /**
   * Send multiple packets to a UDP socket.
   */
  sendManyUDP(
    packets: Parameters<SinwanUDPSocket<unknown>["sendMany"]>[0],
  ): number {
    return this._sockets.sendManyUDP(packets);
  }

  /**
   * Add a multicast membership to this UDP socket.
   */
  addMembershipUDP(
    multicastAddress: string,
    interfaceAddress?: string,
  ): boolean {
    return this._sockets.addMembershipUDP(multicastAddress, interfaceAddress);
  }

  /**
   * Drop a multicast membership from this UDP socket.
   */
  dropMembershipUDP(
    multicastAddress: string,
    interfaceAddress?: string,
  ): boolean {
    return this._sockets.dropMembershipUDP(multicastAddress, interfaceAddress);
  }

  // ─── Private Internal Methods ───────────────────────────

  /**
   * Commits the response state. Sets body, status, headers, marks as responded,
   * and stops step execution so the pipeline halts after the current step.
   * Centralized to ensure consistent event emission and state management.
   */
  private commitResponse<T = any>(
    kind: ResponseKind,
    body: T,
    status?: number,
    contentType?: string,
  ): void {
    this.body = body;
    this.statusCode = status ?? this.statusCode;

    if (contentType) {
      this.headers.set("Content-Type", contentType);
    }

    this._status |= Context.RESPONDED;
    this.stop();

    // Hot-path: only build payload and emit when someone is listening
    if (this._bus && this._bus.hasListeners("response:set")) {
      const finalContentType =
        contentType ?? this.headers.get("Content-Type") ?? "unknown";
      this._bus.emitSync(
        "response:set",
        this,
        {
          kind,
          statusCode: this.statusCode,
          contentType: finalContentType,
        },
        { source: "context" },
      );
    }
  }

  // ─── Utilities ──────────────────────────────────────────

  /**
   * Safely read and parse the request body based on Content-Type.
   * Caches the result so it can be called multiple times.
   *
   * Security: Enforces maxBodySize limits to prevent OOM attacks.
   * For unknown content types, uses streaming-safe approach.
   *
   * For multipart/form-data and application/x-www-form-urlencoded the result
   * is a `Record<string, string | File>` — File entries are preserved as-is
   * so callers can inspect them or pass them to saveFile().
   */
  async parseBody<T = unknown>(): Promise<T> {
    if (this._parsedBody !== undefined) return this._parsedBody as T;

    const contentType = this.req.headers.get("content-type") || "";
    const contentLengthStr = this.req.headers.get("content-length");
    const contentLength = contentLengthStr
      ? parseInt(contentLengthStr, 10)
      : -1;

    if (contentLength > this.maxBodySize) {
      throw new HttpError(
        `Payload too large (limit: ${this.maxBodySize} bytes)`,
        413,
      );
    }

    let kind: "json" | "form" | "text" = "text";

    try {
      if (contentType.includes("application/json")) {
        kind = "json";
        // Use Bun's built-in size enforcement via arrayBuffer
        this._parsedBody = await this.safeJson();
      } else if (
        contentType.includes("application/x-www-form-urlencoded") ||
        contentType.includes("multipart/form-data")
      ) {
        kind = "form";
        // Delegate to formData() so the cache is shared between both methods.
        const fd = await this.formData();
        const obj: Record<string, string | File> = {};
        for (const [k, v] of fd.entries()) {
          obj[k] = v as string | File;
        }
        this._parsedBody = obj;
      } else {
        kind = "text";
        // Safe text fallback with size limit
        this._parsedBody = await this.safeText();
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      const error = new HttpError("Failed to parse request body", 400);
      this.emitSyncIfAvailable("body:parse:error", { error });
      throw error;
    }

    this.emitSyncIfAvailable("body:parsed", { kind });
    return this._parsedBody as T;
  }

  /**
   * Safe JSON parsing with size enforcement.
   * Uses Bun's native streaming JSON parser when available.
   */
  private async safeJson(): Promise<unknown> {
    // Bun's req.json() already handles streaming efficiently
    // We just need to enforce size limits for responses without content-length
    const contentLength = this.req.headers.get("content-length");
    if (!contentLength) {
      // No content-length header - read as text first to enforce limit
      const text = await this.safeText();
      return JSON.parse(text as string);
    }
    return this.req.json();
  }

  /**
   * Safe text reading with streaming size enforcement.
   * Prevents OOM by limiting total bytes read.
   */
  private async safeText(): Promise<string> {
    const contentLength = this.req.headers.get("content-length");
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (size > this.maxBodySize) {
        throw new HttpError(
          `Payload too large (limit: ${this.maxBodySize} bytes)`,
          413,
        );
      }
      return this.req.text();
    }

    // No content-length - stream with limit enforcement
    // Bun's req.text() is already streaming, but we need to check size after
    const text = await this.req.text();
    if (text.length > this.maxBodySize) {
      throw new HttpError(
        `Payload too large (limit: ${this.maxBodySize} bytes)`,
        413,
      );
    }
    return text;
  }

  /**
   * Return the raw `FormData` from the request body, caching it so the
   * underlying stream is consumed only once.
   *
   * Security: Enforces maxBodySize limits to prevent OOM from large uploads.
   *
   * Throws an HttpError(415) if the Content-Type is not a form type, and
   * an HttpError(400) if the body cannot be parsed.
   * Throws an HttpError(413) if the body exceeds maxBodySize.
   *
   * Usage:
   * ```ts
   * const fd = await ctx.formData();
   * const name = fd.get("name") as string;
   * const avatar = fd.get("avatar") as File;
   * ```
   */
  async formData(): Promise<FormData> {
    if (this._formData) return this._formData;

    const contentType = this.req.headers.get("content-type") || "";
    const contentLengthStr = this.req.headers.get("content-length");
    const contentLength = contentLengthStr
      ? parseInt(contentLengthStr, 10)
      : -1;

    if (contentLength > this.maxBodySize) {
      throw new HttpError(
        `Payload too large (limit: ${this.maxBodySize} bytes)`,
        413,
      );
    }

    if (contentLength === 0) {
      throw new HttpError("Request body is empty", 400);
    }

    const isForm =
      contentType.includes("multipart/form-data") ||
      contentType.includes("application/x-www-form-urlencoded");

    if (!isForm) {
      throw new HttpError(
        `Expected a form Content-Type, got: ${contentType || "(none)"}`,
        415,
      );
    }

    try {
      // Bun's formData() is streaming-safe for multipart
      // It handles large files without loading everything into memory
      this._formData = (await this.req.formData()) as any;

      // Enforce size limit for responses without content-length
      // Check total size of all file entries
      if (contentLength === -1 && this._formData) {
        let totalSize = 0;
        for (const [_, value] of this._formData.entries()) {
          const entry = value as unknown;
          // Check if value is a File-like object (has size property)
          if (
            entry != null &&
            typeof entry === "object" &&
            "size" in entry &&
            typeof (entry as any).size === "number"
          ) {
            totalSize += (entry as any).size;
            if (totalSize > this.maxBodySize) {
              this._formData = undefined;
              throw new HttpError(
                `Payload too large (limit: ${this.maxBodySize} bytes)`,
                413,
              );
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;

      // Fallback: reconstruct from blob (for edge cases)
      try {
        const blob = await this.req.blob();
        if (blob.size > this.maxBodySize) {
          throw new HttpError(
            `Payload too large (limit: ${this.maxBodySize} bytes)`,
            413,
          );
        }
        const response = new Response(blob, {
          headers: { "Content-Type": contentType },
        });
        this._formData = (await response.formData()) as any;
      } catch (fallbackErr) {
        if (fallbackErr instanceof HttpError) throw fallbackErr;
        const error = new HttpError(
          "Failed to parse multipart/form-data body",
          400,
        );
        this.emitSyncIfAvailable("body:parse:error", { error });
        throw error;
      }
    }

    this.emitSyncIfAvailable("body:parsed", { kind: "form" });
    return this._formData!;
  }

  /**
   * Extract a file field from the multipart form and write it to disk using
   * Bun.write() (zero-copy where possible).
   *
   * @param field   The FormData field name that contains the uploaded file.
   * @param dest    Destination path on disk.
   * @param options Validation options (size, type).
   * @returns       The number of bytes written.
   *
   * Throws:
   *   - HttpError(400) if the field is missing or is not a File.
   *   - HttpError(413) if the file exceeds maxSize.
   *   - HttpError(415) if the file type is not allowed.
   *
   * Usage:
   * ```ts
   * // In a route handler:
   * const bytes = await ctx.saveFile("avatar", "./uploads/me.png", {
   *   maxSize: 5 * 1024 * 1024, // 5MB
   *   allowedTypes: ['image/png', 'image/jpeg']
   * });
   * ```
   */
  async saveFile(
    field: string,
    dest: string,
    options: SaveFileOptions = {},
  ): Promise<number> {
    const fd = await this.formData();
    const entry = fd.get(field);

    if (!entry) {
      throw new HttpError(
        `Form field "${field}" is missing from the request.`,
        400,
      );
    }

    if (typeof entry === "string") {
      throw new HttpError(
        `Form field "${field}" is a plain string, expected a file upload.`,
        400,
      );
    }

    // Validation: File Size
    if (options.maxSize && entry.size > options.maxSize) {
      throw new HttpError(
        `File too large: ${entry.size} bytes (max: ${options.maxSize})`,
        413,
      );
    }

    // Validation: File Type (MIME)
    if (options.allowedTypes && !options.allowedTypes.includes(entry.type)) {
      throw new HttpError(
        `Invalid file type: ${entry.type}. Allowed: ${options.allowedTypes.join(", ")}`,
        415,
      );
    }

    // entry is a File (subtype of Blob). Bun.write() accepts Blob natively.
    const bytesWritten = await Bun.write(dest, entry);

    this.emitSyncIfAvailable("file:saved", {
      field,
      dest,
      size: bytesWritten,
      name: (entry as File).name,
      type: entry.type,
    });

    return bytesWritten;
  }

  /**
   * Save multiple file fields from the multipart form in one call.
   *
   * @param uploads  Array of `{ field, dest }` pairs.
   * @returns        A map of field name → bytes written.
   *
   * Usage:
   * ```ts
   * const results = await ctx.saveFiles([
   *   { field: "avatar",  dest: "./uploads/avatar.png"  },
   *   { field: "resume",  dest: "./uploads/resume.pdf"  },
   * ]);
   * ctx.json(Object.fromEntries(results));
   * ```
   */
  async saveFiles(
    uploads: Array<{ field: string; dest: string }>,
  ): Promise<Map<string, number>> {
    const results = new Map<string, number>();
    // Run all writes concurrently — each saveFile() call reuses the cached FormData.
    await Promise.all(
      uploads.map(async ({ field, dest }) => {
        const bytes = await this.saveFile(field, dest);
        results.set(field, bytes);
      }),
    );
    return results;
  }

  // ─── Flow Control ───────────────────────────────────────

  /** Signal that step execution should halt after the current step. */
  stop(): void {
    this._status |= Context.STOPPED;
    if (this._bus && this._bus.hasListeners("context:stop")) {
      this._bus.emitSync("context:stop", this, undefined, {
        source: "context",
      });
    }
  }

  /** Whether stop() has been called. */
  isStopped(): boolean {
    return (this._status & Context.STOPPED) !== 0;
  }

  /** Whether json() or text() has been called. */
  hasResponded(): boolean {
    return (this._status & Context.RESPONDED) !== 0;
  }

  /** Whether the context has an active streaming response. */
  isStreaming(): boolean {
    return (this._status & Context.STREAMING) !== 0;
  }

  // ─── EventBus Interaction ──────────────────────────────

  /** Attach an EventBus to this context. */
  attachBus(bus: EventBus): void {
    if (this._bus && this._bus !== bus) {
      throw new Error("Context is already attached to a different EventBus.");
    }
    this._bus = bus;
  }

  /** Emit an event through the attached EventBus. */
  async emitAsync(
    event: string,
    payload?: unknown,
    options?: EmitOptions,
  ): Promise<EmitResult> {
    return this.getBus().emitAsync(
      event,
      this,
      payload,
      this.withSource(options),
    );
  }

  /** Emit an event synchronously through the attached EventBus. */
  emitSync(
    event: string,
    payload?: unknown,
    options?: EmitOptions,
  ): EmitResult {
    return this.getBus().emitSync(
      event,
      this,
      payload,
      this.withSource(options),
    );
  }

  /**
   * Register a listener scoped to this context.
   */
  on(event: string, handler: EventHandler, options?: ListenerOptions): this {
    const bus = this.getBus();
    const wrapped = this.wrapScopedHandler(event, handler, false);
    bus.on(event, wrapped, options);
    this.trackHandler(event, handler, wrapped);
    return this;
  }

  /** Register a once-only listener scoped to this context. */
  once(event: string, handler: EventHandler, options?: ListenerOptions): this {
    const bus = this.getBus();
    const wrapped = this.wrapScopedHandler(event, handler, true);
    bus.once(event, wrapped, options);
    this.trackHandler(event, handler, wrapped);
    return this;
  }

  /**
   * Remove a scoped listener.
   * Removes the most-recently-added wrapped handler for this original handler.
   */
  off(event: string, handler: EventHandler): this {
    const bus = this.getBus();
    const wrapped = this.getTrackedHandler(event, handler);
    if (wrapped) {
      bus.off(event, wrapped);
      this.untrackHandler(event, handler, wrapped);
    }
    return this;
  }

  /** Register a callback to be executed when the context is disposed. */
  onDispose(cb: () => void): void {
    if ((this._status & Context.DISPOSED) !== 0) {
      cb();
      return;
    }
    this._onDisposeCallbacks.push(cb);
  }

  /** Dispose context-scoped listeners and trigger cleanup callbacks. */
  dispose(): void {
    if ((this._status & Context.DISPOSED) !== 0) return;
    this._status |= Context.DISPOSED;

    // Clear streaming flag to allow pool reuse
    this._status &= ~Context.STREAMING;

    if (this._bus && this._bus.hasListeners("context:dispose")) {
      this._bus.emitSync("context:dispose", this, undefined, {
        source: "context",
      });
    }

    // Only iterate scoped handlers if any were registered
    if (this._bus && this.scopedHandlers.size > 0) {
      for (const [event, handlerMap] of this.scopedHandlers.entries()) {
        for (const wrappedSet of handlerMap.values()) {
          for (const wrapped of wrappedSet) {
            this._bus.off(event, wrapped);
          }
        }
      }
      this.scopedHandlers.clear();
    }

    // Trigger onDispose callbacks
    for (let i = 0; i < this._onDisposeCallbacks.length; i++) {
      try {
        this._onDisposeCallbacks[i]!();
      } catch {
        // Ignore callback errors
      }
    }
    this._onDisposeCallbacks.length = 0;
  }

  /** Access a copy of the event trace for this context. */
  getEventTrace(): readonly EventTraceEntry[] {
    return this.eventTrace;
  }

  /** Record an event trace entry (used by EventBus). */
  recordEvent(meta: EventMeta, payload: unknown): void {
    if (!this.traceOptions.enabled) return;

    const maxEntries = this.traceOptions.maxEntries;
    if (maxEntries <= 0) return;

    const entry: EventTraceEntry = {
      name: meta.name,
      event: meta.event,
      timestamp: meta.timestamp,
      sequence: meta.sequence,
      requestId: meta.requestId,
      source: meta.source,
    };

    if (this.traceOptions.includePayload) {
      entry.payload = payload;
    }

    const buffer = this.getTraceBuffer();
    if (buffer.length < maxEntries) {
      buffer.push(entry);
      this._traceSize = buffer.length;
      return;
    }

    // Ring buffer overwrite to avoid per-request trimming.
    buffer[this._traceStart] = entry;
    this._traceStart = (this._traceStart + 1) % maxEntries;
    this._traceSize = maxEntries;
  }

  private getTraceBuffer(): EventTraceEntry[] {
    if (!this._eventTrace) this._eventTrace = [];
    return this._eventTrace;
  }

  // ─── Guards ─────────────────────────────────────────────

  /** Throws if a response body has already been committed. */
  private guardDoubleResponse(): void {
    if ((this._status & Context.RESPONDED) !== 0) {
      throw new Error("Response already sent. Cannot set body more than once.");
    }
  }

  private getBus(): EventBus {
    if (!this._bus) {
      throw new Error("Context is not attached to an EventBus.");
    }
    return this._bus;
  }

  private getServer(): Server<any> {
    if (!this.server) {
      throw new Error("Context is not attached to a Server.");
    }
    return this.server;
  }

  private withSource(options?: EmitOptions): EmitOptions {
    return {
      ...options,
      source: options?.source ?? "context",
    };
  }

  private emitSyncIfAvailable(event: string, payload?: unknown): void {
    if (!this._bus) return;
    this._bus.emitSync(event, this, payload, { source: "context" });
  }

  private wrapScopedHandler(
    event: string,
    handler: EventHandler,
    isOnce: boolean,
  ): EventHandler {
    // Capture `wrapped` via a closure reference so the once-cleanup can
    // untrack this specific wrapped instance (not just any wrapped for handler).
    let wrapped: EventHandler;
    wrapped = (ctx, payload, meta) => {
      if (ctx !== this) return;
      if (isOnce) {
        this.untrackHandler(event, handler, wrapped);
      }
      return handler(ctx, payload, meta);
    };
    return wrapped;
  }

  // Map stores Set<EventHandler> so multiple registrations of the
  // same original handler each get their own tracked wrapped handler entry.
  private trackHandler(
    event: string,
    handler: EventHandler,
    wrapped: EventHandler,
  ): void {
    let handlerMap = this.scopedHandlers.get(event);
    if (!handlerMap) {
      handlerMap = new Map();
      this.scopedHandlers.set(event, handlerMap);
    }
    let wrappedSet = handlerMap.get(handler);
    if (!wrappedSet) {
      wrappedSet = new Set();
      handlerMap.set(handler, wrappedSet);
    }
    wrappedSet.add(wrapped);
  }

  /**
   * Returns the most recently tracked wrapped handler for the given original,
   * or undefined if none exists.
   */
  private getTrackedHandler(
    event: string,
    handler: EventHandler,
  ): EventHandler | undefined {
    const handlerMap = this.scopedHandlers.get(event);
    const wrappedSet = handlerMap?.get(handler);
    if (!wrappedSet || wrappedSet.size === 0) return undefined;
    // Return the last item in the Set (insertion order).
    let last: EventHandler | undefined;
    for (const w of wrappedSet) last = w;
    return last;
  }

  /**
   * Remove a specific wrapped handler from tracking.
   * Cleans up empty Sets and Maps to avoid memory leaks.
   */
  private untrackHandler(
    event: string,
    handler: EventHandler,
    wrapped: EventHandler,
  ): void {
    const handlerMap = this.scopedHandlers.get(event);
    if (!handlerMap) return;
    const wrappedSet = handlerMap.get(handler);
    if (!wrappedSet) return;
    wrappedSet.delete(wrapped);
    if (wrappedSet.size === 0) {
      handlerMap.delete(handler);
    }
    if (handlerMap.size === 0) {
      this.scopedHandlers.delete(event);
    }
  }

  /**
   * Wrap an iterator with automatic disposal when iteration completes.
   * This ensures the context is properly cleaned up after streaming.
   */
  private wrapIteratorWithDisposal(
    iterator: AsyncIterable<any> | (() => AsyncGenerator<any>),
  ): AsyncIterable<any> {
    const self = this;

    // Handle generator function
    const source = typeof iterator === "function" ? iterator() : iterator;

    return {
      [Symbol.asyncIterator](): AsyncGenerator<any, void, unknown> {
        const originalIterator = source[Symbol.asyncIterator]();
        let done = false;

        const cleanup = () => {
          if (!done) {
            done = true;
            // Schedule disposal on next microtask to allow response to complete
            queueMicrotask(() => self.dispose());
          }
        };

        return {
          async next() {
            try {
              const result = await originalIterator.next();
              if (result.done) {
                cleanup();
              }
              return result;
            } catch (error) {
              cleanup();
              throw error;
            }
          },
          async return(value) {
            cleanup();
            if (originalIterator.return) {
              return originalIterator.return(value);
            }
            return { done: true, value } as IteratorResult<any, void>;
          },
          async throw(error) {
            cleanup();
            if (originalIterator.throw) {
              return originalIterator.throw(error);
            }
            throw error;
          },
        } as AsyncGenerator<any, void, unknown>;
      },
    };
  }

  /**
   * Wrap a ReadableStream with automatic disposal when the stream closes
   * or is cancelled. Replaces the previous TransformStream passthrough.
   */
  private wrapStreamWithDisposal(stream: ReadableStream): ReadableStream {
    const self = this;
    const reader = stream.getReader();
    let pump: (() => void) | null = null;

    return new ReadableStream({
      start(controller) {
        pump = () => {
          reader.read().then(
            ({ done, value }) => {
              if (done) {
                controller.close();
                queueMicrotask(() => self.dispose());
                return;
              }
              controller.enqueue(value);
              if (
                controller.desiredSize !== null &&
                controller.desiredSize <= 0
              ) {
                // Consumer applying backpressure — wait for pull()
                return;
              }
              if (pump) pump();
            },
            (err) => {
              controller.error(err);
              queueMicrotask(() => self.dispose());
            },
          );
        };
        if (pump) pump();
      },
      pull() {
        if (pump) pump();
      },
      cancel() {
        reader.cancel().catch(() => {});
        queueMicrotask(() => self.dispose());
      },
    });
  }
}
