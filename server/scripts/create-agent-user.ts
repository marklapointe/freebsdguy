/**
 * Create a passwordless MCP-only agent account and print its personal access token.
 *
 *   npm run --silent create-agent-user -- --username ampere-mcp --scope read,content:write
 *
 * `npm run` prints its own banner lines on stdout, and those lines would land in
 * the token file; `--silent` keeps stdout to the token alone. The direct form
 * prints no banner at all:
 *
 *   npx tsx server/scripts/create-agent-user.ts --username ampere-mcp --scope read,content:write
 *
 * The account has no password and can never log in on the web. The token is
 * printed on stdout and nothing else, and only when stdout is a pipe, so it can
 * go straight into a secret store:
 *
 *   npm run --silent create-agent-user -- --username ampere-mcp --scope read > ~/.creds/ampere.token
 */
import { runCreateAgentUser } from '../lib/agent-user-cli.ts';

const code = runCreateAgentUser({
    argv: process.argv.slice(2),
    stdout: (chunk) => process.stdout.write(chunk),
    stderr: (chunk) => process.stderr.write(chunk),
    isTTY: Boolean(process.stdout.isTTY)
});

// process.exitCode, not process.exit(): a write to a pipe is asynchronous and
// process.exit() would truncate the token that was just written.
process.exitCode = code;
