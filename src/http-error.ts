/**
 * Custom HTTP error class for handling HTTP-specific errors.
 * Extends the native Error class with a statusCode property.
 */
export class HttpError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}
