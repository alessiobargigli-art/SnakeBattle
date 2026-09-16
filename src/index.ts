import { DurableObject } from "cloudflare:workers";

type Side = "left" | "right";
type Direction = "up" | "down" | "left" | "right";
type RoomMode = "pvp" | "cpu";
type GameStatus = "waiting" | "playing" | "roundover";
type Point = { x: number; y: number };
type ClientMessage = { type: "turn"; direction: Direction } | { type: "ping" };

type Snapshot = {
  type: "state";
  code: string;
  mode: RoomMode;
  status: GameStatus;
  winner: Side | "draw" | null;
  tickMs: number;
  food: Point;
  left: Point[];
  right: Point[];
  leftDirection: Direction;
  rightDirection: Direction;
  leftRounds: number;
  rightRounds: number;
};

const GRID_W = 40;
const GRID_H = 22;
const DEFAULT_TICK_MS = 125;
const SPEEDS: Record<number, number> = { 1: 155, 2: 125, 3: 95 };
const OPPOSITE: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};
const DELTA: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/room/create" && request.method === "POST") {
      return Response.json({ code: randomCode() });
    }

    if (url.pathname.startsWith("/ws/")) {
      const code = url.pathname.split("/").pop()?.toUpperCase() ?? "";
      if (!/^[A-Z0-9]{6}$/.test(code)) {
        return new Response("Invalid room code", { status: 400 });
      }
      const id = env.ROOMS.idFromName(code);
      return env.ROOMS.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class SnakeRoom extends DurableObject<Env> {
  private sockets = new Map<WebSocket, Side>();
  private mode: RoomMode = "pvp";
  private status: GameStatus = "waiting";
  private code = "";
  private tickMs = DEFAULT_TICK_MS;
  private timer?: number;
  private resetAt = 0;
  private winner: Side | "draw" | null = null;
  private leftRounds = 0;
  private rightRounds = 0;
  private leftDirection: Direction = "right";
  private rightDirection: Direction = "left";
  private pendingLeft: Direction = "right";
  private pendingRight: Direction = "left";
  private left: Point[] = [];
  private right: Point[] = [];
  private food: Point = { x: 20, y: 11 };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.resetRound();
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const url = new URL(request.url);
    this.code = url.pathname.split("/").pop()?.toUpperCase() ?? this.code;

    if (this.sockets.size >= 2) {
      return new Response("Room full", { status: 409 });
    }

    if (this.sockets.size === 0) {
      this.mode = url.searchParams.get("mode") === "cpu" ? "cpu" : "pvp";
      this.tickMs = parseSpeed(url.searchParams.get("speed"));
      this.status = this.mode === "cpu" ? "playing" : "waiting";
      this.resetRound();
    } else if (this.mode === "cpu") {
      return new Response("CPU room already occupied", { status: 409 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    const side: Side = this.sockets.size === 0 ? "left" : "right";
    this.sockets.set(server, side);
    server.send(JSON.stringify({ type: "joined", side, code: this.code, mode: this.mode, tickMs: this.tickMs }));
    server.addEventListener("message", (event) => this.onMessage(server, event.data));
    server.addEventListener("close", () => this.onClose(server));
    server.addEventListener("error", () => this.onClose(server));

    if (this.mode === "pvp" && this.sockets.size === 2) {
      this.status = "playing";
      this.emit({ type: "sfx", name: "start" });
    }

    this.ensureLoop();
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(socket: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string") return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }

    if (msg.type === "ping") {
      socket.send(JSON.stringify({ type: "pong", t: Date.now() }));
      return;
    }

    if (msg.type !== "turn" || !isDirection(msg.direction)) return;
    const side = this.sockets.get(socket);
    if (side === "left" && msg.direction !== OPPOSITE[this.leftDirection]) {
      this.pendingLeft = msg.direction;
    }
    if (side === "right" && msg.direction !== OPPOSITE[this.rightDirection]) {
      this.pendingRight = msg.direction;
    }
  }

  private onClose(socket: WebSocket) {
    this.sockets.delete(socket);
    if (this.sockets.size === 0) {
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
      this.status = "waiting";
      this.leftRounds = 0;
      this.rightRounds = 0;
      this.resetRound();
      return;
    }
    if (this.mode === "pvp") {
      this.status = "waiting";
      this.winner = null;
    }
    this.broadcast();
  }

  private ensureLoop() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.tickMs) as unknown as number;
  }

  private tick() {
    if (this.status === "roundover") {
      if (Date.now() >= this.resetAt) {
        this.resetRound();
        this.status = this.mode === "cpu" || this.sockets.size === 2 ? "playing" : "waiting";
        if (this.status === "playing") this.emit({ type: "sfx", name: "start" });
      }
      this.broadcast();
      return;
    }

    if (this.status !== "playing") {
      this.broadcast();
      return;
    }

    this.leftDirection = this.safeDirection(this.leftDirection, this.pendingLeft);
    if (this.mode === "cpu") {
      this.pendingRight = this.chooseCpuDirection();
    }
    this.rightDirection = this.safeDirection(this.rightDirection, this.pendingRight);

    const nextLeft = move(this.left[0], this.leftDirection);
    const nextRight = move(this.right[0], this.rightDirection);
    const leftEats = same(nextLeft, this.food);
    const rightEats = same(nextRight, this.food);

    const leftBody = leftEats ? this.left : this.left.slice(0, -1);
    const rightBody = rightEats ? this.right : this.right.slice(0, -1);

    let leftDead = !inside(nextLeft) || hits(nextLeft, leftBody) || hits(nextLeft, rightBody);
    let rightDead = !inside(nextRight) || hits(nextRight, rightBody) || hits(nextRight, leftBody);

    if (same(nextLeft, nextRight)) {
      leftDead = true;
      rightDead = true;
    }

    if (leftDead || rightDead) {
      if (leftDead && rightDead) {
        this.winner = "draw";
      } else if (leftDead) {
        this.winner = "right";
        this.rightRounds++;
      } else {
        this.winner = "left";
        this.leftRounds++;
      }
      this.status = "roundover";
      this.resetAt = Date.now() + 2200;
      this.emit({ type: "sfx", name: "crash" });
      this.broadcast();
      return;
    }

    this.left.unshift(nextLeft);
    this.right.unshift(nextRight);
    if (!leftEats) this.left.pop();
    if (!rightEats) this.right.pop();

    if (leftEats || rightEats) {
      this.food = this.spawnFood();
      this.emit({ type: "sfx", name: "eat" });
    }

    this.broadcast();
  }

  private safeDirection(current: Direction, requested: Direction) {
    return requested === OPPOSITE[current] ? current : requested;
  }

  private chooseCpuDirection(): Direction {
    const head = this.right[0];
    const current = this.rightDirection;
    const candidates: Direction[] = ["up", "down", "left", "right"]
      .filter((d) => d !== OPPOSITE[current]) as Direction[];

    const occupied = [...this.left, ...this.right.slice(0, -1)];
    const safe = candidates.filter((d) => {
      const p = move(head, d);
      return inside(p) && !hits(p, occupied);
    });

    const pool = safe.length ? safe : candidates;
    pool.sort((a, b) => {
      const pa = move(head, a);
      const pb = move(head, b);
      return manhattan(pa, this.food) - manhattan(pb, this.food);
    });

    if (pool.length > 1 && Math.random() < 0.12) return pool[1];
    return pool[0] ?? current;
  }

  private resetRound() {
    this.leftDirection = "right";
    this.rightDirection = "left";
    this.pendingLeft = "right";
    this.pendingRight = "left";
    this.left = makeSnake({ x: 8, y: 7 }, "right", 6);
    this.right = makeSnake({ x: 31, y: 14 }, "left", 6);
    this.food = this.spawnFood();
    this.winner = null;
    this.resetAt = 0;
  }

  private spawnFood(): Point {
    const occupied = new Set([...this.left, ...this.right].map(key));
    for (let i = 0; i < 200; i++) {
      const p = {
        x: 2 + Math.floor(Math.random() * (GRID_W - 4)),
        y: 2 + Math.floor(Math.random() * (GRID_H - 4)),
      };
      if (!occupied.has(key(p))) return p;
    }
    return { x: Math.floor(GRID_W / 2), y: Math.floor(GRID_H / 2) };
  }

  private emit(message: unknown) {
    const payload = JSON.stringify(message);
    for (const socket of this.sockets.keys()) {
      try {
        socket.send(payload);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }

  private broadcast() {
    const snapshot: Snapshot = {
      type: "state",
      code: this.code,
      mode: this.mode,
      status: this.status,
      winner: this.winner,
      tickMs: this.tickMs,
      food: this.food,
      left: this.left,
      right: this.right,
      leftDirection: this.leftDirection,
      rightDirection: this.rightDirection,
      leftRounds: this.leftRounds,
      rightRounds: this.rightRounds,
    };
    this.emit(snapshot);
  }
}

function isDirection(value: unknown): value is Direction {
  return value === "up" || value === "down" || value === "left" || value === "right";
}

function parseSpeed(raw: string | null) {
  const speed = Number(raw);
  return SPEEDS[speed] ?? DEFAULT_TICK_MS;
}

function makeSnake(head: Point, direction: Direction, length: number) {
  const back = DELTA[OPPOSITE[direction]];
  return Array.from({ length }, (_, i) => ({ x: head.x + back.x * i, y: head.y + back.y * i }));
}

function move(point: Point, direction: Direction): Point {
  const d = DELTA[direction];
  return { x: point.x + d.x, y: point.y + d.y };
}

function inside(point: Point) {
  return point.x >= 0 && point.x < GRID_W && point.y >= 0 && point.y < GRID_H;
}

function same(a: Point, b: Point) {
  return a.x === b.x && a.y === b.y;
}

function hits(point: Point, body: Point[]) {
  return body.some((segment) => same(point, segment));
}

function manhattan(a: Point, b: Point) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function key(point: Point) {
  return `${point.x},${point.y}`;
}

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = new Uint32Array(6);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
}
