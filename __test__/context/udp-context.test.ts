import { describe, expect, test, mock } from "bun:test";
import type { SocketAddress } from "bun";
import { UdpContext, type UDPData } from "../../src/context/udp-context";
import { ErrorHandler } from "../../src/error-handler";
import type { SinwanUDPSocket } from "../../src/routers/udp-router";

function createUdpContext(): UdpContext {
  return new UdpContext({ errorHandler: new ErrorHandler() });
}

function createMockUDPSocket(
  name: string = "udp-sock",
  data: unknown = { custom: "udp-data" },
): SinwanUDPSocket<UDPData> {
  return {
    data: { name, data },
    send: mock(() => true),
    sendMany: mock(() => 0),
    close: mock(() => {}),
    closed: false,
    hostname: "0.0.0.0",
    port: 0,
    address: {
      address: "0.0.0.0",
      port: 9090,
      family: "IPv4",
    } as SocketAddress,
    addMembership: mock(() => true),
    dropMembership: mock(() => true),
  } as unknown as SinwanUDPSocket<UDPData>;
}

describe("UdpContext", () => {
  test("has the udp protocol tag", () => {
    const ctx = createUdpContext();
    expect(ctx.protocol).toBe("udp");
  });

  test("setUDP() attaches the socket", () => {
    const ctx = createUdpContext();
    const socket = createMockUDPSocket();
    ctx.setUDP(socket);
    expect(ctx.udp).toBe(socket);
  });

  test("reset() clears the socket and shared state", () => {
    const ctx = createUdpContext();
    ctx.setUDP(createMockUDPSocket());
    ctx.set("key", "value");
    ctx.reset({ errorHandler: new ErrorHandler() });
    expect(ctx.udp).toBeUndefined();
    expect(ctx.has("key")).toBe(false);
  });

  // ─── UDP delegation (ported from Context) ────────────────

  describe("UDP delegation", () => {
    test("udpData, udpName, udpAddress, udpClosed", () => {
      const ctx = createUdpContext();
      ctx.setUDP(createMockUDPSocket("udp", { custom: "udp" }));
      expect(ctx.udpData<{ custom: string }>()).toEqual({ custom: "udp" });
      expect(ctx.udpName).toBe("udp");
      expect(ctx.udpAddress.address).toBe("0.0.0.0");
      expect(ctx.udpClosed).toBe(false);
    });

    test("sendUDP, sendManyUDP, addMembershipUDP, dropMembershipUDP", () => {
      const ctx = createUdpContext();
      ctx.setUDP(createMockUDPSocket());
      expect(() => ctx.sendUDP("data")).not.toThrow();
      expect(() => ctx.sendUDP("data", 8080, "127.0.0.1")).not.toThrow();
      expect(() => ctx.sendManyUDP(["a", "b"])).not.toThrow();
      expect(() => ctx.addMembershipUDP("224.0.0.1")).not.toThrow();
      expect(() => ctx.dropMembershipUDP("224.0.0.1")).not.toThrow();
    });
  });

  // ─── UDP socket methods (ported from SocketHelper) ───────

  describe("UDP socket methods", () => {
    test("udpData returns data from UDP socket", () => {
      const ctx = createUdpContext();
      ctx.setUDP(createMockUDPSocket());
      expect(ctx.udpData<{ custom: string }>()).toEqual({
        custom: "udp-data",
      });
    });

    test("udpName returns UDP socket name", () => {
      const ctx = createUdpContext();
      ctx.setUDP(createMockUDPSocket());
      expect(ctx.udpName).toBe("udp-sock");
    });

    test("udpAddress returns UDP socket address", () => {
      const ctx = createUdpContext();
      ctx.setUDP(createMockUDPSocket());
      const addr = ctx.udpAddress;
      expect(addr.address).toBe("0.0.0.0");
      expect(addr.port).toBe(9090);
    });

    test("udpClosed returns UDP socket closed state", () => {
      const ctx = createUdpContext();
      ctx.setUDP(createMockUDPSocket());
      expect(ctx.udpClosed).toBe(false);
    });

    test("sendUDP without port and address", () => {
      const ctx = createUdpContext();
      const udp = createMockUDPSocket();
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
      const result = ctx.sendUDP("data");
      expect(result).toBe(true);
      expect(sentData).toBe("data");
      expect(sentPort).toBeUndefined();
      expect(sentAddress).toBeUndefined();
    });

    test("sendUDP with port and address", () => {
      const ctx = createUdpContext();
      const udp = createMockUDPSocket();
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
      const result = ctx.sendUDP("data", 8080, "127.0.0.1");
      expect(result).toBe(true);
      expect(sentData).toBe("data");
      expect(sentPort).toBe(8080);
      expect(sentAddress).toBe("127.0.0.1");
    });

    test("sendUDP with port but no address falls back to send(data)", () => {
      const ctx = createUdpContext();
      const udp = createMockUDPSocket();
      let sentPort: number | undefined;
      (
        udp as unknown as {
          send: (d: string, p?: number, a?: string) => boolean;
        }
      ).send = (_d: string, p?: number, _a?: string) => {
        sentPort = p;
        return true;
      };
      ctx.setUDP(udp);
      const result = ctx.sendUDP("data", 8080);
      expect(result).toBe(true);
      expect(sentPort).toBeUndefined();
    });

    test("sendManyUDP calls UDP socket sendMany", () => {
      const ctx = createUdpContext();
      const udp = createMockUDPSocket();
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
      const result = ctx.sendManyUDP(["a", "b", "c"]);
      expect(result).toBe(3);
      expect(sentPackets).toEqual(["a", "b", "c"]);
    });

    test("addMembershipUDP calls UDP socket addMembership", () => {
      const ctx = createUdpContext();
      const udp = createMockUDPSocket();
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
      const result = ctx.addMembershipUDP("224.0.0.1", "0.0.0.0");
      expect(result).toBe(true);
      expect(multicastAddr).toBe("224.0.0.1");
      expect(ifaceAddr).toBe("0.0.0.0");
    });

    test("addMembershipUDP without interface address", () => {
      const ctx = createUdpContext();
      const udp = createMockUDPSocket();
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
      ctx.addMembershipUDP("224.0.0.1");
      expect(ifaceAddr).toBeUndefined();
    });

    test("dropMembershipUDP calls UDP socket dropMembership", () => {
      const ctx = createUdpContext();
      const udp = createMockUDPSocket();
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
      const result = ctx.dropMembershipUDP("224.0.0.1", "0.0.0.0");
      expect(result).toBe(true);
      expect(multicastAddr).toBe("224.0.0.1");
      expect(ifaceAddr).toBe("0.0.0.0");
    });

    test("dropMembershipUDP without interface address", () => {
      const ctx = createUdpContext();
      const udp = createMockUDPSocket();
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
      ctx.dropMembershipUDP("224.0.0.1");
      expect(ifaceAddr).toBeUndefined();
    });

    test("throws when no UDP socket attached", () => {
      const ctx = createUdpContext();
      expect(() => ctx.udpData()).toThrow(
        "Context is not attached to a UDP socket.",
      );
      expect(() => ctx.udpName).toThrow(
        "Context is not attached to a UDP socket.",
      );
      expect(() => ctx.udpAddress).toThrow(
        "Context is not attached to a UDP socket.",
      );
      expect(() => ctx.udpClosed).toThrow(
        "Context is not attached to a UDP socket.",
      );
      expect(() => ctx.sendUDP("data")).toThrow(
        "Context is not attached to a UDP socket.",
      );
      expect(() => ctx.sendManyUDP([])).toThrow(
        "Context is not attached to a UDP socket.",
      );
      expect(() => ctx.addMembershipUDP("224.0.0.1")).toThrow(
        "Context is not attached to a UDP socket.",
      );
      expect(() => ctx.dropMembershipUDP("224.0.0.1")).toThrow(
        "Context is not attached to a UDP socket.",
      );
    });
  });
});
