import { describe, expect, test } from "bun:test";
import { TcpContext, type TCPData } from "../../src/context/tcp-context";
import { ErrorHandler } from "../../src/error-handler";
import type { Socket } from "bun";

function createTcpContext(): TcpContext {
  return new TcpContext({ errorHandler: new ErrorHandler() });
}

function createMockTCPSocket(
  name: string = "tcp-conn",
  data: unknown = { custom: "tcp-data" },
): Socket<TCPData> {
  return {
    data: { name, data },
    remoteAddress: "192.168.1.1:8080",
    localAddress: "10.0.0.1:3000",
    write: () => 0,
    end: () => 0,
    flush: () => {},
    timeout: () => {},
  } as unknown as Socket<TCPData>;
}

describe("TcpContext", () => {
  // ─── Skeleton tests ──────────────────────────────────────

  test("has the tcp protocol tag", () => {
    const ctx = createTcpContext();
    expect(ctx.protocol).toBe("tcp");
  });

  test("setTCP() attaches the socket", () => {
    const ctx = createTcpContext();
    const socket = createMockTCPSocket();
    ctx.setTCP(socket);
    expect(ctx.tcp).toBe(socket);
  });

  test("reset() clears the socket and shared state", () => {
    const ctx = createTcpContext();
    ctx.setTCP(createMockTCPSocket());
    ctx.set("key", "value");
    ctx.reset({ errorHandler: new ErrorHandler() });
    expect(ctx.tcp).toBeUndefined();
    expect(ctx.has("key")).toBe(false);
  });

  // ─── TCP socket methods ──────────────────────────────────

  describe("TCP socket methods", () => {
    test("tcpData returns data from TCP socket", () => {
      const ctx = createTcpContext();
      ctx.setTCP(createMockTCPSocket());
      expect(ctx.tcpData<{ custom: string }>()).toEqual({
        custom: "tcp-data",
      });
    });

    test("tcpName returns TCP socket name", () => {
      const ctx = createTcpContext();
      ctx.setTCP(createMockTCPSocket());
      expect(ctx.tcpName).toBe("tcp-conn");
    });

    test("tcpRemoteAddress returns TCP remoteAddress", () => {
      const ctx = createTcpContext();
      ctx.setTCP(createMockTCPSocket());
      expect(ctx.tcpRemoteAddress).toBe("192.168.1.1:8080");
    });

    test("tcpLocalAddress returns TCP localAddress", () => {
      const ctx = createTcpContext();
      ctx.setTCP(createMockTCPSocket());
      expect(ctx.tcpLocalAddress).toBe("10.0.0.1:3000");
    });

    test("write calls TCP socket write", () => {
      const ctx = createTcpContext();
      const tcp = createMockTCPSocket();
      let writtenData: string | undefined;
      (tcp as unknown as { write: (d: string) => number }).write = (
        d: string,
      ) => {
        writtenData = d;
        return d.length;
      };
      ctx.setTCP(tcp);
      const result = ctx.write("hello");
      expect(result).toBe(5);
      expect(writtenData).toBe("hello");
    });

    test("write with byteOffset and byteLength", () => {
      const ctx = createTcpContext();
      const tcp = createMockTCPSocket();
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
      ctx.write("data", 2, 4);
      expect(offset).toBe(2);
      expect(length).toBe(4);
    });

    test("end calls TCP socket end", () => {
      const ctx = createTcpContext();
      const tcp = createMockTCPSocket();
      let ended = false;
      (tcp as unknown as { end: () => number }).end = () => {
        ended = true;
        return 0;
      };
      ctx.setTCP(tcp);
      ctx.end();
      expect(ended).toBe(true);
    });

    test("end with data", () => {
      const ctx = createTcpContext();
      const tcp = createMockTCPSocket();
      let endData: string | undefined;
      (tcp as unknown as { end: (d?: string) => number }).end = (
        d?: string,
      ) => {
        endData = d;
        return 0;
      };
      ctx.setTCP(tcp);
      ctx.end("goodbye");
      expect(endData).toBe("goodbye");
    });

    test("end with byteOffset and byteLength", () => {
      const ctx = createTcpContext();
      const tcp = createMockTCPSocket();
      let offset: number | undefined;
      let length: number | undefined;
      (
        tcp as unknown as {
          end: (d?: string, o?: number, l?: number) => number;
        }
      ).end = (_d?: string, o?: number, l?: number) => {
        offset = o;
        length = l;
        return 0;
      };
      ctx.setTCP(tcp);
      ctx.end("data", 2, 4);
      expect(offset).toBe(2);
      expect(length).toBe(4);
    });

    test("flush calls TCP socket flush", () => {
      const ctx = createTcpContext();
      const tcp = createMockTCPSocket();
      let flushed = false;
      (tcp as unknown as { flush: () => void }).flush = () => {
        flushed = true;
      };
      ctx.setTCP(tcp);
      ctx.flush();
      expect(flushed).toBe(true);
    });

    test("timeout calls TCP socket timeout", () => {
      const ctx = createTcpContext();
      const tcp = createMockTCPSocket();
      let timeoutValue: number | undefined;
      (tcp as unknown as { timeout: (s: number) => void }).timeout = (
        s: number,
      ) => {
        timeoutValue = s;
      };
      ctx.setTCP(tcp);
      ctx.timeout(30);
      expect(timeoutValue).toBe(30);
    });

    test("write, end, flush, timeout do not throw with plain mock", () => {
      const ctx = createTcpContext();
      ctx.setTCP(createMockTCPSocket());
      expect(() => ctx.write("data")).not.toThrow();
      expect(() => ctx.end()).not.toThrow();
      expect(() => ctx.flush()).not.toThrow();
      expect(() => ctx.timeout(30)).not.toThrow();
    });
  });

  // ─── Guards ──────────────────────────────────────────────

  describe("throws when no TCP socket attached", () => {
    test("all TCP accessors throw", () => {
      const ctx = createTcpContext();
      expect(() => ctx.tcpData()).toThrow(
        "Context is not attached to a TCP socket.",
      );
      expect(() => ctx.tcpName).toThrow(
        "Context is not attached to a TCP socket.",
      );
      expect(() => ctx.tcpRemoteAddress).toThrow(
        "Context is not attached to a TCP socket.",
      );
      expect(() => ctx.tcpLocalAddress).toThrow(
        "Context is not attached to a TCP socket.",
      );
      expect(() => ctx.write("data")).toThrow(
        "Context is not attached to a TCP socket.",
      );
      expect(() => ctx.end()).toThrow(
        "Context is not attached to a TCP socket.",
      );
      expect(() => ctx.flush()).toThrow(
        "Context is not attached to a TCP socket.",
      );
      expect(() => ctx.timeout(10)).toThrow(
        "Context is not attached to a TCP socket.",
      );
    });

    test("guard throws again after reset clears the socket", () => {
      const ctx = createTcpContext();
      ctx.setTCP(createMockTCPSocket());
      expect(ctx.tcpName).toBe("tcp-conn");
      ctx.reset({ errorHandler: new ErrorHandler() });
      expect(() => ctx.tcpName).toThrow(
        "Context is not attached to a TCP socket.",
      );
    });
  });
});
