import type { HttpContext } from "../http-context";

/**
 * Convenience methods for committing common HTTP status-code responses.
 *
 * Each helper calls {@link HttpContext.json} with the appropriate status:
 * - **1xx–2xx** informational/success responses use `{ message: ... }`.
 * - **3xx** redirection responses use `{ message: ... }`.
 * - **4xx–5xx** client/server error responses use `{ error: ... }`.
 *
 * The helpers are also copied onto every {@link HttpContext} instance, so calling
 * `ctx.ok()` is equivalent to calling `ctx.httpRespond.ok()`.
 */
export interface HttpRespondApi {
  /**
   * Respond with a 100 Continue status.
   *
   * **This is NOT flow control.** It sets an HTTP `100 Continue` informational
   * response on the context (which halts the chain). If you are looking for a
   * "call next middleware" function, Sinwan does not have one — the engine
   * advances the chain automatically after each handler returns.
   *
   * @param message Optional custom message.
   */
  continue(message?: string): void;

  /** Respond with a 101 Switching Protocols status. */
  switchingProtocols(message?: string): void;

  /** Respond with a 102 Processing status. */
  processing(message?: string): void;

  /** Respond with a 103 Early Hints status. */
  earlyHints(message?: string): void;

  /** Respond with a 200 OK status. */
  ok(message?: string): void;

  /** Respond with a 201 Created status. */
  created(message?: string): void;

  /** Respond with a 202 Accepted status. */
  accepted(message?: string): void;

  /** Respond with a 203 Non-Authoritative Information status. */
  nonAuthoritativeInformation(message?: string): void;

  /** Respond with a 204 No Content status. */
  noContent(message?: string): void;

  /** Respond with a 205 Reset Content status. */
  resetContent(message?: string): void;

  /** Respond with a 206 Partial Content status. */
  partialContent(message?: string): void;

  /** Respond with a 207 Multi-Status status. */
  multiStatus(message?: string): void;

  /** Respond with a 208 Already Reported status. */
  alreadyReported(message?: string): void;

  /** Respond with a 226 IM Used status. */
  imUsed(message?: string): void;

  /** Respond with a 300 Multiple Choices status. */
  multipleChoices(message?: string): void;

  /** Respond with a 301 Moved Permanently status. */
  movedPermanently(message?: string): void;

  /** Respond with a 302 Found status. */
  found(message?: string): void;

  /** Respond with a 303 See Other status. */
  seeOther(message?: string): void;

  /** Respond with a 304 Not Modified status. */
  notModified(message?: string): void;

  /** Respond with a 305 Use Proxy status. */
  useProxy(message?: string): void;

  /** Respond with a 307 Temporary Redirect status. */
  temporaryRedirect(message?: string): void;

  /** Respond with a 308 Permanent Redirect status. */
  permanentRedirect(message?: string): void;

  /** Respond with a 400 Bad Request JSON error. */
  badRequest(message?: string): void;

  /** Respond with a 401 Unauthorized JSON error. */
  unauthorized(message?: string): void;

  /** Respond with a 402 Payment Required JSON error. */
  paymentRequired(message?: string): void;

  /** Respond with a 403 Forbidden JSON error. */
  forbidden(message?: string): void;

  /** Respond with a 404 Not Found JSON error. */
  notFound(message?: string): void;

  /** Respond with a 405 Method Not Allowed JSON error. */
  methodNotAllowed(message?: string): void;

  /** Respond with a 406 Not Acceptable JSON error. */
  notAcceptable(message?: string): void;

  /** Respond with a 407 Proxy Authentication Required JSON error. */
  proxyAuthenticationRequired(message?: string): void;

  /** Respond with a 408 Request Timeout JSON error. */
  requestTimeout(message?: string): void;

  /** Respond with a 409 Conflict JSON error. */
  conflict(message?: string): void;

  /** Respond with a 410 Gone JSON error. */
  gone(message?: string): void;

  /** Respond with a 411 Length Required JSON error. */
  lengthRequired(message?: string): void;

  /** Respond with a 412 Precondition Failed JSON error. */
  preconditionFailed(message?: string): void;

  /** Respond with a 413 Payload Too Large JSON error. */
  payloadTooLarge(message?: string): void;

  /** Respond with a 414 URI Too Long JSON error. */
  uriTooLong(message?: string): void;

  /** Respond with a 415 Unsupported Media Type JSON error. */
  unsupportedMediaType(message?: string): void;

  /** Respond with a 416 Range Not Satisfiable JSON error. */
  rangeNotSatisfiable(message?: string): void;

  /** Respond with a 417 Expectation Failed JSON error. */
  expectationFailed(message?: string): void;

  /** Respond with a 418 I'm a teapot JSON error. */
  imATeapot(message?: string): void;

  /** Respond with a 421 Misdirected Request JSON error. */
  misdirectedRequest(message?: string): void;

  /** Respond with a 422 Unprocessable Entity JSON error. */
  unprocessableEntity(message?: string): void;

  /** Respond with a 423 Locked JSON error. */
  locked(message?: string): void;

  /** Respond with a 424 Failed Dependency JSON error. */
  failedDependency(message?: string): void;

  /** Respond with a 425 Too Early JSON error. */
  tooEarly(message?: string): void;

  /** Respond with a 426 Upgrade Required JSON error. */
  upgradeRequired(message?: string): void;

  /** Respond with a 428 Precondition Required JSON error. */
  preconditionRequired(message?: string): void;

  /** Respond with a 429 Too Many Requests JSON error. */
  tooManyRequests(message?: string): void;

  /** Respond with a 431 Request Header Fields Too Large JSON error. */
  requestHeaderFieldsTooLarge(message?: string): void;

  /** Respond with a 451 Unavailable For Legal Reasons JSON error. */
  unavailableForLegalReasons(message?: string): void;

  /** Respond with a 500 Internal Server Error JSON error. */
  internalServerError(message?: string): void;

  /** Respond with a 501 Not Implemented JSON error. */
  notImplemented(message?: string): void;

  /** Respond with a 502 Bad Gateway JSON error. */
  badGateway(message?: string): void;

  /** Respond with a 503 Service Unavailable JSON error. */
  serviceUnavailable(message?: string): void;

  /** Respond with a 504 Gateway Timeout JSON error. */
  gatewayTimeout(message?: string): void;
}

/**
 * Create an {@link HttpRespondApi} bound to a `HttpContext` instance.
 *
 * @param _this The context to respond through.
 * @returns The status-code helper API.
 */
export const httpRespond = (_this: HttpContext): HttpRespondApi => ({
  /**
   * Respond with a 100 Continue status.
   *
   * **This is NOT flow control.** It sets an HTTP `100 Continue` informational
   * response on the context (which halts the chain). If you are looking for a
   * "call next middleware" function, Sinwan does not have one — the engine
   * advances the chain automatically after each handler returns.
   *
   * @param message Optional custom message (default: "Continue").
   */
  continue(message: string = "Continue"): void {
    _this.json({ message }, 100);
  },

  /**
   * Respond with a 101 Switching Protocols status.
   * @param message Optional custom message (default: "Switching Protocols").
   */
  switchingProtocols(message: string = "Switching Protocols"): void {
    _this.json({ message }, 101);
  },

  /**
   * Respond with a 102 Processing status.
   * @param message Optional custom message (default: "Processing").
   */
  processing(message: string = "Processing"): void {
    _this.json({ message }, 102);
  },

  /**
   * Respond with a 103 Early Hints status.
   * @param message Optional custom message (default: "Early Hints").
   */
  earlyHints(message: string = "Early Hints"): void {
    _this.json({ message }, 103);
  },

  /**
   * Respond with a 200 OK status.
   * @param message Optional custom message (default: "OK").
   */
  ok(message: string = "OK"): void {
    _this.json({ message }, 200);
  },

  /**
   * Respond with a 201 Created status.
   * @param message Optional custom message (default: "Created").
   */
  created(message: string = "Created"): void {
    _this.json({ message }, 201);
  },

  /**
   * Respond with a 202 Accepted status.
   * @param message Optional custom message (default: "Accepted").
   */
  accepted(message: string = "Accepted"): void {
    _this.json({ message }, 202);
  },

  /**
   * Respond with a 203 Non-Authoritative Information status.
   * @param message Optional custom message (default: "Non-Authoritative Information").
   */
  nonAuthoritativeInformation(
    message: string = "Non-Authoritative Information",
  ): void {
    _this.json({ message }, 203);
  },

  /**
   * Respond with a 204 No Content status.
   * @param message Optional custom message (default: "No Content").
   */
  noContent(message: string = "No Content"): void {
    _this.json({ message }, 204);
  },

  /**
   * Respond with a 205 Reset Content status.
   * @param message Optional custom message (default: "Reset Content").
   */
  resetContent(message: string = "Reset Content"): void {
    _this.json({ message }, 205);
  },

  /**
   * Respond with a 206 Partial Content status.
   * @param message Optional custom message (default: "Partial Content").
   */
  partialContent(message: string = "Partial Content"): void {
    _this.json({ message }, 206);
  },

  /**
   * Respond with a 207 Multi-Status status.
   * @param message Optional custom message (default: "Multi-Status").
   */
  multiStatus(message: string = "Multi-Status"): void {
    _this.json({ message }, 207);
  },

  /**
   * Respond with a 208 Already Reported status.
   * @param message Optional custom message (default: "Already Reported").
   */
  alreadyReported(message: string = "Already Reported"): void {
    _this.json({ message }, 208);
  },

  /**
   * Respond with a 226 IM Used status.
   * @param message Optional custom message (default: "IM Used").
   */
  imUsed(message: string = "IM Used"): void {
    _this.json({ message }, 226);
  },

  /**
   * Respond with a 300 Multiple Choices status.
   * @param message Optional custom message (default: "Multiple Choices").
   */
  multipleChoices(message: string = "Multiple Choices"): void {
    _this.json({ message }, 300);
  },

  /**
   * Respond with a 301 Moved Permanently status.
   * @param message Optional custom message (default: "Moved Permanently").
   */
  movedPermanently(message: string = "Moved Permanently"): void {
    _this.json({ message }, 301);
  },

  /**
   * Respond with a 302 Found status.
   * @param message Optional custom message (default: "Found").
   */
  found(message: string = "Found"): void {
    _this.json({ message }, 302);
  },

  /**
   * Respond with a 303 See Other status.
   * @param message Optional custom message (default: "See Other").
   */
  seeOther(message: string = "See Other"): void {
    _this.json({ message }, 303);
  },

  /**
   * Respond with a 304 Not Modified status.
   * @param message Optional custom message (default: "Not Modified").
   */
  notModified(message: string = "Not Modified"): void {
    _this.json({ message }, 304);
  },

  /**
   * Respond with a 305 Use Proxy status.
   * @param message Optional custom message (default: "Use Proxy").
   */
  useProxy(message: string = "Use Proxy"): void {
    _this.json({ message }, 305);
  },

  /**
   * Respond with a 307 Temporary Redirect status.
   * @param message Optional custom message (default: "Temporary Redirect").
   */
  temporaryRedirect(message: string = "Temporary Redirect"): void {
    _this.json({ message }, 307);
  },

  /**
   * Respond with a 308 Permanent Redirect status.
   * @param message Optional custom message (default: "Permanent Redirect").
   */
  permanentRedirect(message: string = "Permanent Redirect"): void {
    _this.json({ message }, 308);
  },

  /**
   * Respond with a 400 Bad Request JSON error.
   * @param message Optional custom error message (default: "Bad Request").
   */
  badRequest(message: string = "Bad Request"): void {
    _this.json({ error: message }, 400);
  },

  /**
   * Respond with a 401 Unauthorized JSON error.
   * @param message Optional custom error message (default: "Unauthorized").
   */
  unauthorized(message: string = "Unauthorized"): void {
    _this.json({ error: message }, 401);
  },

  /**
   * Respond with a 402 Payment Required JSON error.
   * @param message Optional custom error message (default: "Payment Required").
   */
  paymentRequired(message: string = "Payment Required"): void {
    _this.json({ error: message }, 402);
  },

  /**
   * Respond with a 403 Forbidden JSON error.
   * @param message Optional custom error message (default: "Forbidden").
   */
  forbidden(message: string = "Forbidden"): void {
    _this.json({ error: message }, 403);
  },

  /**
   * Respond with a 404 Not Found JSON error.
   * @param message Optional custom error message (default: "Not Found").
   */
  notFound(message: string = "Not Found"): void {
    _this.json({ error: message }, 404);
  },

  /**
   * Respond with a 405 Method Not Allowed JSON error.
   * @param message Optional custom error message (default: "Method Not Allowed").
   */
  methodNotAllowed(message: string = "Method Not Allowed"): void {
    _this.json({ error: message }, 405);
  },

  /**
   * Respond with a 406 Not Acceptable JSON error.
   * @param message Optional custom error message (default: "Not Acceptable").
   */
  notAcceptable(message: string = "Not Acceptable"): void {
    _this.json({ error: message }, 406);
  },

  /**
   * Respond with a 407 Proxy Authentication Required JSON error.
   * @param message Optional custom error message (default: "Proxy Authentication Required").
   */
  proxyAuthenticationRequired(
    message: string = "Proxy Authentication Required",
  ): void {
    _this.json({ error: message }, 407);
  },

  /**
   * Respond with a 408 Request Timeout JSON error.
   * @param message Optional custom error message (default: "Request Timeout").
   */
  requestTimeout(message: string = "Request Timeout"): void {
    _this.json({ error: message }, 408);
  },

  /**
   * Respond with a 409 Conflict JSON error.
   * @param message Optional custom error message (default: "Conflict").
   */
  conflict(message: string = "Conflict"): void {
    _this.json({ error: message }, 409);
  },

  /**
   * Respond with a 410 Gone JSON error.
   * @param message Optional custom error message (default: "Gone").
   */
  gone(message: string = "Gone"): void {
    _this.json({ error: message }, 410);
  },

  /**
   * Respond with a 411 Length Required JSON error.
   * @param message Optional custom error message (default: "Length Required").
   */
  lengthRequired(message: string = "Length Required"): void {
    _this.json({ error: message }, 411);
  },

  /**
   * Respond with a 412 Precondition Failed JSON error.
   * @param message Optional custom error message (default: "Precondition Failed").
   */
  preconditionFailed(message: string = "Precondition Failed"): void {
    _this.json({ error: message }, 412);
  },

  /**
   * Respond with a 413 Payload Too Large JSON error.
   * @param message Optional custom error message (default: "Payload Too Large").
   */
  payloadTooLarge(message: string = "Payload Too Large"): void {
    _this.json({ error: message }, 413);
  },

  /**
   * Respond with a 414 URI Too Long JSON error.
   * @param message Optional custom error message (default: "URI Too Long").
   */
  uriTooLong(message: string = "URI Too Long"): void {
    _this.json({ error: message }, 414);
  },

  /**
   * Respond with a 415 Unsupported Media Type JSON error.
   * @param message Optional custom error message (default: "Unsupported Media Type").
   */
  unsupportedMediaType(message: string = "Unsupported Media Type"): void {
    _this.json({ error: message }, 415);
  },

  /**
   * Respond with a 416 Range Not Satisfiable JSON error.
   * @param message Optional custom error message (default: "Range Not Satisfiable").
   */
  rangeNotSatisfiable(message: string = "Range Not Satisfiable"): void {
    _this.json({ error: message }, 416);
  },

  /**
   * Respond with a 417 Expectation Failed JSON error.
   * @param message Optional custom error message (default: "Expectation Failed").
   */
  expectationFailed(message: string = "Expectation Failed"): void {
    _this.json({ error: message }, 417);
  },

  /**
   * Respond with a 418 I'm a teapot JSON error.
   * @param message Optional custom error message (default: "I'm a teapot").
   */
  imATeapot(message: string = "I'm a teapot"): void {
    _this.json({ error: message }, 418);
  },

  /**
   * Respond with a 421 Misdirected Request JSON error.
   * @param message Optional custom error message (default: "Misdirected Request").
   */
  misdirectedRequest(message: string = "Misdirected Request"): void {
    _this.json({ error: message }, 421);
  },

  /**
   * Respond with a 422 Unprocessable Entity JSON error.
   * @param message Optional custom error message (default: "Unprocessable Entity").
   */
  unprocessableEntity(message: string = "Unprocessable Entity"): void {
    _this.json({ error: message }, 422);
  },

  /**
   * Respond with a 423 Locked JSON error.
   * @param message Optional custom error message (default: "Locked").
   */
  locked(message: string = "Locked"): void {
    _this.json({ error: message }, 423);
  },

  /**
   * Respond with a 424 Failed Dependency JSON error.
   * @param message Optional custom error message (default: "Failed Dependency").
   */
  failedDependency(message: string = "Failed Dependency"): void {
    _this.json({ error: message }, 424);
  },

  /**
   * Respond with a 425 Too Early JSON error.
   * @param message Optional custom error message (default: "Too Early").
   */
  tooEarly(message: string = "Too Early"): void {
    _this.json({ error: message }, 425);
  },

  /**
   * Respond with a 426 Upgrade Required JSON error.
   * @param message Optional custom error message (default: "Upgrade Required").
   */
  upgradeRequired(message: string = "Upgrade Required"): void {
    _this.json({ error: message }, 426);
  },

  /**
   * Respond with a 428 Precondition Required JSON error.
   * @param message Optional custom error message (default: "Precondition Required").
   */
  preconditionRequired(message: string = "Precondition Required"): void {
    _this.json({ error: message }, 428);
  },

  /**
   * Respond with a 429 Too Many Requests JSON error.
   * @param message Optional custom error message (default: "Too Many Requests").
   */
  tooManyRequests(message: string = "Too Many Requests"): void {
    _this.json({ error: message }, 429);
  },

  /**
   * Respond with a 431 Request Header Fields Too Large JSON error.
   * @param message Optional custom error message (default: "Request Header Fields Too Large").
   */
  requestHeaderFieldsTooLarge(
    message: string = "Request Header Fields Too Large",
  ): void {
    _this.json({ error: message }, 431);
  },

  /**
   * Respond with a 451 Unavailable For Legal Reasons JSON error.
   * @param message Optional custom error message (default: "Unavailable For Legal Reasons").
   */
  unavailableForLegalReasons(
    message: string = "Unavailable For Legal Reasons",
  ): void {
    _this.json({ error: message }, 451);
  },

  /**
   * Respond with a 500 Internal Server Error JSON error.
   * @param message Optional custom error message (default: "Internal Server Error").
   */
  internalServerError(message: string = "Internal Server Error"): void {
    _this.json({ error: message }, 500);
  },

  /**
   * Respond with a 501 Not Implemented JSON error.
   * @param message Optional custom error message (default: "Not Implemented").
   */
  notImplemented(message: string = "Not Implemented"): void {
    _this.json({ error: message }, 501);
  },

  /**
   * Respond with a 502 Bad Gateway JSON error.
   * @param message Optional custom error message (default: "Bad Gateway").
   */
  badGateway(message: string = "Bad Gateway"): void {
    _this.json({ error: message }, 502);
  },

  /**
   * Respond with a 503 Service Unavailable JSON error.
   * @param message Optional custom error message (default: "Service Unavailable").
   */
  serviceUnavailable(message: string = "Service Unavailable"): void {
    _this.json({ error: message }, 503);
  },

  /**
   * Respond with a 504 Gateway Timeout JSON error.
   * @param message Optional custom error message (default: "Gateway Timeout").
   */
  gatewayTimeout(message: string = "Gateway Timeout"): void {
    _this.json({ error: message }, 504);
  },
});
