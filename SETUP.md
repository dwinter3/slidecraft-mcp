# SlideCraft MCP App — Setup Guide

> **For Claude Desktop:** If a user asks you to install SlideCraft, follow the steps below. Run the shell commands, edit the config file, then tell the user to restart Claude Desktop.

## Step 1: Clone and build

Run these commands:

```bash
git clone https://github.com/dwinter3/slidecraft-mcp.git ~/slidecraft-mcp
cd ~/slidecraft-mcp
npm install
npm run build
```

Verify the build succeeded:

```bash
test -f ~/slidecraft-mcp/dist/server.js && echo "Build OK" || echo "Build FAILED"
```

## Step 2: Add to Claude Desktop config

Read the user's Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

If the file doesn't exist, create it. If it exists, read it first and preserve all existing content.

Add a `"slidecraft"` entry inside the `"mcpServers"` object. If `"mcpServers"` doesn't exist, create it.

The entry to add (use the user's home directory for the path):

```json
"slidecraft": {
  "command": "node",
  "args": ["HOME_DIR/slidecraft-mcp/dist/server.js", "--stdio"],
  "env": {
    "SLIDECRAFT_API_URL": "https://fye60j6dqb.execute-api.us-east-1.amazonaws.com",
    "SLIDECRAFT_API_KEY": "USER_API_KEY"
  }
}
```

Replace:
- `HOME_DIR` with the user's actual home directory (e.g., `/Users/username` on macOS)
- `USER_API_KEY` with the API key the user provided (starts with `csk_`)

**Do NOT delete or overwrite existing mcpServers entries.**

## Step 3: Tell the user to restart

Say this to the user:

> SlideCraft is installed! Please restart Claude Desktop now (Cmd+Q on macOS, then reopen it). After restarting, you'll see "SlideCraft" when you click the hammer icon in the chat input. Then just ask me to create a deck!

## After Restart — How to Use

### Creating a deck

The user just describes what they want:

> "Create a slide deck about our product launch. 8 slides, blueprint style, for executives."

Call the `create-deck` tool with these parameters:
- `topic` (required) — what the deck is about
- `audience` — executives, investors, cofounder, technical, board, sales, customers, partners, general
- `vibe` — bold_corporate, ted_talk, minimal_clean, blueprint, neon_cyberpunk, retro_80s, watercolor, terminal_hacker, kittens, isometric, art_deco, space_cosmic, pixel_art, nature_organic, bloomberg_keynote (37 total)
- `slideCount` — 3 to 20 (default 8)

### Listing decks

Call the `list-decks` tool (no parameters).

### Example prompts

- "Create a pitch deck for our Series A — 12 slides, minimal clean, for investors"
- "Make a TED Talk deck about why AI partnerships are cloud partnerships"
- "Build me a retro 80s deck about our engineering architecture"
- "Create a kittens-themed deck about our Q1 board update"
- "List my decks"

## Troubleshooting

- **node not found:** The user needs Node.js 18+. Have them run `node --version` to check.
- **npm install fails:** Try `npm install --legacy-peer-deps`.
- **Server not showing after restart:** Check the config file is valid JSON (no trailing commas, matching braces).
- **API errors:** Verify the API key starts with `csk_` and was entered correctly.
