# SlideCraft MCP App

Create AI-powered slide decks directly from Claude Desktop — no browser needed.

> **Quick install:** Tell Claude Desktop:
> *"Read https://raw.githubusercontent.com/dwinter3/slidecraft-mcp/main/SETUP.md and install SlideCraft for me. My API key is `csk_YOUR_KEY_HERE`."*

## What You Can Do

After setup, say things like:

- *"Create a 10-slide investor pitch about our Q4 results in blueprint style"*
- *"Make me a TED Talk deck about why AI partnerships matter"*
- *"List my SlideCraft decks"*

An interactive build monitor renders inline in your conversation, showing slides as they generate with live progress and QA scores.

## Manual Setup

### 1. Clone and build

```bash
git clone https://github.com/dwinter3/slidecraft-mcp.git
cd slidecraft-mcp
npm install
npm run build
```

### 2. Add to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows).

Add to `mcpServers`:

```json
{
  "mcpServers": {
    "slidecraft": {
      "command": "node",
      "args": ["/FULL/PATH/TO/slidecraft-mcp/dist/server.js", "--stdio"],
      "env": {
        "SLIDECRAFT_API_URL": "https://slidecraft.alpha-pm.dev",
        "SLIDECRAFT_API_KEY": "csk_YOUR_API_KEY_HERE"
      }
    }
  }
}
```

### 3. Restart Claude Desktop

Cmd+Q, reopen. Look for "SlideCraft" in the hammer icon menu.

## Visual Styles

37 styles available including: `bold_corporate`, `ted_talk`, `minimal_clean`, `blueprint`, `neon_cyberpunk`, `retro_80s`, `watercolor`, `terminal_hacker`, `kittens`, `isometric`, `art_deco`, `space_cosmic`, `pixel_art`, `bloomberg_keynote`, and more.

## Requirements

- Node.js 18+
- Claude Desktop
- SlideCraft API key (starts with `csk_`)

## License

MIT
