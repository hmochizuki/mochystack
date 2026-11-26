import { createServer, type Server, type ServerResponse } from "node:http";
import { isIPv6 } from "node:net";
import { networkInterfaces } from "node:os";
import type { Board } from "./board.ts";
import { renderPage } from "./render.ts";

export type ServerOptions = {
  board: { snapshot(nowMs: number): Promise<Board> };
  host: string;
  port: number;
  allowedHosts: string[];
};

function send(response: ServerResponse, status: number, contentType: string, body: string): void {
  response.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  response.end(body);
}

function hostnameOf(host: string): string | undefined {
  try {
    return new URL(`http://${isIPv6(host) ? `[${host}]` : host}`).hostname;
  } catch {
    return undefined;
  }
}

function answeredHosts(options: ServerOptions): string[] {
  const bound = ["0.0.0.0", "::"].includes(options.host)
    ? Object.values(networkInterfaces()).flatMap((addresses) => (addresses ?? []).map((address) => address.address))
    : [options.host];
  return ["localhost", "127.0.0.1", "::1", ...bound, ...options.allowedHosts];
}

function answersHost(hostHeader: string | undefined, options: ServerOptions): boolean {
  const requested = hostHeader === undefined ? undefined : hostnameOf(hostHeader);
  return requested !== undefined && answeredHosts(options).some((host) => hostnameOf(host) === requested);
}

export function startServer(options: ServerOptions): Promise<Server> {
  const server = createServer((request, response) => {
    if (!answersHost(request.headers.host, options)) {
      send(response, 403, "text/plain; charset=utf-8", "この Host では応答しない。使う名前を USAGE_BOARD_ALLOWED_HOSTS に足す");
      return;
    }
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path !== "/" && path !== "/api/board") {
      send(response, 404, "text/plain; charset=utf-8", "not found");
      return;
    }
    if (request.method !== "GET") {
      send(response, 405, "text/plain; charset=utf-8", "method not allowed");
      return;
    }
    options.board.snapshot(Date.now()).then(
      (board) =>
        path === "/"
          ? send(response, 200, "text/html; charset=utf-8", renderPage(board))
          : send(response, 200, "application/json; charset=utf-8", JSON.stringify(board)),
      (error: unknown) => send(response, 500, "text/plain; charset=utf-8", String(error)),
    );
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => resolve(server));
  });
}
