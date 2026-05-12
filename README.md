# ECU File Skinner Pro

Desktop application that automates the organization and archiving of raw ECU dump files into a clean, hierarchical folder structure based on detected vehicle and hardware metadata.

## Features

- **Drag & drop** raw ECU files (`.bin`, `.ori`, `.mod`, `.frf`, `.sgo`, `.kp`)
- **Auto-detection** of manufacturer signatures (Bosch, Continental, Siemens, Delphi, Denso, Marelli, Visteon)
- **HW/SW ID extraction** including VAG box numbers and VIN
- **Protocol heuristics** (OBD / BENCH / BOOT) from file size + content markers
- **Custom format mask** for file naming using tokens like `[BRAND]_[MODEL]_[HW]_[STAGE].bin`
- **Hierarchical archive**: `/Brand/Model/ECU/file.bin`
- **SQLite database** indexes every processed file for fast searching
- **Checksum tool** (MD5 + byte sum)
- **Dashboard** with top brands, ECU types, and recent activity
- **Confidence scoring** per detection

## Tech Stack

- Electron 33 (main + renderer with `contextIsolation` + preload)
- `better-sqlite3` for the local index
- Vanilla JS renderer — no build step required

## Getting Started

```bash
npm install
npm start
```

## Build distributables

```bash
npm run build:linux   # AppImage + .deb
npm run build:win     # NSIS installer
npm run build:mac     # DMG
```

## Tests

Two complementary suites:

```bash
# Unit/parser tests (Vitest, plain Node — fast, no display required)
npm test

# End-to-end UI tests (Playwright + Electron)
#  - Requires a one-time browser install: `npx playwright install chromium`
#  - Linux: wrap with xvfb-run if no X server is available (CI).
DISPLAY=:0 npm run test:e2e
xvfb-run -a --server-args="-screen 0 1280x1024x24" npm run test:e2e   # headless

# Interactive debugging
DISPLAY=:0 npm run test:e2e:ui      # Playwright's test UI
DISPLAY=:0 npm run test:e2e:debug   # PWDEBUG=1 step-through
```

The Playwright suite spins the real Electron app under a private `userData`
directory + archive root, so it never touches your real database or
`~/Documents/ECU_Archive`. Specs live under `tests/e2e/*.spec.js`.

## Folder layout

```
src/
  main/
    main.js            # Electron entry point, IPC handlers
    preload.js         # Context bridge
    ecu-parser.js      # Binary signature scanning
    database.js        # SQLite schema + queries
    file-organizer.js  # Folder creation + rename
  renderer/
    index.html
    styles.css
    renderer.js
```

The user's organized archive lives at `~/Documents/ECU_Archive` by default (configurable in Settings).
