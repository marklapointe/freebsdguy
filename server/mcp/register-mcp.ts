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
import { argsSha256, resolveAuditSite } from '../lib/audit-context.ts';
import { KNOWN_MCP_TOOLS } from '../lib/token-scope.ts';
import { mcpToolCalls } from '../lib/rate-limit.ts';

export function registerMcpRoutes(app: Express, ctx: AppContext): void {
    const { authenticate, getActiveConfig, setActiveConfig } = ctx;

    const handleMcp = async (req: AuthenticatedRequest, res: Response) => {
        const username = req.user?.username;
        const role = req.user?.role;
        if (!username || !isAllowedRole(role)) {
            return res.status(403).json({ message: 'Forbidden' });
        }

        const site = resolveAuditSite(getActiveConfig());
        const scopes = req.tokenScopes ? [...req.tokenScopes] : [];
        const fields = {
            ...(req.tokenId ? { tokenId: req.tokenId } : {}),
            ...(req.authVia ? { via: req.authVia } : {}),
            ...(req.ip ? { ip: req.ip } : {}),
            ...(site ? { site } : {})
        };

        const server = createMdwebMcpServer({
            user: { username, role: role as Role },
            getActive: getActiveConfig,
            setActive: setActiveConfig,
            tokenScopes: req.tokenScopes,
            audit: {
                ...(req.tokenId ? { tokenId: req.tokenId } : {}),
                ...(req.authVia ? { via: req.authVia } : {}),
                ...(req.ip ? { ip: req.ip } : {}),
                ...(site ? { site } : {}),
                scopes
            }
        });

        // The row of a tool call is written by the tool itself, so a call that
        // never reaches a tool needs one here: a tool the role may not run is
        // not registered at all, and a tool nobody knows is an error.
        const registered =
            (server as unknown as { _registeredTools?: Record<string, unknown> })._registeredTools || {};
        for (const call of mcpToolCalls(req.body)) {
            if (call.name && registered[call.name]) continue;
            const known = KNOWN_MCP_TOOLS.has(call.name);
            writeAudit({
                event: 'mcp',
                tool: call.name || 'unknown',
                scopes: [...scopes],
                argsSha256: argsSha256(call.args),
                outcome: known ? 'denied' : 'error',
                reason: known ? 'role' : 'unknown_tool',
                username,
                ...fields
            });
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
