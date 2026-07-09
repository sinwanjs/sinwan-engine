import { describe, expect, test, beforeEach } from "bun:test";
import { SocketHelper } from "../../src/context/socket-helper";
import {
  Context,
  type WSSData,
  type TCPData,
  type UDPData,
} from "../../src/context/context";
import { EventBus } from "../../src/event-bus";
import { ErrorHandler } from "../../src/error-handler";
import type { ServerWebSocket, Socket, SocketAddress } from "bun";
import type { SinwanUDPSocket } from "../../src/routers/udp-router";

function createCtx(): Context {
  return new Context({
    bus: new EventBus(),
    errorHandler: new ErrorHandler(),
  });
}

function createMockWS(): ServerWebSocket<WSSData> {
  const subscriptions: string[] = [];
  return {
    data: { path: "/ws", data: { custom: "payload" } },
    remoteAddress: "127.0.0.1:12345",
    readyState: 1,
    subscriptions,
    send: () => 0,
    close: () => {},
    subscribe: (topic: string) => {
      subscriptions.push(topic);
    },
    unsubscribe: (topic: string) => {
      const i = subscriptions.indexOf(topic);
      if (i >= 0) subscriptions.splice(i, 1);
    },
    publish: () => 0,
    isSubscribed: (topic: string) => subscriptions.includes(topic),
    cork: (cb: () => void) => cb(),
  } as unknown as ServerWebSocket<WSSData>;
}

function createMockTCP(): Socket<TCPData> {
  return {
    data: { name: "tcp-conn", data: { custom: "tcp-data" } },
    remoteAddress: "192.168.1.1:8080",
    localAddress: "10.0.0.1:3000",
    write: () => 0,
    end: () => 0,
    flush: () => {},
    timeout: () => {},
  } as unknown as Socket<TCPData>;
}

function createMockUDP(): SinwanUDPSocket<UDPData> {
  return {
    data: { name: "udp-sock", data: { custom: "udp-data" } },
    address: {
      address: "0.0.0.0",
      port: 9090,
      family: "IPv4",
    } as SocketAddress,
    closed: false,
    send: () => true,
    sendMany: () => 0,
    addMembership: () => true,
    dropMembership: () => true,
  } as unknown as SinwanUDPSocket<UDPData>;
}

describe("SocketHelper", () => {
  let ctx: Context;
  let helper: SocketHelper;

  beforeEach(() => {
    ctx = createCtx();
    helper = new SocketHelper(ctx);
  });

  // ─── WebSocket ────────────────────────────────────────────

  describe("WebSocket", () => {
    test("wsData returns data from WebSocket", () => {
      ctx.setWS(createMockWS());
      expect(helper.wsData<{ custom: string }>()).toEqual({
        custom: "payload",
      });
    });

    test("path returns WebSocket path", () => {
      ctx.setWS(createMockWS());
      expect(helper.path).toBe("/ws");
    });

    test("remoteAddress returns WebSocket remoteAddress", () => {
      ctx.setWS(createMockWS());
      expect(helper.remoteAddress).toBe("127.0.0.1:12345");
    });

    test("readyState returns WebSocket readyState", () => {
      ctx.setWS(createMockWS());
      expect(helper.readyState).toBe(1);
    });

    test("subscriptions returns WebSocket subscriptions", () => {
      ctx.setWS(createMockWS());
      expect(helper.subscriptions).toEqual([]);
    });

    test("send calls WebSocket send", () => {
      const ws = createMockWS();
      let sentMsg: string | ArrayBuffer | Uint8Array | undefined;
      (
        ws as unknown as {
          send: (m: string | ArrayBuffer | Uint8Array) => number;
        }
      ).send = (m: string | ArrayBuffer | Uint8Array) => {
        sentMsg = m;
        return 1;
      };
      ctx.setWS(ws);
      const result = helper.send("hello");
      expect(result).toBe(1);
      expect(sentMsg).toBe("hello");
    });

    test("send with compress option", () => {
      const ws = createMockWS();
      let compressUsed = false;
      (
        ws as unknown as {
          send: (m: string | ArrayBuffer | Uint8Array, c?: boolean) => number;
        }
      ).send = (_m: string | ArrayBuffer | Uint8Array, c?: boolean) => {
        compressUsed = c ?? false;
        return 1;
      };
      ctx.setWS(ws);
      helper.send("data", true);
      expect(compressUsed).toBe(true);
    });

    test("close calls WebSocket close", () => {
      const ws = createMockWS();
      let closed = false;
      (ws as unknown as { close: () => void }).close = () => {
        closed = true;
      };
      ctx.setWS(ws);
      helper.close();
      expect(closed).toBe(true);
    });

    test("close with code and reason", () => {
      const ws = createMockWS();
      let closeCode: number | undefined;
      let closeReason: string | undefined;
      (ws as unknown as { close: (c?: number, r?: string) => void }).close = (
        c?: number,
        r?: string,
      ) => {
        closeCode = c;
        closeReason = r;
      };
      ctx.setWS(ws);
      helper.close(1000, "normal");
      expect(closeCode).toBe(1000);
      expect(closeReason).toBe("normal");
    });

    test("subscribe adds topic", () => {
      ctx.setWS(createMockWS());
      helper.subscribe("news");
      expect(helper.subscriptions).toContain("news");
    });

    test("unsubscribe removes topic", () => {
      ctx.setWS(createMockWS());
      helper.subscribe("news");
      helper.unsubscribe("news");
      expect(helper.subscriptions).not.toContain("news");
    });

    test("publish calls WebSocket publish", () => {
      const ws = createMockWS();
      let publishedTopic: string | undefined;
      let publishedMsg: string | ArrayBuffer | Uint8Array | undefined;
      (
        ws as unknown as {
          publish: (t: string, m: string | ArrayBuffer | Uint8Array) => number;
        }
      ).publish = (t: string, m: string | ArrayBuffer | Uint8Array) => {
        publishedTopic = t;
        publishedMsg = m;
        return 1;
      };
      ctx.setWS(ws);
      const result = helper.publish("topic", "message");
      expect(result).toBe(1);
      expect(publishedTopic).toBe("topic");
      expect(publishedMsg).toBe("message");
    });

    test("isSubscribed checks topic", () => {
      ctx.setWS(createMockWS());
      expect(helper.isSubscribed("news")).toBe(false);
      helper.subscribe("news");
      expect(helper.isSubscribed("news")).toBe(true);
    });

    test("cork calls callback with context", () => {
      const ws = createMockWS();
      let corked = false;
      (ws as unknown as { cork: (cb: () => void) => void }).cork = (
        cb: () => void,
      ) => {
        corked = true;
        cb();
      };
      ctx.setWS(ws);
      let ctxInCallback: Context | undefined;
      helper.cork((c) => {
        ctxInCallback = c;
      });
      expect(corked).toBe(true);
      expect(ctxInCallback).toBe(ctx);
    });

    test("throws when no WebSocket attached", () => {
      expect(() => helper.wsData()).toThrow(
        "Context is not attached to a WebSocket.",
      );
      expect(() => helper.path).toThrow(
        "Context is not attached to a WebSocket.",
      );
      expect(() => helper.remoteAddress).toThrow(
        "Context is not attached to a WebSocket.",
      );
      expect(() => helper.readyState).toThrow(
        "Context is not attached to a WebSocket.",
      );
      expect(() => helper.subscriptions).toThrow(
        "Context is not attached to a WebSocket.",
      );
      expect(() => helper.send("hi")).toThrow(
        "Context is not attached to a WebSocket.",
      );
      expect(() => helper.close()).toThrow(
        "Context is not attached to a WebSocket.",
      );
      expect(() => helper.subscribe("t")).toThrow(
        "Context is not attached to a WebSocket.",
      );
      expect(() => helper.unsubscribe("t")).toThrow(
        "Context is not attached to a WebSocket.",
      );
      expect(() => helper.publish("t", "m")).toThrow(
        "Context is not attached to a WebSocket.",
      );
      expect(() => helper.isSubscribed("t")).toThrow(
        "Context is not attached to a WebSocket.",
      );
      expect(() => helper.cork(() => {})).toThrow(
        "Context is not attached to a WebSocket.",
      );
    });
  });

  // ─── TCP Socket ───────────────────────────────────────────

  describe("TCP Socket", () => {
    test("tcpData returns data from TCP socket", () => {
      ctx.setTCP(createMockTCP());
      expect(helper.tcpData<{ custom: string }>()).toEqual({
        custom: "tcp-data",
      });
    });

    test("tcpName returns TCP socket name", () => {
      ctx.setTCP(createMockTCP());
      expect(helper.tcpName).toBe("tcp-conn");
    });

    test("tcpRemoteAddress returns TCP remoteAddress", () => {
      ctx.setTCP(createMockTCP());
      expect(helper.tcpRemoteAddress).toBe("192.168.1.1:8080");
    });

    test("tcpLocalAddress returns TCP localAddress", () => {
      ctx.setTCP(createMockTCP());
      expect(helper.tcpLocalAddress).toBe("10.0.0.1:3000");
    });

    test("write calls TCP socket write", () => {
      const tcp = createMockTCP();
      let writtenData: string | undefined;
      (tcp as unknown as { write: (d: string) => number }).write = (
        d: string,
      ) => {
        writtenData = d;
        return d.length;
      };
      ctx.setTCP(tcp);
      const result = helper.write("hello");
      expect(result).toBe(5);
      expect(writtenData).toBe("hello");
    });

    test("write with byteOffset and byteLength", () => {
      const tcp = createMockTCP();
      let offset: number | undefined;
      let length: number | undefined;
      (
        tcp as unknown as {
          write: (d: string, o?: number, l?: number) => number;
        }
      ).write = (_d: string, o?: number, l?: number) => {
        offset = o;
        length = l;
        return 0;
      };
      ctx.setTCP(tcp);
      helper.write("data", 2, 4);
      expect(offset).toBe(2);
      expect(length).toBe(4);
    });

    test("end calls TCP socket end", () => {
      const tcp = createMockTCP();
      let ended = false;
      (tcp as unknown as { end: () => number }).end = () => {
        ended = true;
        return 0;
      };
      ctx.setTCP(tcp);
      helper.end();
      expect(ended).toBe(true);
    });

    test("end with data", () => {
      const tcp = createMockTCP();
      let endData: string | undefined;
      (tcp as unknown as { end: (d?: string) => number }).end = (
        d?: string,
      ) => {
        endData = d;
        return 0;
      };
      ctx.setTCP(tcp);
      helper.end("goodbye");
      expect(endData).toBe("goodbye");
    });

    test("flush calls TCP socket flush", () => {
      const tcp = createMockTCP();
      let flushed = false;
      (tcp as unknown as { flush: () => void }).flush = () => {
        flushed = true;
      };
      ctx.setTCP(tcp);
      helper.flush();
      expect(flushed).toBe(true);
    });

    test("timeout calls TCP socket timeout", () => {
      const tcp = createMockTCP();
      let timeoutValue: number | undefined;
      (tcp as unknown as { timeout: (s: number) => void }).timeout = (
        s: number,
      ) => {
        timeoutValue = s;
      };
      ctx.setTCP(tcp);
      helper.timeout(30);
      expect(timeoutValue).toBe(30);
    });

    test("throws when no TCP socket attached", () => {
      expect(() => helper.tcpData()).toThrow(
        "Context is not attached to a TCP socket.",
      );
      expect(() => helper.tcpName).toThrow(
        "Context is not attached to a TCP socket.",
      );
      expect(() => helper.tcpRemoteAddress).toThrow(
        "Context is not attached to a TCP socket.",
      );
      expect(() => helper.tcpLocalAddress).toThrow(
        "Context is not attached to a TCP socket.",
      );
      expect(() => helper.write("data")).toThrow(
        "Context is not attached to a TCP socket.",
      );
      expect(() => helper.end()).toThrow(
        "Context is not attached to a TCP socket.",
      );
      expect(() => helper.flush()).toThrow(
        "Context is not attached to a TCP socket.",
      );
      expect(() => helper.timeout(10)).toThrow(
        "Context is not attached to a TCP socket.",
      );
    });
  });

  // ─── UDP Socket ───────────────────────────────────────────

  describe("UDP Socket", () => {
    test("udpData returns data from UDP socket", () => {
      ctx.setUDP(createMockUDP());
      expect(helper.udpData<{ custom: string }>()).toEqual({
        custom: "udp-data",
      });
    });

    test("udpName returns UDP socket name", () => {
      ctx.setUDP(createMockUDP());
      expect(helper.udpName).toBe("udp-sock");
    });

    test("udpAddress returns UDP socket address", () => {
      ctx.setUDP(createMockUDP());
      const addr = helper.udpAddress;
      expect(addr.address).toBe("0.0.0.0");
      expect(addr.port).toBe(9090);
    });

    test("udpClosed returns UDP socket closed state", () => {
      ctx.setUDP(createMockUDP());
      expect(helper.udpClosed).toBe(false);
    });

    test("sendUDP without port and address", () => {
      const udp = createMockUDP();
      let sentData: string | undefined;
      let sentPort: number | undefined;
      let sentAddress: string | undefined;
      (
        udp as unknown as {
          send: (d: string, p?: number, a?: string) => boolean;
        }
      ).send = (d: string, p?: number, a?: string) => {
        sentData = d;
        sentPort = p;
        sentAddress = a;
        return true;
      };
      ctx.setUDP(udp);
      const result = helper.sendUDP("data");
      expect(result).toBe(true);
      expect(sentData).toBe("data");
      expect(sentPort).toBeUndefined();
      expect(sentAddress).toBeUndefined();
    });

    test("sendUDP with port and address", () => {
      const udp = createMockUDP();
      let sentData: string | undefined;
      let sentPort: number | undefined;
      let sentAddress: string | undefined;
      (
        udp as unknown as {
          send: (d: string, p?: number, a?: string) => boolean;
        }
      ).send = (d: string, p?: number, a?: string) => {
        sentData = d;
        sentPort = p;
        sentAddress = a;
        return true;
      };
      ctx.setUDP(udp);
      const result = helper.sendUDP("data", 8080, "127.0.0.1");
      expect(result).toBe(true);
      expect(sentData).toBe("data");
      expect(sentPort).toBe(8080);
      expect(sentAddress).toBe("127.0.0.1");
    });

    test("sendManyUDP calls UDP socket sendMany", () => {
      const udp = createMockUDP();
      let sentPackets: readonly (Buffer | string | number)[] | undefined;
      (
        udp as unknown as {
          sendMany: (p: readonly (Buffer | string | number)[]) => number;
        }
      ).sendMany = (p: readonly (Buffer | string | number)[]) => {
        sentPackets = p;
        return p.length;
      };
      ctx.setUDP(udp);
      const result = helper.sendManyUDP(["a", "b", "c"]);
      expect(result).toBe(3);
      expect(sentPackets).toEqual(["a", "b", "c"]);
    });

    test("addMembershipUDP calls UDP socket addMembership", () => {
      const udp = createMockUDP();
      let multicastAddr: string | undefined;
      let ifaceAddr: string | undefined;
      (
        udp as unknown as {
          addMembership: (m: string, i?: string) => boolean;
        }
      ).addMembership = (m: string, i?: string) => {
        multicastAddr = m;
        ifaceAddr = i;
        return true;
      };
      ctx.setUDP(udp);
      const result = helper.addMembershipUDP("224.0.0.1", "0.0.0.0");
      expect(result).toBe(true);
      expect(multicastAddr).toBe("224.0.0.1");
      expect(ifaceAddr).toBe("0.0.0.0");
    });

    test("addMembershipUDP without interface address", () => {
      const udp = createMockUDP();
      let ifaceAddr: string | undefined;
      (
        udp as unknown as {
          addMembership: (m: string, i?: string) => boolean;
        }
      ).addMembership = (_m: string, i?: string) => {
        ifaceAddr = i;
        return true;
      };
      ctx.setUDP(udp);
      helper.addMembershipUDP("224.0.0.1");
      expect(ifaceAddr).toBeUndefined();
    });

    test("dropMembershipUDP calls UDP socket dropMembership", () => {
      const udp = createMockUDP();
      let multicastAddr: string | undefined;
      let ifaceAddr: string | undefined;
      (
        udp as unknown as {
          dropMembership: (m: string, i?: string) => boolean;
        }
      ).dropMembership = (m: string, i?: string) => {
        multicastAddr = m;
        ifaceAddr = i;
        return true;
      };
      ctx.setUDP(udp);
      const result = helper.dropMembershipUDP("224.0.0.1", "0.0.0.0");
      expect(result).toBe(true);
      expect(multicastAddr).toBe("224.0.0.1");
      expect(ifaceAddr).toBe("0.0.0.0");
    });

    test("dropMembershipUDP without interface address", () => {
      const udp = createMockUDP();
      let ifaceAddr: string | undefined;
      (
        udp as unknown as {
          dropMembership: (m: string, i?: string) => boolean;
        }
      ).dropMembership = (_m: string, i?: string) => {
        ifaceAddr = i;
        return true;
      };
      ctx.setUDP(udp);
      helper.dropMembershipUDP("224.0.0.1");
      expect(ifaceAddr).toBeUndefined();
    });

    test("throws when no UDP socket attached", () => {
      expect(() => helper.udpData()).toThrow(
        "Context is not attached to a UDP socket.",
      );
      expect(() => helper.udpName).toThrow(
        "Context is not attached to a UDP socket.",
      );
      expect(() => helper.udpAddress).toThrow(
        "Context is not attached to a UDP socket.",
      );
      expect(() => helper.udpClosed).toThrow(
        "Context is not attached to a UDP socket.",
      );
      expect(() => helper.sendUDP("data")).toThrow(
        "Context is not attached to a UDP socket.",
      );
      expect(() => helper.sendManyUDP([])).toThrow(
        "Context is not attached to a UDP socket.",
      );
      expect(() => helper.addMembershipUDP("224.0.0.1")).toThrow(
        "Context is not attached to a UDP socket.",
      );
      expect(() => helper.dropMembershipUDP("224.0.0.1")).toThrow(
        "Context is not attached to a UDP socket.",
      );
    });
  });
});
