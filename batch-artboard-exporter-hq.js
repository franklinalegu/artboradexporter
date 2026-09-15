/**
 * name: Batch Artboard Exporter HQ
 * description: Exports every artboard (or selected ones) individually to PNG, JPEG, TIFF, SVG or PDF in one run, at 1x-4x or print DPI (300/600), with collision-safe filenames, skip-existing and per-artboard error recovery.
 * version: 2.0.0
 * author: User
 */

'use strict';

const { Document, FileExportOptions, FileExportArea } = require('/document');
const { Dialog, DialogResult } = require('/dialog');
const { app } = require('/application');
const { Size } = require('/geometry');
const { File, FileSystemApi } = require('/fs');
const { EnumerationResult } = require('affinity:common');

const FORMATS = [
    { key: 'png',  label: 'PNG — lossless raster',      extension: 'png', raster: true,  candidates: ['PNG'] },
    { key: 'jpg',  label: 'JPEG — best quality',        extension: 'jpg', raster: true,  candidates: ['JPEG (Best quality)', 'JPEG (High quality)', 'JPEG', 'JPG'] },
    { key: 'tiff', label: 'TIFF — lossless raster',     extension: 'tif', raster: true,  candidates: ['TIFF', 'TIF'] },
    { key: 'svg',  label: 'SVG — vector',               extension: 'svg', raster: false, candidates: ['SVG'] },
    { key: 'pdf',  label: 'PDF — vector, press-ready',   extension: 'pdf', raster: false, candidates: ['PDF', 'PDF (for export)', 'PDF/X-4', 'PDF/X-3', 'PDF/X-1a'] },
];

const RESOLUTIONS = [
    { label: '1x — native size',                  mult: 1 },
    { label: '2x — retina / screen (recommended)', mult: 2 },
    { label: '3x',                                mult: 3 },
    { label: '4x — maximum raster',               mult: 4 },
    { label: '300 DPI — print',                   dpi: 300 },
    { label: '600 DPI — large format print',      dpi: 600 },
];

function trim(text) {
    return String(text == null ? '' : text).replace(/^\s+|\s+$/g, '');
}

function norm(text) {
    return trim(text).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function sanitizeFileName(text) {
    const cleaned = trim(text || 'artboard')
        .replace(/[\\\/:*?"<>|#%{}$!'@+`=]/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/^\.+|\.+$/g, '')
        .replace(/-+/g, '-');
    return cleaned || 'artboard';
}

function pad(n, width) {
    return String(n).padStart(width, ' ');
}

function pathJoin(folder, fileName) {
    const sep = folder.indexOf('\\') >= 0 ? '\\' : '/';
    return folder.replace(/[\\\/]+$/, '') + sep + fileName;
}

function describeError(err) {
    if (!err) return 'unknown error';
    if (typeof err === 'string') return err;
    if (err.message) return err.message;
    const parts = [];
    try { if (err.title) parts.push(err.title); } catch (e) {}
    try { if (err.reason) parts.push(err.reason); } catch (e2) {}
    return parts.join(': ') || String(err);
}

function fileExists(path) {
    try { return File.size(path) > 0; } catch (e) { return false; }
}

function fileSize(path) {
    try { return File.size(path); } catch (e) { return 0; }
}

function allPresetNames() {
    const names = [];
    try {
        FileExportOptions.enumeratePresetNames(name => {
            names.push(String(name));
            return EnumerationResult.Continue;
        });
    } catch (e) {
        try { return FileExportOptions.allPresetNames || []; } catch (e2) {}
    }
    return names;
}

function findPreset(format, presets) {
    const normalized = presets.map(name => ({ name, key: norm(name) }));
    for (const candidate of format.candidates) {
        const exact = normalized.find(item => item.key === norm(candidate));
        if (exact) return exact.name;
    }
    for (const candidate of format.candidates) {
        const candidateKey = norm(candidate);
        const starts = normalized.find(item => item.key.indexOf(candidateKey) === 0);
        if (starts) return starts.name;
    }
    for (const candidate of format.candidates) {
        const candidateKey = norm(candidate);
        const contains = normalized.find(item => item.key.indexOf(candidateKey) >= 0);
        if (contains) return contains.name;
    }
    return null;
}

function artboardLabel(artboard) {
    try { if (artboard.description) return artboard.description; } catch (e) {}
    try {
        if (artboard.node) {
            if (artboard.node.userDescription) return artboard.node.userDescription;
            if (artboard.node.description) return artboard.node.description;
            if (artboard.node.name) return artboard.node.name;
        }
    } catch (e2) {}
    return 'artboard';
}

function artboardBox(artboard) {
    try {
        const box = artboard.spreadBaseBox || artboard.baseBox;
        if (box && isFinite(box.width) && isFinite(box.height)) return box;
    } catch (e) {}
    try {
        const box = artboard.node.baseBox;
        if (box && isFinite(box.width) && isFinite(box.height)) return box;
    } catch (e2) {}
    return null;
}

function collectAllArtboards(doc) {
    const list = [];
    try {
        for (const ab of doc.artboards) list.push(ab);
    } catch (e) {
        try {
            for (const spread of doc.spreads) {
                for (const ab of spread.artboards) list.push(ab);
            }
        } catch (e2) {}
    }
    return list;
}

function collectSelectedArtboards(doc) {
    const selected = new Set();
    try {
        for (const node of doc.selection.nodes) {
            const abi = node.artboardInterface;
            if (abi && abi.isArtboardEnabled) {
                try { selected.add(abi.node); } catch (e) { selected.add(abi); }
            }
        }
    } catch (e) {}
    if (selected.size === 0) return [];
    return collectAllArtboards(doc).filter(ab => {
        try {
            if (ab.node && selected.has(ab.node)) return true;
        } catch (e) {}
        return selected.has(ab);
    });
}

function rasterScale(resolution) {
    return resolution.dpi ? resolution.dpi / 72 : resolution.mult;
}

function rasterSize(artboard, resolution) {
    const box = artboardBox(artboard);
    const scale = rasterScale(resolution);
    if (!box) {
        if (resolution.dpi) throw new Error('Could not read artboard size — DPI sizing unavailable for this artboard.');
        return null;
    }
    if (Math.abs(scale - 1) < 0.0001) return null;
    const w = Math.max(1, Math.round(box.width * scale));
    const h = Math.max(1, Math.round(box.height * scale));
    try { return new Size(w, h); } catch (e) { return null; }
}

function ensureDirectory(path) {
    try {
        if (FileSystemApi.createDirectory) FileSystemApi.createDirectory(path);
    } catch (e) {}
}

function showOptionsDialog(presets, artboardCount, selectedCount) {
    const dialog = Dialog.create('Batch Artboard Exporter HQ');
    dialog.initialWidth = 470;

    const col = dialog.addColumn();

    const grpFormat = col.addGroup('Formats (pick any)');
    const checks = [];
    for (const format of FORMATS) {
        const preset = findPreset(format, presets);
        const check = grpFormat.addCheckBox(format.label, Boolean(preset));
        check.isEnabled = Boolean(preset);
        if (!preset) check.description = 'No matching export preset found in this Affinity installation.';
        checks.push({ format, preset, check });
    }
    const chkPng = checks[0].check;
    chkPng.value = true;

    const grpScale = col.addGroup('Resolution (raster formats only)');
    grpScale.enableSeparator = true;
    const cmbScale = grpScale.addComboBox('Size',
        RESOLUTIONS.map(r => r.label), 1);
    grpScale.addStaticText('note',
        'SVG and PDF are vector — always sharp, exported at native size.\nJPEG has no transparency (white background).');

    const grpScope = col.addGroup('Scope');
    grpScope.enableSeparator = true;
    const scopeLabels = [
        `All artboards (${artboardCount})`,
        `Selected artboards only (${selectedCount})`,
    ];
    const cmbScope = grpScope.addComboBox('Export', scopeLabels,
        selectedCount > 0 && artboardCount !== selectedCount ? 1 : 0);
    if (selectedCount === 0) cmbScope.isEnabled = false;

    const grpName = col.addGroup('Files');
    grpName.enableSeparator = true;
    const txtPrefix = grpName.addTextBox('Prefix (optional)', '');
    const chkIndex = grpName.addCheckBox('Number files in artboard order', true);
    const chkSkip = grpName.addCheckBox('Skip files that already exist', false);
    const txtFolder = grpName.addTextBox('Sub-folder on Desktop (optional)', 'Artboard Export');
    txtFolder.isFullWidth = true;

    let result;
    try { result = dialog.runModal(); } catch (e) { return null; }
    if (!result || result.value !== DialogResult.Ok.value) return null;

    const chosen = checks
        .filter(c => c.check.value && c.preset)
        .map(c => ({ format: c.format, preset: c.preset }));
    if (chosen.length === 0) return { error: 'Select at least one available format.' };

    return {
        formats: chosen,
        resolution: RESOLUTIONS[cmbScale.selectedIndex] || RESOLUTIONS[1],
        scope: cmbScope.selectedIndex === 1 ? 'selected' : 'all',
        prefix: trim(txtPrefix.value || txtPrefix.text),
        useIndex: chkIndex.value,
        skipExisting: chkSkip.value,
        subFolder: trim(txtFolder.value || txtFolder.text),
    };
}

function fmtBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function main() {
    const doc = Document.current;
    if (!doc) {
        app.alert('Open a document first, then run Batch Artboard Exporter HQ.', 'Batch Artboard Exporter HQ');
        return;
    }

    if (!doc.hasArtboards) {
        app.alert('This document has no artboards.\n\nUse the Artboard Tool to create artboards, or run\nthis script on a document that has them.', 'Batch Artboard Exporter HQ');
        return;
    }

    const presets = allPresetNames();
    if (!presets.length) {
        app.alert('Could not read export presets from this Affinity installation.', 'Batch Artboard Exporter HQ');
        return;
    }

    const allArtboards = collectAllArtboards(doc);
    if (allArtboards.length === 0) {
        app.alert('The document reports artboards but none could be collected.', 'Batch Artboard Exporter HQ');
        return;
    }
    const selectedArtboards = collectSelectedArtboards(doc);

    const options = showOptionsDialog(presets, allArtboards.length, selectedArtboards.length);
    if (!options) return;

    if (options.error) {
        app.alert(options.error, 'Batch Artboard Exporter HQ');
        return;
    }

    const targets = options.scope === 'selected' ? selectedArtboards : allArtboards;
    if (targets.length === 0) {
        app.alert('No artboards selected.\n\nSelect one or more artboards in the Layers panel\n(Shift-click or Ctrl/Cmd-click) and run again.', 'Batch Artboard Exporter HQ');
        return;
    }

    const desktop = app.userDesktopPath || app.getUserDesktopPath || '';
    if (!desktop) {
        app.alert('Could not resolve the Desktop path.', 'Batch Artboard Exporter HQ');
        return;
    }
    const destFolder = options.subFolder
        ? pathJoin(desktop, sanitizeFileName(options.subFolder))
        : desktop;
    ensureDirectory(destFolder);

    const indexWidth = String(targets.length).length;
    const usedNames = new Set();
    const startedAt = Date.now();

    const resLabel = options.resolution.dpi
        ? `${options.resolution.dpi} DPI`
        : `${options.resolution.mult}x`;

    console.log(`Batch Artboard Exporter HQ — ${targets.length} artboard(s) → ${options.formats.map(f => f.format.extension.toUpperCase()).join(' + ')} @ ${resLabel}`);
    console.log(`Destination: ${destFolder}`);

    let exported = 0;
    let skipped = 0;
    let failed = 0;
    let totalBytes = 0;
    const perFormat = {};
    const errors = [];

    for (let i = 0; i < targets.length; i++) {
        const artboard = targets[i];
        const label = artboardLabel(artboard);

        let base = options.prefix ? `${sanitizeFileName(options.prefix)}_` : '';
        base += options.useIndex ? `${String(i + 1).padStart(indexWidth, '0')}_` : '';
        base += sanitizeFileName(label);

        let unique = base;
        let suffix = 2;
        while (usedNames.has(unique.toLowerCase())) unique = `${base}-${suffix++}`;
        usedNames.add(unique.toLowerCase());

        for (const entry of options.formats) {
            const format = entry.format;
            const outPath = pathJoin(destFolder, `${unique}.${format.extension}`);
            const tag = `[${i + 1}/${targets.length}] ${label} → ${format.extension.toUpperCase()}`;

            if (options.skipExisting && fileExists(outPath)) {
                skipped++;
                perFormat[format.key] = (perFormat[format.key] || 0) + 1;
                console.log(`  = ${tag} — skipped (file exists)`);
                continue;
            }

            try {
                const exportOptions = FileExportOptions.createWithPresetName(entry.preset);
                const area = FileExportArea.createForArtboard(artboard);
                const size = format.raster ? rasterSize(artboard, options.resolution) : null;
                doc.export(outPath, exportOptions, area, size);
                exported++;
                perFormat[format.key] = (perFormat[format.key] || 0) + 1;
                totalBytes += fileSize(outPath);
                console.log(`  ✓ ${tag}`);
            } catch (e) {
                failed++;
                const msg = describeError(e);
                errors.push(`${label} (${format.extension.toUpperCase()}): ${msg}`);
                console.log(`  ✗ ${tag} — ${msg}`);
            }
        }
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

    const lines = [];
    lines.push('Batch export finished.');
    lines.push('');
    lines.push(`Artboards:  ${targets.length}`);
    lines.push(`Exported:   ${exported} file(s)`);
    if (skipped > 0) lines.push(`Skipped:    ${skipped} (already existed)`);
    if (failed > 0) lines.push(`Failed:     ${failed}`);
    lines.push(`Resolution: ${resLabel} (raster) · native size (vector)`);
    lines.push(`Folder:     ${destFolder}`);
    if (exported > 0) lines.push(`Total size: ${fmtBytes(totalBytes)} in ${elapsed}s`);

    const formatLines = options.formats.map(entry => {
        const count = perFormat[entry.format.key] || 0;
        return `  ${entry.format.extension.toUpperCase().padEnd(4)} × ${count}  (preset: "${entry.preset}")`;
    });
    if (formatLines.length) {
        lines.push('');
        lines.push('Per format:');
        lines.push(...formatLines);
    }

    if (failed > 0) {
        lines.push('');
        lines.push('Failures:');
        for (const err of errors) lines.push(`  · ${err}`);
    }

    app.alert(lines.join('\n'), 'Batch Artboard Exporter HQ');
}

main();
