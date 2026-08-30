#!/usr/bin/env node
// MCP server entry point.
//
// Register with an agent, e.g. in claude_desktop_config.json:
//   { "mcpServers": { "pkgguard": { "command": "npx", "args": ["-y", "pkgguard-mcp"] } } }
import { serve } from '../src/mcp.js';

serve();
