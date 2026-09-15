# Batch Artboard Exporter HQ

A script for **Affinity Designer / Photo / Publisher (v2.6+)** that exports every artboard — or any selected objects — as individual files, in one run, at high quality, without touching your document. Can also package your exports InDesign-style: a fonts report and copies of every image used.

Built for the [Affinity Script Manager](https://github.com/JiriKrblich/Affinity-script-manager) ecosystem but works as a standalone script too.

## Features

- **One file per artboard or asset** — each artboard/object is exported individually through its own export area (no slicing, no merged output)
- **All artboards, selected artboards, or selected objects** — export the whole document, just the artboards you pick in the Layers panel, or any selected objects/groups (each becomes its own file)
- **High quality formats** — lossless PNG/TIFF, best-quality JPEG, or fully scalable vector SVG/PDF/EPS
- **Colour mode selection** — Automatic, RGB, CMYK or Greyscale, applied through colour-aware preset matching (see below)
- **Multi-format in one run** — tick several formats and get every item in each of them
- **Resolution control** — 1x / 2x / 3x / 4x multipliers, or print-grade **300 / 600 DPI** sizing computed from each item's physical dimensions
- **InDesign-style packaging** — collects every image used (linked *and* embedded) into `resources/images/` and writes a `package-report.txt` listing all fonts used
- **Grouped output** — exports land in a folder named after the document, inside a parent folder on the Desktop
- **Stress-free by design** — never modifies your document (no duplicate nodes, no visibility toggles, no selection changes), each export runs in its own error boundary, one failure never stops the batch
- **Collision-safe filenames** — duplicate names get numbered suffixes; optional order numbering (`01_`, `02_`…) for correct sorting
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

1. Open a document containing artboards, or select the objects you want to export
2. *(Optional)* Select specific artboards or objects in the Layers panel to export only those
3. Run the script from the Scripts panel
4. Configure the dialog:

| Option | What it does |
|---|---|
| **Formats** | Tick any of PNG / JPEG / TIFF / SVG / PDF / EPS. Disabled formats have no matching preset in your Affinity installation |
| **Colour mode** | Automatic (each preset's saved settings), RGB, CMYK or Greyscale — see [Colour modes](#colour-modes) |
| **Resolution** | Pixel multiplier (1x–4x) or print DPI (300/600). Applies to raster formats; vector formats are always sharp at native size |
| **Scope** | All artboards, only the selected artboards, or every selected object as its own file |
| **Package** | Collects all images used into `resources/images/` and writes a fonts + images report (InDesign-style) |
| **Prefix** | Optional prefix for all filenames |
| **Number files** | Prepends `01_`, `02_`… in export order so files sort correctly |
| **Skip existing** | Leaves files that already exist untouched (incremental re-runs) |
| **Group in document folder** | Puts exports in a folder named after the document |
| **Parent folder** | The Desktop folder everything is written to |

5. Click **OK** — a summary dialog reports everything that happened

### Output

Files are written to the Desktop (Affinity's scripting sandbox only permits Desktop writes):

```
Desktop\
  Artboard Export\
    My Document\
      01_Home.png
      01_Home.pdf
      02_About.png
      ...
      resources\
        images\
          photo.jpg
          logo.png
      package-report.txt
```

## Packaging (InDesign-style)

When **Collect images + fonts report** is ticked, the script walks the whole document and:

- **Copies every image used** — linked images are copied from their original location, embedded images are extracted out of the document — into `resources/images/` (duplicates auto-numbered)
- **Reports every font used** — `doc.getFontNames()` is listed in `package-report.txt`
- Writes a `package-report.txt` with the export settings, font list, and image inventory (original file paths included for linked images)

> **Fonts cannot be physically copied.** Unlike InDesign's *Package*, Affinity's scripting API does not expose font files — only their names. Install the fonts listed in the report on the target machine before opening the exports elsewhere.

## Colour modes

Colour settings live **inside** export presets in Affinity, so the script applies your chosen colour mode by matching presets:

- **Automatic** — each selected preset's own saved colour settings
- **RGB / CMYK / Greyscale** — the script first looks for presets whose names contain both the format and the mode (e.g. `PNG CMYK`, `TIFF (Greyscale)`), which is how custom presets are typically named. For PDF + CMYK it prefers the **PDF/X** family (CMYK by definition). If no colour-matching preset exists, it falls back to the plain preset and clearly warns you in the summary

To force a specific colour mode, create a custom preset in Affinity: **File → Export → pick the format → More… → set the colour format/profile → Manage Presets → Create preset**, and include the mode in its name (e.g. `PNG CMYK`). The script will pick it up automatically.

## Formats & quality

| Format | Quality | Notes |
|---|---|---|
| PNG | Lossless raster | Default. Preserves transparency |
| JPEG | Best quality available | No transparency (white background) |
| TIFF | Lossless raster | Good for print pipelines |
| SVG | Vector | Infinitely scalable. Always RGB |
| PDF | Vector, press-ready | Uses the best PDF preset found (prefers PDF/X-4 for CMYK) |
| EPS | Vector | Legacy print handoff |

Quality presets are matched from **your** Affinity installation at runtime (exact → prefix → substring match), so the script adapts to whatever presets your version ships with.

## Troubleshooting

- **"This document has no artboards and nothing is selected"** — create artboards with the Artboard Tool, or select objects in the Layers panel
- **A format checkbox is disabled** — your Affinity installation has no preset with a matching name; create one in the Export dialog or pick another format
- **"Colour mode not applied" warning in the summary** — no preset with that colour mode exists; create a custom preset with the mode in its name (see [Colour modes](#colour-modes))
- **Exports fail with a path error** — the destination must be on the Desktop; check the folder names
- **Package report shows "shown in this dialog only"** — your Affinity version's scripting API doesn't support writing text files; the report content is in the summary dialog instead
- **Installed via Script Manager but nothing happens in Affinity** — see the [Script Manager troubleshooting guide](https://github.com/JiriKrblich/Affinity-script-manager#troubleshooting) (MCP enabled, category created, bridge running)

## Script Manager metadata

The file starts with a `/** ... */` metadata header (`name`, `description`, `version`, `author`) that the Affinity Script Manager parses automatically.

---

**Built by Franklin Alegu**

*Not affiliated with Affinity or Canva. Affinity is a trademark of Canva.*
