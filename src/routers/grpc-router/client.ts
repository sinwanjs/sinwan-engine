/**
 * SinwanJS Core Runtime - GRPCClient
 *
 * A small typed client helper for services loaded with @grpc/proto-loader.
 */

import * as grpc from "@grpc/grpc-js";
import {
  createGRPCMetadata,
  loadGRPCService,
  mergeGRPCLoaderOptions,
  type GRPCMetadataInit,
  type GRPCProtoPath,
} from "./server";

export type GRPCClientCredentialsInput =
  | grpc.ChannelCredentials
  | "insecure"
  | {
      rootCerts?: Buffer | null;
      privateKey?: Buffer | null;
      certChain?: Buffer | null;
      verifyOptions?: grpc.VerifyOptions;
    };

export interface GRPCClientConfig {
  /** .proto file path or paths. */
  proto: GRPCProtoPath;
  /** Proto package name, e.g. "users.v1". Optional if service is fully qualified. */
  package?: string;
  /** Service name, e.g. "UserService" or "users.v1.UserService". */
  service: string;
  /** Host:port target, e.g. "localhost:50051". */
  address: string;
  /** Client credentials. Default: insecure. */
  credentials?: GRPCClientCredentialsInput;
  /** Proto-loader options. Merged with Sinwan defaults. */
  loader?: import("@grpc/proto-loader").Options;
  /** grpc-js client options. */
  options?: grpc.ClientOptions;
}

export interface GRPCCallOptions {
  metadata?: GRPCMetadataInit;
  options?: grpc.CallOptions;
}

export interface GRPCClientStreamCall<Request = any, Response = any> {
  stream: grpc.ClientWritableStream<Request>;
  response: Promise<Response>;
}

export class GRPCClient<ServiceShape extends Record<string, any> = Record<string, any>> {
  public readonly client: grpc.Client & ServiceShape;
  public readonly serviceName: string;
  public readonly address: string;
  private readonly serviceDefinition: grpc.ServiceDefinition;

  constructor(config: GRPCClientConfig) {
    const loaded = loadGRPCService({
      proto: config.proto,
      package: config.package,
      service: config.service,
      loader: mergeGRPCLoaderOptions(config.loader),
    });

    this.serviceName = loaded.fullName;
    this.address = config.address;
    this.serviceDefinition = loaded.serviceDefinition;
    this.client = new loaded.clientConstructor(
      config.address,
      resolveGRPCClientCredentials(config.credentials),
      config.options,
    ) as grpc.Client & ServiceShape;
  }

  static create<ServiceShape extends Record<string, any> = Record<string, any>>(
    config: GRPCClientConfig,
  ): GRPCClient<ServiceShape> {
    return new GRPCClient<ServiceShape>(config);
  }

  unary<Request = any, Response = any>(
    method: string,
    request: Request,
    callOptions: GRPCCallOptions = {},
  ): Promise<Response> {
    const methodName = this.resolveMethodName(method, "unary");
    const fn = this.getMethod(methodName);

    return new Promise<Response>((resolve, reject) => {
      const callback = (error: grpc.ServiceError | null, value?: Response) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(value as Response);
      };

      invokeUnary(fn, request, callOptions, callback);
    });
  }

  serverStream<Request = any, Response = any>(
    method: string,
    request: Request,
    callOptions: GRPCCallOptions = {},
  ): grpc.ClientReadableStream<Response> {
    const methodName = this.resolveMethodName(method, "serverStream");
    const fn = this.getMethod(methodName);
    const metadata = createGRPCMetadata(callOptions.metadata);

    return callOptions.options
      ? fn(request, metadata, callOptions.options)
      : fn(request, metadata);
  }

  clientStream<Request = any, Response = any>(
    method: string,
    callOptions: GRPCCallOptions = {},
  ): GRPCClientStreamCall<Request, Response> {
    const methodName = this.resolveMethodName(method, "clientStream");
    const fn = this.getMethod(methodName);

    let stream!: grpc.ClientWritableStream<Request>;
    const response = new Promise<Response>((resolve, reject) => {
      const callback = (error: grpc.ServiceError | null, value?: Response) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(value as Response);
      };

      const metadata = createGRPCMetadata(callOptions.metadata);
      stream = callOptions.options
        ? fn(metadata, callOptions.options, callback)
        : fn(metadata, callback);
    });

    return { stream, response };
  }

  bidi<Request = any, Response = any>(
    method: string,
    callOptions: GRPCCallOptions = {},
  ): grpc.ClientDuplexStream<Request, Response> {
    const methodName = this.resolveMethodName(method, "bidi");
    const fn = this.getMethod(methodName);
    const metadata = createGRPCMetadata(callOptions.metadata);

    return callOptions.options
      ? fn(metadata, callOptions.options)
      : fn(metadata);
  }

  waitForReady(deadline: Date | number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.waitForReady(deadline, (error?: Error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  close(): void {
    this.client.close();
  }

  private getMethod(methodName: string): (...args: any[]) => any {
    const fn = (this.client as any)[methodName];
    if (typeof fn !== "function") {
      throw new Error(
        `[GRPCClient] Method "${methodName}" is not available on ${this.serviceName}.`,
      );
    }
    return fn.bind(this.client);
  }

  private resolveMethodName(method: string, expectedKind: GRPCClientMethodKind): string {
    const candidates = getClientMethodCandidates(method);

    for (const candidate of candidates) {
      const definition = this.serviceDefinition[candidate];
      if (!definition) continue;

      const actualKind = getClientMethodKind(definition);
      if (actualKind !== expectedKind) {
        throw new Error(
          `[GRPCClient] Method "${candidate}" is "${actualKind}", not "${expectedKind}".`,
        );
      }

      return candidate;
    }

    throw new Error(
      `[GRPCClient] Unknown method "${method}" on ${this.serviceName}. Available: ${Object.keys(
        this.serviceDefinition,
      ).join(", ")}`,
    );
  }
}

export function createGRPCClient<
  ServiceShape extends Record<string, any> = Record<string, any>,
>(config: GRPCClientConfig): GRPCClient<ServiceShape> {
  return new GRPCClient<ServiceShape>(config);
}

export function resolveGRPCClientCredentials(
  credentials?: GRPCClientCredentialsInput,
): grpc.ChannelCredentials {
  if (!credentials || credentials === "insecure") {
    return grpc.credentials.createInsecure();
  }

  if (isGRPCChannelCredentials(credentials)) {
    return credentials;
  }

  return grpc.credentials.createSsl(
    credentials.rootCerts ?? null,
    credentials.privateKey ?? null,
    credentials.certChain ?? null,
    credentials.verifyOptions,
  );
}

type GRPCClientMethodKind =
  | "unary"
  | "serverStream"
  | "clientStream"
  | "bidi";

function invokeUnary<Request, Response>(
  fn: (...args: any[]) => any,
  request: Request,
  callOptions: GRPCCallOptions,
  callback: grpc.requestCallback<Response>,
): grpc.ClientUnaryCall {
  const metadata = createGRPCMetadata(callOptions.metadata);

  return callOptions.options
    ? fn(request, metadata, callOptions.options, callback)
    : fn(request, metadata, callback);
}

function getClientMethodKind(
  definition: Pick<
    grpc.MethodDefinition<any, any>,
    "requestStream" | "responseStream"
  >,
): GRPCClientMethodKind {
  if (definition.requestStream && definition.responseStream) return "bidi";
  if (definition.requestStream) return "clientStream";
  if (definition.responseStream) return "serverStream";
  return "unary";
}

function getClientMethodCandidates(method: string): string[] {
  return Array.from(new Set([method, lowerFirst(method)]));
}

function lowerFirst(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function isGRPCChannelCredentials(
  value: unknown,
): value is grpc.ChannelCredentials {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as any)._getConnectionOptions === "function"
  );
}
