#!/usr/bin/env node
// MCP server entry point.
//
// Register with an agent, e.g. in claude_desktop_config.json:
//   { "mcpServers": { "vetpkg": { "command": "npx", "args": ["-y", "vetpkg-mcp"] } } }
import { serve } from '../src/mcp.js';

serve();
