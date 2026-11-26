import { createServer, type Server, type ServerResponse } from "node:http";
import type { Board } from "./board.ts";
import { renderPage } from "./render.ts";

export type ServerOptions = {
  board: { snapshot(nowMs: number): Promise<Board> };
  host: string;
  port: number;
};

function send(response: ServerResponse, status: number, contentType: string, body: string): void {
  response.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  response.end(body);
}

export function startServer(options: ServerOptions): Promise<Server> {
  const server = createServer((request, response) => {
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
