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
 */
export class Context {
  /** The incoming Bun/Web API Request. */
  public readonly req: Request;

  /** HTTP status code for the response. */
  public statusCode: number = 200;

  /** Response body — set via json() or text(). */
  public body: unknown = null;

  /** Response headers. */
  public readonly headers: Headers = new Headers();

  /** Arbitrary per-request state for steps/plugins. */
  public readonly state: Map<string, unknown> = new Map();

  /** URL parameters populated by the router (e.g. /users/:id -> params.id) */
  public params: Record<string, string> = {};

  // ─── Internal Flags ─────────────────────────────────────

  private _stopped: boolean = false;
  private _responded: boolean = false;
  private _parsedBody: unknown = undefined;
  private readonly services: Map<string, unknown>;

  constructor(req: Request, services: Map<string, unknown> = new Map()) {
    this.req = req;
    this.services = services;
  }

  // ─── Response Methods ───────────────────────────────────

  /**
   * Set a JSON response body.
   * Throws if a response has already been set.
   */
  json(data: unknown, status?: number): void {
    this.guardDoubleResponse();
    this.body = data;
    this.statusCode = status ?? this.statusCode;
    this.headers.set("Content-Type", "application/json");
    this._responded = true;
  }

  /**
   * Set a plain-text response body.
   * Throws if a response has already been set.
   */
  text(data: string, status?: number): void {
    this.guardDoubleResponse();
    this.body = data;
    this.statusCode = status ?? this.statusCode;
    this.headers.set("Content-Type", "text/plain");
    this._responded = true;
  }

  /** Set a streaming response body. */
  stream(readable: ReadableStream, status?: number, contentType: string = "application/octet-stream"): void {
    this.guardDoubleResponse();
    this.body = readable;
    this.statusCode = status ?? this.statusCode;
    this.headers.set("Content-Type", contentType);
    this._responded = true;
  }

  /** Set a binary buffer response body. */
  buffer(data: Uint8Array | ArrayBuffer, status?: number, contentType: string = "application/octet-stream"): void {
    this.guardDoubleResponse();
    this.body = data;
    this.statusCode = status ?? this.statusCode;
    this.headers.set("Content-Type", contentType);
    this._responded = true;
  }

  /** Append or overwrite a single response header. */
  setHeader(key: string, value: string): void {
    this.headers.set(key, value);
  }

  // ─── State Helpers ──────────────────────────────────────

  /** Get a value from the request state. */
  get<T>(key: string): T | undefined {
    return this.state.get(key) as T | undefined;
  }

  /** Set a value in the request state. */
  set(key: string, value: unknown): void {
    this.state.set(key, value);
  }

  /** Get an app-wide service injected by DI. */
  service<T>(name: string): T {
    const s = this.services.get(name);
    if (!s) throw new Error(`Service "${name}" not found in DI container.`);
    return s as T;
  }

  // ─── Utilities ──────────────────────────────────────────

  /**
   * Safely read and parse the request body based on Content-Type.
   * Caches the result so it can be called multiple times.
   */
  async parseBody<T = unknown>(): Promise<T> {
    if (this._parsedBody !== undefined) return this._parsedBody as T;

    const contentType = this.req.headers.get("content-type") || "";

    try {
      if (contentType.includes("application/json")) {
        this._parsedBody = await this.req.clone().json();
      } else if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
        // We clone to allow multiple readers
        const fd = await this.req.clone().formData();
        const obj: Record<string, unknown> = {};
        for (const [k, v] of fd.entries()) {
          obj[k] = v;
        }
        this._parsedBody = obj;
      } else {
        this._parsedBody = await this.req.clone().text();
      }
    } catch (err) {
      throw Object.assign(new Error("Failed to parse request body"), { statusCode: 400 });
    }

    return this._parsedBody as T;
  }

  // ─── Flow Control ───────────────────────────────────────

  /** Signal that step execution should halt after the current step. */
  stop(): void {
    this._stopped = true;
  }

  /** Whether stop() has been called. */
  isStopped(): boolean {
    return this._stopped;
  }

  /** Whether json() or text() has been called. */
  hasResponded(): boolean {
    return this._responded;
  }

  // ─── Guards ─────────────────────────────────────────────

  /** Throws if a response body has already been committed. */
  private guardDoubleResponse(): void {
    if (this._responded) {
      throw new Error(
        "Response already sent. Cannot set body more than once.",
      );
    }
  }
}
