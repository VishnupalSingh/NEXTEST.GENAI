import { spawn, ChildProcess } from 'child_process';

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

interface JSONRPCMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Minimal JSON-RPC MCP client that communicates with the @playwright/mcp server
 * over stdin/stdout (newline-delimited JSON). No external SDK required.
 */
export interface MCPClientOptions {
  /** Per-request timeout for JSON-RPC calls (ms). */
  requestTimeoutMs?: number;
  /** Grace period after spawn before the handshake (ms). */
  startupGraceMs?: number;
}

export class PlaywrightMCPClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private lineBuffer = '';
  private readonly requestTimeoutMs: number;
  private readonly startupGraceMs: number;

  constructor(options: MCPClientOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.startupGraceMs = options.startupGraceMs ?? 600;
  }

  /**
   * Start the Playwright MCP server and perform the MCP handshake.
   * @param headless Run the browser in headless mode (default: true)
   */
  async connect(headless = true): Promise<void> {
    const mcpArgs = headless ? ['--headless'] : [];

    this.proc = spawn('npx', ['@playwright/mcp', ...mcpArgs], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      shell: process.platform === 'win32',
    });

    if (!this.proc.stdout || !this.proc.stdin) {
      throw new Error('Failed to open stdio pipes to Playwright MCP server');
    }

    this.proc.stdout.on('data', (chunk: Buffer) => {
      this.lineBuffer += chunk.toString('utf-8');
      let idx: number;
      while ((idx = this.lineBuffer.indexOf('\n')) !== -1) {
        const line = this.lineBuffer.slice(0, idx).trim();
        this.lineBuffer = this.lineBuffer.slice(idx + 1);
        if (line.startsWith('{')) {
          this.handleLine(line);
        }
      }
    });

    this.proc.stderr?.on('data', (chunk: Buffer) => {
      if (process.env.GENIE_DEBUG) {
        process.stderr.write(`[MCP] ${chunk.toString()}`);
      }
    });

    this.proc.on('error', (err) => {
      this.rejectAll(err);
    });

    // Brief pause for the process to start
    await this.sleep(this.startupGraceMs);

    // MCP initialisation handshake
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'nextest-genie', version: '1.0.0' },
    });

    // Notify server that init is complete (no response expected)
    this.notify('notifications/initialized', {});
  }

  /** List all tools exposed by the Playwright MCP server. */
  async listTools(): Promise<MCPTool[]> {
    const result = (await this.request('tools/list', {})) as { tools?: MCPTool[] };
    return result?.tools ?? [];
  }

  /** Execute a named MCP tool with the given arguments. */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request('tools/call', { name, arguments: args });
  }

  /** Shut down the MCP server process. */
  async close(): Promise<void> {
    this.rejectAll(new Error('MCP client closed'));
    this.proc?.kill('SIGTERM');
    this.proc = null;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private handleLine(line: string): void {
    try {
      const msg = JSON.parse(line) as JSONRPCMessage;
      if (msg.id !== undefined) {
        const entry = this.pending.get(msg.id);
        if (entry) {
          clearTimeout(entry.timer);
          this.pending.delete(msg.id);
          if (msg.error) {
            entry.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
          } else {
            entry.resolve(msg.result);
          }
        }
      }
    } catch {
      // Non-JSON line — ignore
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request "${method}" timed out after ${this.requestTimeoutMs}ms`));
        }
      }, this.requestTimeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  private send(msg: JSONRPCMessage): void {
    if (!this.proc?.stdin) {
      throw new Error('Playwright MCP server is not connected');
    }
    this.proc.stdin.write(JSON.stringify(msg) + '\n');
  }

  private rejectAll(err: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
