/**
 * Mount Streamable HTTP MCP at /mcp (authenticated).
 */
import type { Express, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AppContext } from '../lib/app-context.ts';
import type { AuthenticatedRequest } from '../middleware/auth.ts';
import { isAllowedRole, type Role } from '../middleware/auth.ts';
import { createMdwebMcpServer } from './create-server.ts';
import { writeAudit } from '../lib/audit-log.ts';

export function registerMcpRoutes(app: Express, ctx: AppContext): void {
    const { authenticate, getActiveConfig, setActiveConfig } = ctx;

    const handleMcp = async (req: AuthenticatedRequest, res: Response) => {
        const username = req.user?.username;
        const role = req.user?.role;
        if (!username || !isAllowedRole(role)) {
            return res.status(403).json({ message: 'Forbidden' });
        }

        const server = createMdwebMcpServer({
            user: { username, role: role as Role },
            getActive: getActiveConfig,
            setActive: setActiveConfig,
            tokenScope: req.tokenScope
        });
        const rpc = req.body as { method?: string; params?: { name?: string } } | undefined;
        if (rpc?.method === 'tools/call') {
            const tool = typeof rpc.params?.name === 'string' ? rpc.params.name : 'unknown';
            writeAudit({ event: 'mcp', tool, username, outcome: 'accepted' });
        }

        try {
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
                // JSON responses work with simple HTTP clients (tests, curl) and Cursor HTTP MCP
                enableJsonResponse: true
            });
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
            res.on('close', () => {
                void transport.close();
                void server.close();
            });
        } catch (error) {
            console.error('[MCP] request failed:', error);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: { code: -32603, message: 'Internal server error' },
                    id: null
                });
            }
        }
    };

    app.post('/mcp', authenticate, (req, res) => {
        void handleMcp(req as AuthenticatedRequest, res);
    });

    // Stateless mode: GET/DELETE not used for SSE sessions
    app.get('/mcp', authenticate, (_req, res) => {
        res.status(405).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Method not allowed. Use POST for Streamable HTTP.' },
            id: null
        });
    });

    app.delete('/mcp', authenticate, (_req, res) => {
        res.status(405).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Method not allowed.' },
            id: null
        });
    });
}
