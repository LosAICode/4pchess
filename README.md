# 4 Player Chess Engine

A [4-player teams chess](https://www.chess.com/terms/4-player-chess) engine with a web-based UI for playing and analyzing games.

## What can you do with it?

- Play against the engine
- Analyze your games (paste PGN from chess.com 4PC)
- Explore variations without losing the main line
- View engine evaluation with Stockfish-style analysis panel
- Rotate the board to view from any player's perspective

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| **Node.js** | 18+ | [Download](https://nodejs.org/) |
| **Python** | 3.x | Required by node-gyp for compiling C++ |
| **C++ build tools** | — | See below |

### C++ Build Tools

The engine is written in C++ and compiled as a native Node.js addon via `node-gyp`.

**Windows:**
```
npm install -g windows-build-tools
```
Or install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload.

**macOS:**
```
xcode-select --install
```

**Linux (Ubuntu/Debian):**
```
sudo apt install build-essential python3
```

## Installation

```bash
# 1. Clone the repo
git clone https://github.com/LosAICode/4pchess.git
cd 4pchess

# 2. Install Node.js dependencies
cd ui
npm install

# 3. Build the C++ engine addon
npx node-gyp rebuild

# 4. Start the server
node app.js
```

Open **http://localhost:3333** in your browser.

## Usage

### Play against the engine

- Click or drag pieces to make moves
- The engine evaluates every position automatically
- Press the **bot icon** (⚙) in the nav bar to play the engine's suggested move
- Use **Space** key as a shortcut for the engine move

### Load a game from chess.com

1. Copy a PGN from a chess.com 4-player chess game
2. Paste it into the PGN textarea at the bottom of the sidebar
3. The game loads automatically — click any move to jump to that position

### Navigation

| Control | Action |
|---------|--------|
| `←` / `→` | Back / forward 1 move |
| `↑` / `↓` | Back / forward 4 moves |
| `Home` / `End` | Jump to start / end |
| `Space` | Play engine move |
| ▶ button | Auto-play moves (1 per second) |
| 🔄 button | Rotate board (Red → Blue → Yellow → Green) |

### Analyze variations

Play a different move at any point to create a variation branch. The main line is preserved — you can click any move in the history to jump back. Close a variation with the **×** button.

### Settings

- **Max depth** — limit engine search depth
- **Max secs per move** — limit engine thinking time

Settings persist across sessions.

## Command Line / UCI

The engine also supports the UCI [protocol](https://gist.github.com/DOBRO/2592c6dad754ba67e6dcaec8c90165bf).

```bash
# Build with Bazel
bazel build -c opt cli

# Or with Make
make cli

# Run
./cli
```

Then use standard UCI commands:
```
go                          # analyze from start position
position fen <FEN>          # set position
go                          # analyze
```

## Code Organization

| Path | Description |
|------|-------------|
| `board.h/cc` | Board representation and move generation |
| `player.h/cc` | Player classes |
| `transposition_table.h/cc` | Transposition table for search |
| `move_picker.h/cc` | Move ordering |
| `ui/` | Web UI (Express.js + native C++ addon) |
| `ui/cpp/` | Node.js ↔ C++ bridge (V8 API) |
| `ui/public/javascripts/` | Frontend JS (board rendering, PGN parser) |
| `ui/public/stylesheets/` | CSS (dark theme) |
| `ui/routes/` | Express routes + engine worker thread |

## Running Tests

```bash
# All unit tests
bazel test -c opt :all

# Performance test
bazel test -c opt speed_test --test_output=all
```

## Troubleshooting

**`node-gyp rebuild` fails:**
- Ensure you have C++ build tools installed (see Prerequisites)
- On Windows, run from a "Developer Command Prompt" or ensure `msbuild` is in PATH
- Try `npx node-gyp rebuild --verbose` to see detailed errors

**Port 3333 already in use:**
- Kill the existing process or change the port in `ui/app.js`

**PGN doesn't load:**
- Ensure it's a chess.com 4-player chess PGN format
- Check the red error message below the PGN textarea for details

## Credits

- Engine by [obryanlouis](https://github.com/obryanlouis/4pchess)
- UI overhaul by LosChess
