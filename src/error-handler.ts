/**
 * SinwanJS Core Runtime — ErrorHandler
 *
 * Centralized error normalization and response generation.
 * Converts any thrown value into a consistent error response.
 *
 * In production mode (NODE_ENV === "production"), stack traces
 * and internal details are stripped from responses.
 */

import type { Context } from "./context";
import type { ErrorPayload } from "./types";

/** Optional hook for external logging/telemetry integration. */
export type ErrorHook = (error: unknown, ctx: Context) => void | Promise<void>;

/** Response format type for error responses. */
export type ErrorResponseType = "json" | "html";

/** Callback to customize error response format. */
export type ErrorResponseFormatter = (
  payload: ErrorPayload,
  ctx: Context,
) => { body: string; type: ErrorResponseType };

/** Options for configuring the ErrorHandler */
export interface ErrorHandlerOptions {
  onError?: ErrorHook;
  /** Response type to use for error responses (default: "json"). */
  responseType?: ErrorResponseType;
  /** Optional callback to customize the error response format. */
  formatResponse?: ErrorResponseFormatter;
  /** Include stack traces in development mode (default: true). */
  includeStackInDev?: boolean;
}

const HTTP_STATUS_LABELS: Record<number, string> = {
  100: "Continue",
  101: "Switching Protocols",
  102: "Processing",
  103: "Early Hints",
  200: "OK",
  201: "Created",
  202: "Accepted",
  203: "Non-Authoritative Information",
  204: "No Content",
  205: "Reset Content",
  206: "Partial Content",
  207: "Multi-Status",
  208: "Already Reported",
  226: "IM Used",
  300: "Multiple Choices",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  305: "Use Proxy",
  306: "(Unused)",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  407: "Proxy Authentication Required",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Payload Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Expectation Failed",
  418: "I'm a teapot",
  421: "Misdirected Request",
  422: "Unprocessable Entity",
  423: "Locked",
  424: "Failed Dependency",
  425: "Too Early",
  426: "Upgrade Required",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
  506: "Variant Also Negotiates",
  507: "Insufficient Storage",
  508: "Loop Detected",
  510: "Not Extended",
  511: "Network Authentication Required",
};

export class ErrorHandler {
  private readonly onError?: ErrorHook;
  private readonly responseType: ErrorResponseType;
  private readonly formatResponse?: ErrorResponseFormatter;
  private readonly includeStackInDev: boolean;

  constructor(options?: ErrorHandlerOptions) {
    this.onError = options?.onError;
    this.responseType = options?.responseType ?? "json";
    this.formatResponse = options?.formatResponse;
    this.includeStackInDev = options?.includeStackInDev ?? true;
  }

  /**
   * Handle an error: normalize it, invoke the optional hook,
   * and set an error response if none has been sent yet.
   */
  async handle(error: unknown, ctx: Context): Promise<void> {
    const payload = this.normalize(error);

    // Fire optional logging/telemetry hook
    if (this.onError) {
      try {
        await this.onError(error, ctx);
      } catch (hookError) {
        // Log hook errors but don't prevent error response delivery
        console.error("[ErrorHandler] Hook error:", hookError);
      }
    }

    // Only set a response if one hasn't been sent already
    if (!ctx.hasResponded()) {
      const status = payload.statusCode ?? 500;

      // Use custom formatter if provided
      if (this.formatResponse) {
        const { body, type } = this.formatResponse(payload, ctx);
        if (type === "html") {
          ctx.html(body, status);
        } else {
          ctx.json(JSON.parse(body), status);
        }
        return;
      }

      // Default response based on responseType
      if (this.responseType === "html") {
        const htmlBody = this.formatHtmlError(payload);
        ctx.html(htmlBody, status);
      } else {
        const jsonBody = this.formatJsonError(payload);
        ctx.json(jsonBody, status);
      }
    }
  }

  /**
   * Format error as JSON.
   */
  private formatJsonError(payload: ErrorPayload): Record<string, unknown> {
    const response: Record<string, unknown> = { error: payload.message };
    if (payload.stack) {
      response.stack = payload.stack;
    }
    return response;
  }

  /**
   * Format error as HTML.
   * Production mode: minimal, no trace.
   * Development mode: full stack, request metadata.
   */
  private formatHtmlError(payload: ErrorPayload): string {
    const isProduction = process.env.NODE_ENV === "production";
    const statusCode = payload.statusCode ?? 500;
    const statusLabel = HTTP_STATUS_LABELS[statusCode] ?? "Error";

    const stackSection = payload.stack
      ? `
    <section class="stack">
      <p class="stack-label">Stack trace</p>
      <pre>${this.escapeHtml(payload.stack)}</pre>
    </section>`
      : "";

    const devBadge = !isProduction
      ? `<span class="env-badge">development</span>`
      : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${statusCode} — ${statusLabel}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:         #0d0d0f;
      --surface:    #141416;
      --border:     #242428;
      --text:       #e8e8ea;
      --muted:      #6e6e76;
      --accent:     #7c6af7;
      --danger:     #e5524a;
      --mono:       "Geist Mono", "Fira Code", "Cascadia Code", ui-monospace, monospace;
      --sans:       "Geist", "Inter", system-ui, sans-serif;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--sans);
      font-size: 15px;
      line-height: 1.6;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem 1.5rem;
    }

    .card {
      width: 100%;
      max-width: 680px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--border);
      gap: 1rem;
    }

    .status-line {
      display: flex;
      align-items: baseline;
      gap: 0.75rem;
    }

    .status-code {
      font-size: 13px;
      font-family: var(--mono);
      font-weight: 600;
      color: var(--danger);
      letter-spacing: 0.04em;
    }

    .status-text {
      font-size: 15px;
      font-weight: 500;
      color: var(--text);
    }

    .env-badge {
      font-size: 11px;
      font-family: var(--mono);
      font-weight: 500;
      color: var(--accent);
      background: rgba(124, 106, 247, 0.1);
      border: 1px solid rgba(124, 106, 247, 0.25);
      border-radius: 4px;
      padding: 3px 8px;
      white-space: nowrap;
    }

    .body {
      padding: 1.5rem;
    }

    .message {
      font-size: 14px;
      color: var(--muted);
      font-family: var(--mono);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem 1.25rem;
      word-break: break-word;
    }

    .stack {
      margin-top: 1.25rem;
    }

    .stack-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin-bottom: 0.5rem;
    }

    .stack pre {
      font-family: var(--mono);
      font-size: 12px;
      color: var(--muted);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem 1.25rem;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
      line-height: 1.75;
    }

    .footer {
      padding: 0.875rem 1.5rem;
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .footer-brand {
      font-size: 12px;
      font-family: var(--mono);
      font-weight: 600;
      color: var(--muted);
      letter-spacing: 0.04em;
    }

    .footer-brand span { color: var(--accent); }

    .footer-meta {
      font-size: 11px;
      font-family: var(--mono);
      color: var(--border);
    }
  </style>
</head>
<body>
  <div class="card" role="main" aria-label="Error details">
    <header class="header">
      <div class="status-line">
        <span class="status-code">${statusCode}</span>
        <span class="status-text">${this.escapeHtml(statusLabel)}</span>
      </div>
      ${devBadge}
    </header>

    <div class="body">
      <p class="message">${this.escapeHtml(payload.message)}</p>
      ${stackSection}
    </div>

    <footer class="footer">
      <span class="footer-brand"><span>Sinwan</span>JS</span>
      <span class="footer-meta">${new Date().toISOString()}</span>
    </footer>
  </div>
</body>
</html>`;
  }

  /**
   * Escape HTML entities.
   */
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * Normalize any thrown value into a consistent ErrorPayload.
   * Production mode suppresses internal error details.
   */
  private normalize(error: unknown): ErrorPayload {
    const isProduction = process.env.NODE_ENV === "production";

    // Standard Error instances
    if (error instanceof Error) {
      const statusCode = hasStatusCode(error) ? error.statusCode : undefined;
      const stack =
        !isProduction && this.includeStackInDev ? error.stack : undefined;
      return {
        message: isProduction ? "Internal Server Error" : error.message,
        statusCode,
        stack,
      };
    }

    // Plain string throws
    if (typeof error === "string") {
      return {
        message: isProduction ? "Internal Server Error" : error,
      };
    }

    // Object with a message property (e.g., { message: "...", statusCode: 400 })
    if (isErrorLike(error)) {
      return {
        message: isProduction ? "Internal Server Error" : error.message,
        statusCode:
          typeof error.statusCode === "number" ? error.statusCode : undefined,
      };
    }

    // Completely unknown type
    return { message: "Internal Server Error" };
  }
}

// ─── Type Guards ──────────────────────────────────────────

interface ErrorLike {
  message: string;
  statusCode?: unknown;
}

function isErrorLike(value: unknown): value is ErrorLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof (value as ErrorLike).message === "string"
  );
}

function hasStatusCode(error: Error): error is Error & { statusCode: number } {
  return (
    "statusCode" in error &&
    typeof (error as Error & { statusCode: unknown }).statusCode === "number"
  );
}
