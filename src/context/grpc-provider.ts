/**
 * Sinwan Engine — gRPC Provider Interface
 *
 * Defines the contract for gRPC operations without depending on
 * @grpc/grpc-js or @grpc/proto-loader.
 *
 * The sinwan-grpc package implements this interface, registers it
 * via `registerGRPCProvider`, and augments the `Sinwan` class with
 * fully typed overloads via `declare module "sinwan-engine"`.
 *
 * Users who don't need gRPC never install sinwan-grpc —
 * the @grpc/grpc-js code stays out of their bundle entirely.
 */

import type { Runtime } from "../runtime";

/**
 * Provider contract implemented by sinwan-grpc.
 * All config/return types are `unknown` here — sinwan-grpc provides
 * the fully typed overloads via module augmentation.
 */
export interface GRPCProvider {
  registerService(name: string, config: unknown): void;
  listen(runtime: Runtime, options?: unknown): Promise<unknown>;
  listen(runtime: Runtime, name: string, options?: unknown): Promise<unknown>;
  connect(config: unknown): unknown;
  stop(): Promise<void>;
}

// ─── Provider Registration ────────────────────────────────

let grpcProvider: GRPCProvider | null = null;

/**
 * Register the gRPC provider implementation.
 * Called by sinwan-grpc (or another gRPC library) at startup.
 */
export function registerGRPCProvider(provider: GRPCProvider): void {
  grpcProvider = provider;
}

/**
 * Get the registered gRPC provider.
 * Throws if no provider has been registered.
 */
export function getGRPCProvider(): GRPCProvider {
  if (!grpcProvider) {
    throw new Error(
      "No gRPC provider registered. Install sinwan-grpc and call " +
        "registerSinwanGRPC(app) to enable gRPC support.",
    );
  }
  return grpcProvider;
}

/**
 * Check if a gRPC provider is registered.
 */
export function hasGRPCProvider(): boolean {
  return grpcProvider !== null;
}

/**
 * Reset the gRPC provider registry.
 * Intended for testing and hot-reload scenarios.
 */
export function resetGRPCProvider(): void {
  grpcProvider = null;
}
