# Batch Artboard Exporter HQ

A script for **Affinity Designer / Photo / Publisher (v2.6+)** that exports every artboard in your document as an individual file — in one run, at high quality, without touching your document.

Built for the [Affinity Script Manager](https://github.com/JiriKrblich/Affinity-script-manager) ecosystem but works as a standalone script too.

## Features

- **One file per artboard** — each artboard is exported individually through its own export area (no slicing, no merged output)
- **All or selected artboards** — export the whole document or just the artboards you pick in the Layers panel
- **High quality formats** — lossless PNG/TIFF, best-quality JPEG, or fully scalable vector SVG/PDF
- **Multi-format in one run** — tick several formats and get every artboard in each of them
- **Resolution control** — 1x / 2x / 3x / 4x multipliers, or print-grade **300 / 600 DPI** sizing computed from each artboard's physical dimensions
- **Stress-free by design** — never modifies your document (no duplicate nodes, no visibility toggles, no selection changes), each artboard exports in its own error boundary, one failure never stops the batch
- **Collision-safe filenames** — duplicate artboard names get numbered suffixes; optional artboard-order numbering (`01_`, `02_`…) for correct sorting
- **Skip existing files** — optional incremental mode re-exports only what's missing
- **Run report** — per-format counts, total size, elapsed time, and a full list of any failures

## Requirements

- Affinity **2.6 or later** (Desktop) — the release that introduced scripting and the Scripts panel
- No other dependencies

## Install

### Via Affinity Script Manager (recommended)

1. In the Script Manager: **Add Script** → select `batch-artboard-exporter-hq.js` (or drag & drop it onto the window) → **Save & install**
2. In Affinity, make sure **MCP** is enabled and the Scripts panel has at least one category (`Window → General → Scripts → Create New Category`)
3. Click the grey install dot next to *Batch Artboard Exporter HQ* in **My Scripts → Local** — it turns green when live

### Manually

Copy `batch-artboard-exporter-hq.js` into Affinity's scripts location and it appears in the Scripts panel:

- **Windows:** `%APPDATA%\Affinity\<AppName>\2.0\user\scripts\`
- **macOS:** `~/Library/Application Support/Affinity/<AppName>/2.0/user/scripts/`

## Usage

1. Open a document containing artboards
2. *(Optional)* Select specific artboards in the Layers panel to export only those
3. Run the script from the Scripts panel
4. Configure the dialog:

| Option | What it does |
|---|---|
| **Formats** | Tick any of PNG / JPEG / TIFF / SVG / PDF. Disabled formats have no matching preset in your Affinity installation |
| **Resolution** | Pixel multiplier (1x–4x) or print DPI (300/600). Applies to raster formats; SVG/PDF are vector and always sharp at native size |
| **Scope** | All artboards, or only the currently selected ones |
| **Prefix** | Optional prefix for all filenames |
| **Number files** | Prepends `01_`, `02_`… in artboard order so files sort correctly |
| **Skip existing** | Leaves files that already exist untouched (incremental re-runs) |
| **Sub-folder** | Writes to `Desktop\<sub-folder>` instead of the Desktop root |

5. Click **OK** — a summary dialog reports everything that happened

### Output

Files are written to the Desktop (Affinity's scripting sandbox only permits Desktop writes), named:

```
<prefix>_<order>_<ArtboardName>.<ext>
Hero Banner_01_Home.png
Hero Banner_01_Home.pdf
```

## Formats & quality

| Format | Quality | Notes |
|---|---|---|
| PNG | Lossless raster | Default. Preserves transparency |
| JPEG | Best quality available | No transparency (white background) |
| TIFF | Lossless raster | Good for print pipelines |
| SVG | Vector | Infinitely scalable |
| PDF | Vector, press-ready | Uses the best PDF preset found (prefers PDF/X-4) |

Quality presets are matched from **your** Affinity installation at runtime (exact → prefix → substring match), so the script adapts to whatever presets your version ships with.

## Troubleshooting

- **"This document has no artboards"** — convert your canvas to artboards with the Artboard Tool first
- **A format checkbox is disabled** — your Affinity installation has no preset with a matching name; create one in the Export dialog or pick another format
- **Exports fail with a path error** — the destination must be on the Desktop; check the sub-folder name
- **Installed via Script Manager but nothing happens in Affinity** — see the [Script Manager troubleshooting guide](https://github.com/JiriKrblich/Affinity-script-manager#troubleshooting) (MCP enabled, category created, bridge running)

## Script Manager metadata

The file starts with a `/** ... */` metadata header (`name`, `description`, `version`, `author`) that the Affinity Script Manager parses automatically.

---

**Built by Franklin Alegu**

*Not affiliated with Affinity or Canva. Affinity is a trademark of Canva.*
