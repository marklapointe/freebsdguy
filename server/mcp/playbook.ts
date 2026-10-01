/** In-band MCP playbook for cold-start agents. */
export const MDWEB_MCP_PLAYBOOK = `# MDWeb MCP playbook

## Auth
Every request requires \`Authorization: Bearer <pat>\` where the PAT was minted in Admin → Tokens (\`mdw_…\`).
The token acts as the owning user: contributors manage posts/images; admins also manage config, themes, users, and tokens.

## Common workflows
1. **List then edit a post:** \`list_posts\` → \`get_post\` → \`update_post\` (or \`create_post\` with a new slug).
2. **Publish with AI help:** \`ai_enhance\` / \`ai_summarize\` on draft markdown, then \`create_post\` / \`update_post\`.
3. **Site branding (admin):** \`get_config\` → \`update_config\` (siteName, theme, security toggles).
4. **Images:** \`upload_image\` (base64) → use returned filename in markdown as \`/api/getimage?fileName=…\`.
5. **Tokens:** \`list_tokens\` / \`create_token\` / \`revoke_token\` (own tokens; admin may target any user).

## Rules
- Never put the PAT or passwords in tool arguments or prompts — configure the client with the Bearer header.
- Slugs should be URL-safe; empty slug is rejected.
- AI tools honor site \`disableAI\` / \`aiConfig.enabled\`.
- Prefer \`get_playbook\` when unsure which tool to call.
`;

export const MDWEB_MCP_INSTRUCTIONS =
    'MDWeb site control via MCP. Authenticate with a personal access token (mdw_…). ' +
    'Call get_playbook for workflows. Tools are role-gated to the token owner.';
