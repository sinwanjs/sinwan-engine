import { describe, expect, test, mock } from "bun:test";
import { WsContext, type WSSData } from "../../src/context/ws-context";
import { ErrorHandler } from "../../src/error-handler";
import type { Server, ServerWebSocket } from "bun";

type MockFn = ReturnType<typeof mock>;

function createWsContext(): WsContext {
  return new WsContext({ errorHandler: new ErrorHandler() });
}

/**
 * Full ServerWebSocket<WSSData> mock (same shape as ws-router.test.ts):
 * data/send/close/subscribe/unsubscribe/publish/isSubscribed/cork/
 * remoteAddress/readyState/subscriptions. The subscribe/unsubscribe/
 * isSubscribed mocks share a live subscriptions array for behavior.
 */
function createMockWS(
  path = "/ws",
  data: unknown = { custom: "ws" },
): {
  ws: ServerWebSocket<WSSData>;
  subscriptions: string[];
  send: MockFn;
  close: MockFn;
  subscribe: MockFn;
  unsubscribe: MockFn;
  publish: MockFn;
  isSubscribed: MockFn;
  cork: MockFn;
} {
  const subscriptions: string[] = [];
  const send = mock(
    (_message: string | ArrayBuffer | Uint8Array, _compress?: boolean) => 1,
  );
  const close = mock((_code?: number, _reason?: string) => {});
  const subscribe = mock((topic: string) => {
    subscriptions.push(topic);
  });
  const unsubscribe = mock((topic: string) => {
    const i = subscriptions.indexOf(topic);
    if (i >= 0) subscriptions.splice(i, 1);
  });
  const publish = mock(
    (
      _topic: string,
      _message: string | ArrayBuffer | Uint8Array,
      _compress?: boolean,
    ) => 1,
  );
  const isSubscribed = mock((topic: string) => subscriptions.includes(topic));
  const cork = mock((cb: () => void) => cb());
  const ws = {
    data: { path, data },
    remoteAddress: "127.0.0.1:12345",
    readyState: 1,
    subscriptions,
    send,
    close,
    subscribe,
    unsubscribe,
    publish,
    isSubscribed,
    cork,
  } as unknown as ServerWebSocket<WSSData>;
  return {
    ws,
    subscriptions,
    send,
    close,
    subscribe,
    unsubscribe,
    publish,
    isSubscribed,
    cork,
  };
}

/** Mock Bun Server for pendingWebSockets / publishToTopic. */
function createMockServer(pending = 2): {
  server: Server<unknown>;
  publish: MockFn;
} {
  const publish = mock(() => 0);
  const server = {
    pendingWebSockets: pending,
    publish,
  } as unknown as Server<unknown>;
  return { server, publish };
}

function createWsContextWithServer(pending = 2): {
  ctx: WsContext;
  publish: MockFn;
} {
  const { server, publish } = createMockServer(pending);
  const ctx = new WsContext({ errorHandler: new ErrorHandler(), server });
  return { ctx, publish };
}

describe("WsContext", () => {
  // ─── Basics ──────────────────────────────────────────────

  test("has the ws protocol tag", () => {
    const ctx = createWsContext();
    expect(ctx.protocol).toBe("ws");
  });

  test("setWS() attaches the websocket", () => {
    const ctx = createWsContext();
    const ws = createMockWS().ws;
    ctx.setWS(ws);
    expect(ctx.ws).toBe(ws);
  });

  test("reset() clears the websocket and shared state", () => {
    const ctx = createWsContext();
    ctx.setWS(createMockWS().ws);
    ctx.set("key", "value");
    ctx.reset({ errorHandler: new ErrorHandler() });
    expect(ctx.ws).toBeUndefined();
    expect(ctx.has("key")).toBe(false);
  });

  test("reset() re-attaches the server from options", () => {
    const ctx = createWsContext();
    const { server } = createMockServer(5);
    ctx.reset({ errorHandler: new ErrorHandler(), server });
    expect(ctx.pendingWebSockets).toBe(5);
  });

  // ─── WebSocket accessors ─────────────────────────────────

  describe("WebSocket accessors", () => {
    test("wsData() returns the data attached to the WebSocket", () => {
      const ctx = createWsContext();
      ctx.setWS(createMockWS("/ws", { custom: "ws" }).ws);
      expect(ctx.wsData<{ custom: string }>()).toEqual({ custom: "ws" });
    });

    test("wsData() returns the raw data value when null", () => {
      const ctx = createWsContext();
      ctx.setWS(createMockWS("/ws", null).ws);
      expect(ctx.wsData()).toBeNull();
    });

    test("path returns the WebSocket path", () => {
      const ctx = createWsContext();
      ctx.setWS(createMockWS("/socket").ws);
      expect(ctx.path).toBe("/socket");
    });

    test("remoteAddress returns the WebSocket remoteAddress", () => {
      const ctx = createWsContext();
      ctx.setWS(createMockWS().ws);
      expect(ctx.remoteAddress).toBe("127.0.0.1:12345");
    });

    test("readyState returns the WebSocket readyState", () => {
      const ctx = createWsContext();
      ctx.setWS(createMockWS().ws);
      expect(ctx.readyState).toBe(1);
    });

    test("subscriptions returns the WebSocket subscriptions", () => {
      const { ws, subscriptions } = createMockWS();
      subscriptions.push("news");
      const ctx = createWsContext();
      ctx.setWS(ws);
      expect(ctx.subscriptions).toEqual(["news"]);
    });
  });

  // ─── WebSocket operations ─────────────────────────────────

  describe("WebSocket operations", () => {
    test("send() delegates to the WebSocket send", () => {
      const { ws, send } = createMockWS();
      const ctx = createWsContext();
      ctx.setWS(ws);
      const result = ctx.send("hello");
      expect(result).toBe(1);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith("hello", undefined);
    });

    test("send() forwards the compress option", () => {
      const { ws, send } = createMockWS();
      const ctx = createWsContext();
      ctx.setWS(ws);
      ctx.send("hello", true);
      expect(send).toHaveBeenCalledWith("hello", true);
    });

    test("close() delegates to the WebSocket close", () => {
      const { ws, close } = createMockWS();
      const ctx = createWsContext();
      ctx.setWS(ws);
      ctx.close();
      expect(close).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledWith(undefined, undefined);
    });

    test("close() forwards code and reason", () => {
      const { ws, close } = createMockWS();
      const ctx = createWsContext();
      ctx.setWS(ws);
      ctx.close(1000, "normal");
      expect(close).toHaveBeenCalledWith(1000, "normal");
    });

    test("subscribe() adds the topic on the WebSocket", () => {
      const { ws, subscribe } = createMockWS();
      const ctx = createWsContext();
      ctx.setWS(ws);
      ctx.subscribe("news");
      expect(subscribe).toHaveBeenCalledWith("news");
      expect(ctx.subscriptions).toContain("news");
    });

    test("unsubscribe() removes the topic from the WebSocket", () => {
      const { ws, unsubscribe } = createMockWS();
      const ctx = createWsContext();
      ctx.setWS(ws);
      ctx.subscribe("news");
      ctx.unsubscribe("news");
      expect(unsubscribe).toHaveBeenCalledWith("news");
      expect(ctx.subscriptions).not.toContain("news");
    });

    test("publish() delegates to the WebSocket publish", () => {
      const { ws, publish } = createMockWS();
      const ctx = createWsContext();
      ctx.setWS(ws);
      const result = ctx.publish("topic", "message");
      expect(result).toBe(1);
      expect(publish).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledWith("topic", "message", undefined);
    });

    test("publish() forwards the compress option", () => {
      const { ws, publish } = createMockWS();
      const ctx = createWsContext();
      ctx.setWS(ws);
      ctx.publish("topic", "message", true);
      expect(publish).toHaveBeenCalledWith("topic", "message", true);
    });

    test("isSubscribed() reports the subscription state", () => {
      const { ws, isSubscribed } = createMockWS();
      const ctx = createWsContext();
      ctx.setWS(ws);
      expect(ctx.isSubscribed("news")).toBe(false);
      ctx.subscribe("news");
      expect(ctx.isSubscribed("news")).toBe(true);
      expect(isSubscribed).toHaveBeenCalledWith("news");
    });

    test("cork() runs the callback inside ws.cork with this context", () => {
      const { ws, cork } = createMockWS();
      const ctx = createWsContext();
      ctx.setWS(ws);
      let corked = false;
      let ctxInCallback: WsContext | undefined;
      ctx.cork((c) => {
        corked = true;
        ctxInCallback = c;
      });
      expect(corked).toBe(true);
      expect(ctxInCallback).toBe(ctx);
      expect(cork).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Server methods ──────────────────────────────────────

  describe("server methods", () => {
    test("pendingWebSockets throws when no server is attached", () => {
      const ctx = createWsContext();
      expect(() => ctx.pendingWebSockets).toThrow(
        "Context is not attached to a Server.",
      );
    });

    test("pendingWebSockets returns the server's pending count", () => {
      const { ctx } = createWsContextWithServer(2);
      expect(ctx.pendingWebSockets).toBe(2);
    });

    test("publishToTopic throws when no server is attached", () => {
      const ctx = createWsContext();
      expect(() => ctx.publishToTopic("topic", "data")).toThrow(
        "Context is not attached to a Server.",
      );
    });

    test("publishToTopic delegates to server.publish", () => {
      const { ctx, publish } = createWsContextWithServer();
      const result = ctx.publishToTopic("topic", "data");
      expect(result).toBe(0);
      expect(publish).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledWith("topic", "data", undefined);
    });

    test("publishToTopic forwards the compress option", () => {
      const { ctx, publish } = createWsContextWithServer();
      ctx.publishToTopic("topic", "data", true);
      expect(publish).toHaveBeenCalledWith("topic", "data", true);
    });
  });

  // ─── Guards — no WebSocket attached ──────────────────────

  describe("guards", () => {
    test("all WebSocket methods throw when no WebSocket is attached", () => {
      const ctx = createWsContext();
      expect(() => ctx.wsData()).toThrow(
        "Context is not attached to a WebSocket.",
      );
      expect(() => ctx.path).toThrow("Context is not attached to a WebSocket.");
      expect(() => ctx.remoteAddress).toThrow(
        "Context is not attached to a WebSocket.",
      );
      expect(() => ctx.readyState).toThrow(
        "Context is not attached to a WebSocket.",
      );
      expect(() => ctx.subscriptions).toThrow(
        "Context is not attached to a WebSocket.",
      );
      expect(() => ctx.send("hi")).toThrow(
        "Context is not attached to a WebSocket.",
      );
      expect(() => ctx.close()).toThrow(
        "Context is not attached to a WebSocket.",
      );
      expect(() => ctx.subscribe("t")).toThrow(
        "Context is not attached to a WebSocket.",
      );
      expect(() => ctx.unsubscribe("t")).toThrow(
        "Context is not attached to a WebSocket.",
      );
      expect(() => ctx.publish("t", "m")).toThrow(
        "Context is not attached to a WebSocket.",
      );
      expect(() => ctx.isSubscribed("t")).toThrow(
        "Context is not attached to a WebSocket.",
      );
      expect(() => ctx.cork(() => {})).toThrow(
        "Context is not attached to a WebSocket.",
      );
    });
  });

  // ─── Socket delegation composites (ported from context.test.ts) ──

  describe("socket delegation methods", () => {
    test("WS delegation: wsData, path, remoteAddress, readyState, subscriptions", () => {
      const ctx = createWsContext();
      ctx.setWS(createMockWS("/ws", { custom: "ws" }).ws);
      expect(ctx.wsData<{ custom: string }>()).toEqual({ custom: "ws" });
      expect(ctx.path).toBe("/ws");
      expect(ctx.remoteAddress).toBe("127.0.0.1:12345");
      expect(ctx.readyState).toBe(1);
      expect(ctx.subscriptions).toEqual([]);
    });

    test("WS delegation: send, close, subscribe, unsubscribe, publish, isSubscribed, cork", () => {
      const ctx = createWsContext();
      ctx.setWS(createMockWS().ws);
      expect(() => ctx.send("hi")).not.toThrow();
      expect(() => ctx.close()).not.toThrow();
      ctx.subscribe("news");
      expect(ctx.isSubscribed("news")).toBe(true);
      ctx.unsubscribe("news");
      expect(ctx.isSubscribed("news")).toBe(false);
      expect(() => ctx.publish("topic", "msg")).not.toThrow();
      expect(() => ctx.cork(() => {})).not.toThrow();
    });
  });
});
