import { describe, expect, test, beforeEach } from "bun:test";
import {
  registerGRPCProvider,
  getGRPCProvider,
  hasGRPCProvider,
  resetGRPCProvider,
  type GRPCProvider,
} from "../../src/context/grpc-provider";
import type { Runtime } from "../../src/runtime";

function createMockProvider(): GRPCProvider {
  return {
    registerService: () => {},
    listen: async () => ({}),
    connect: () => ({}),
    stop: async () => {},
  };
}

describe("grpc-provider", () => {
  beforeEach(() => {
    resetGRPCProvider();
  });

  // Test throw path first, before any provider is registered.
  // Module-level state is fresh when this file loads.
  test("getGRPCProvider throws when no provider registered", () => {
    expect(hasGRPCProvider()).toBe(false);
    expect(() => getGRPCProvider()).toThrow("No gRPC provider registered");
  });

  test("registerGRPCProvider sets the provider", () => {
    const provider = createMockProvider();
    registerGRPCProvider(provider);
    expect(hasGRPCProvider()).toBe(true);
    expect(getGRPCProvider()).toBe(provider);
  });

  test("getGRPCProvider returns the registered provider", () => {
    const provider = createMockProvider();
    registerGRPCProvider(provider);
    const result = getGRPCProvider();
    expect(result).toBe(provider);
  });

  test("registered provider methods are callable", async () => {
    let registerCalled = false;
    let stopCalled = false;

    const provider: GRPCProvider = {
      registerService: () => {
        registerCalled = true;
      },
      listen: async () => ({}),
      connect: () => ({}),
      stop: async () => {
        stopCalled = true;
      },
    };

    registerGRPCProvider(provider);
    const p = getGRPCProvider();

    p.registerService("test", {});
    expect(registerCalled).toBe(true);

    await p.stop();
    expect(stopCalled).toBe(true);
  });

  test("provider listen with runtime and options", async () => {
    const provider: GRPCProvider = {
      registerService: () => {},
      listen: async (_runtime: Runtime, _options?: unknown) => {
        return { port: 50051 };
      },
      connect: () => ({}),
      stop: async () => {},
    };

    registerGRPCProvider(provider);
    const p = getGRPCProvider();

    const result = await p.listen({} as Runtime, { port: 50051 });
    expect(result).toEqual({ port: 50051 });
  });

  test("provider listen with runtime, name, and options", async () => {
    const provider: GRPCProvider = {
      registerService: () => {},
      listen: async (_runtime: Runtime, _name: unknown, _options?: unknown) => {
        return { service: "test" };
      },
      connect: () => ({}),
      stop: async () => {},
    };

    registerGRPCProvider(provider);
    const p = getGRPCProvider();

    const result = await p.listen({} as Runtime, "MyService", { port: 50051 });
    expect(result).toEqual({ service: "test" });
  });

  test("provider connect returns value", () => {
    const provider: GRPCProvider = {
      registerService: () => {},
      listen: async () => ({}),
      connect: (config: unknown) => ({ connected: true, config }),
      stop: async () => {},
    };

    registerGRPCProvider(provider);
    const p = getGRPCProvider();

    const result = p.connect({ address: "localhost:50051" });
    expect(result).toEqual({
      connected: true,
      config: { address: "localhost:50051" },
    });
  });
});
