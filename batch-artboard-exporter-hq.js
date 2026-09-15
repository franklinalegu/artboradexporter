/**
 * name: Batch Artboard Exporter HQ
 * description: Exports artboards or selected objects individually to PNG, JPEG, TIFF, SVG, PDF or EPS in one run, with colour mode selection, 1x-4x or print DPI, document-named folder grouping, and InDesign-style packaging (fonts report + collected images).
 * version: 4.0.0
 * author: Franklin Alegu
 */

'use strict';

const { Document, FileExportOptions, FileExportArea } = require('/document');
const { Dialog, DialogResult } = require('/dialog');
const { app } = require('/application');
const { Size } = require('/geometry');
const { File, FileSystemApi } = require('/fs');
const { Selection } = require('/selections');
const { EnumerationResult } = require('affinity:common');

const FORMATS = [
    { key: 'png',  label: 'PNG — lossless raster',       extension: 'png', raster: true,  candidates: ['PNG'] },
    { key: 'jpg',  label: 'JPEG — best quality',         extension: 'jpg', raster: true,  candidates: ['JPEG (Best quality)', 'JPEG (High quality)', 'JPEG', 'JPG'] },
    { key: 'tiff', label: 'TIFF — lossless raster',      extension: 'tif', raster: true,  candidates: ['TIFF', 'TIF'] },
    { key: 'svg',  label: 'SVG — vector',                extension: 'svg', raster: false, candidates: ['SVG'] },
    { key: 'pdf',  label: 'PDF — vector, press-ready',    extension: 'pdf', raster: false, candidates: ['PDF', 'PDF (for export)', 'PDF/X-4', 'PDF/X-3', 'PDF/X-1a'] },
    { key: 'eps',  label: 'EPS — vector, legacy print',  extension: 'eps', raster: false, candidates: ['EPS', 'EPS (for export)'] },
];

const COLOUR_MODES = [
    { key: null,        label: 'Automatic — each preset\'s saved colour settings' },
    { key: 'rgb',       label: 'RGB' },
    { key: 'cmyk',      label: 'CMYK' },
    { key: 'greyscale', label: 'Greyscale' },
];

const MODE_TOKENS = {
    rgb: ['rgb'],
    cmyk: ['cmyk'],
    greyscale: ['greyscale', 'grayscale', 'grey', 'gray', 'mono'],
};

const RESOLUTIONS = [
    { label: '1x — native size',                   mult: 1 },
    { label: '2x — retina / screen (recommended)',  mult: 2 },
    { label: '3x',                                 mult: 3 },
    { label: '4x — maximum raster',                mult: 4 },
    { label: '300 DPI — print',                    dpi: 300 },
    { label: '600 DPI — large format print',       dpi: 600 },
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
    try { return FileSystemApi.exists(path); } catch (e) {}
    try { return File.size(path) > 0; } catch (e2) { return false; }
}

function fileSize(path) {
    try { return File.size(path); } catch (e) { return 0; }
}

function ensureDirectories(path) {
    try {
        if (FileSystemApi.createDirectories) return FileSystemApi.createDirectories(path);
    } catch (e) {}
    try {
        if (FileSystemApi.createDirectory) FileSystemApi.createDirectory(path);
    } catch (e2) {}
}

function writeTextFile(path, text) {
    const attempts = [
        () => File.writeText(path, text),
        () => File.write(path, text),
        () => FileSystemApi.writeText(path, text),
    ];
    for (const attempt of attempts) {
        try {
            attempt();
            if (fileExists(path)) return true;
        } catch (e) {}
    }
    return false;
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

function findPresetForMode(format, presets, modeKey) {
    if (!modeKey) return { preset: findPreset(format, presets), applied: true, note: '' };

    if (modeKey === 'cmyk' && format.key === 'pdf') {
        const x = findPreset({ candidates: ['PDF/X-4', 'PDF/X-3', 'PDF/X-1a'] }, presets);
        if (x) return { preset: x, applied: true, note: 'PDF/X is CMYK by definition' };
    }

    if (format.key === 'svg') {
        return { preset: findPreset(format, presets), applied: true, note: 'SVG is always RGB' };
    }

    const tokens = MODE_TOKENS[modeKey] || [];
    const modeMatches = presets.filter(name => {
        const key = norm(name);
        return tokens.some(t => key.indexOf(t) >= 0);
    });
    if (modeMatches.length) {
        const matched = findPreset(format, modeMatches);
        if (matched) return { preset: matched, applied: true, note: '' };
    }

    return { preset: findPreset(format, presets), applied: false, note: '' };
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

function nodeLabel(node) {
    try { if (node.userDescription) return node.userDescription; } catch (e) {}
    try { if (node.description) return node.description; } catch (e2) {}
    try { if (node.name) return node.name; } catch (e3) {}
    return 'object';
}

function validBox(box) {
    return box && isFinite(box.width) && isFinite(box.height);
}

function artboardBox(artboard) {
    try {
        const box = artboard.spreadBaseBox || artboard.baseBox;
        if (validBox(box)) return box;
    } catch (e) {}
    try {
        const box = artboard.node.baseBox;
        if (validBox(box)) return box;
    } catch (e2) {}
    return null;
}

function objectBox(node) {
    try {
        const box = node.getSpreadVisibleBox(true);
        if (validBox(box)) return box;
    } catch (e) {}
    try {
        const box = node.spreadVisibleBox;
        if (validBox(box)) return box;
    } catch (e2) {}
    try {
        const box = node.baseBox;
        if (validBox(box)) return box;
    } catch (e3) {}
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

function selectedNodes(doc) {
    try { return doc.selection.nodes || []; } catch (e) { return []; }
}

function collectSelectedArtboards(doc) {
    const selected = new Set();
    try {
        for (const node of selectedNodes(doc)) {
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

function countSelectedNonArtboards(doc) {
    let count = 0;
    for (const node of selectedNodes(doc)) {
        let isArtboard = false;
        try {
            const abi = node.artboardInterface;
            isArtboard = Boolean(abi && abi.isArtboardEnabled);
        } catch (e) {}
        if (!isArtboard) count++;
    }
    return count;
}

function buildTargets(doc, scope, allArtboards, selectedArtboards) {
    if (scope === 'objects') {
        const targets = [];
        const artboardNodes = new Set();
        for (const ab of allArtboards) {
            try { artboardNodes.add(ab.node); } catch (e) {}
        }
        for (const node of selectedNodes(doc)) {
            let matchedArtboard = null;
            try {
                if (artboardNodes.has(node)) {
                    matchedArtboard = allArtboards.find(ab => {
                        try { return ab.node === node; } catch (e) { return false; }
                    }) || null;
                }
            } catch (e2) {}
            if (matchedArtboard) {
                targets.push({ kind: 'artboard', artboard: matchedArtboard, label: artboardLabel(matchedArtboard), box: artboardBox(matchedArtboard) });
            } else {
                targets.push({ kind: 'object', node: node, label: nodeLabel(node), box: objectBox(node) });
            }
        }
        return targets;
    }
    const artboards = scope === 'selected' ? selectedArtboards : allArtboards;
    return artboards.map(ab => ({ kind: 'artboard', artboard: ab, label: artboardLabel(ab), box: artboardBox(ab) }));
}

function targetArea(doc, target) {
    if (target.kind === 'artboard') return FileExportArea.createForArtboard(target.artboard);
    return FileExportArea.createForSelection(Selection.create(doc, [target.node], true));
}

function rasterScale(resolution) {
    return resolution.dpi ? resolution.dpi / 72 : resolution.mult;
}

function rasterSize(box, resolution) {
    const scale = rasterScale(resolution);
    if (!box) {
        if (resolution.dpi) throw new Error('Could not read the item size — DPI sizing unavailable.');
        return null;
    }
    if (Math.abs(scale - 1) < 0.0001) return null;
    const w = Math.max(1, Math.round(box.width * scale));
    const h = Math.max(1, Math.round(box.height * scale));
    try { return new Size(w, h); } catch (e) { return null; }
}

function collectImageResources(doc) {
    const found = [];
    const seen = new Set();
    for (const spread of doc.spreads) {
        (function walk(parent) {
            let kids = [];
            try { kids = parent.children; } catch (e) { return; }
            for (const node of kids) {
                try {
                    if ((node.isImageNode || node.isEmbeddedDocumentNode) && node.imageResourceInterface) {
                        const iri = node.imageResourceInterface;
                        let key = String(found.length);
                        try { key = iri.imageFilePath + '|' + String(iri.imagePlacement.value); } catch (e2) {}
                        if (!seen.has(key)) {
                            seen.add(key);
                            found.push(iri);
                        }
                    }
                } catch (e3) {}
                try { walk(node); } catch (e4) {}
            }
        })(spread);
    }
    return found;
}

function imagePlacementLabel(iri) {
    try { return iri.imagePlacement.value === 1 ? 'linked' : 'embedded'; } catch (e) { return 'unknown'; }
}

function imageBaseName(iri) {
    let name = 'image';
    try { name = String(iri.imageFilePath || 'image'); } catch (e) {}
    const cleaned = name.split('/').pop().split('\\').pop();
    return sanitizeFileName(cleaned) || 'image';
}

function uniquePath(folder, fileName) {
    const dot = fileName.lastIndexOf('.');
    const base = dot >= 0 ? fileName.slice(0, dot) : fileName;
    const ext = dot >= 0 ? fileName.slice(dot) : '';
    let candidate = pathJoin(folder, fileName);
    let counter = 2;
    while (fileExists(candidate)) {
        candidate = pathJoin(folder, `${base}_${counter}${ext}`);
        counter++;
    }
    return candidate;
}

function fmtBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function showOptionsDialog(presets, counts) {
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
    checks[0].check.value = true;

    const grpColour = col.addGroup('Colour mode');
    grpColour.enableSeparator = true;
    const cmbColour = grpColour.addComboBox('Mode', COLOUR_MODES.map(m => m.label), 0);
    grpColour.addStaticText('note',
        'Colour settings live inside export presets. To force RGB/CMYK/Greyscale,\nsave a custom preset in Affinity (File > Export > format > More...\n> set colour format > Manage Presets > Create preset) and include the\nmode in its name, e.g. "PNG CMYK". PDF/X presets are CMYK by definition.');

    const grpScale = col.addGroup('Resolution (raster formats only)');
    grpScale.enableSeparator = true;
    const cmbScale = grpScale.addComboBox('Size', RESOLUTIONS.map(r => r.label), 1);
    grpScale.addStaticText('note',
        'SVG, PDF and EPS are vector — always sharp, exported at native size.\nJPEG has no transparency (white background).');

    const grpScope = col.addGroup('Scope');
    grpScope.enableSeparator = true;
    const scopeDefs = [
        { id: 'all', label: `All artboards (${counts.artboards})`, enabled: counts.artboards > 0 },
        { id: 'selected', label: `Selected artboards only (${counts.selectedArtboards})`, enabled: counts.selectedArtboards > 0 },
        { id: 'objects', label: `Selected objects — one file each (${counts.selectedObjects})`, enabled: counts.selectedObjects > 0 },
    ];
    const cmbScope = grpScope.addComboBox('Export', scopeDefs.map(s => s.label),
        scopeDefs[1].enabled && counts.artboards !== counts.selectedArtboards ? 1 : 0);
    scopeDefs.forEach((s, i) => {
        if (!s.enabled) {
            try { cmbScope.setEnabledAtIndex(i, false); } catch (e) {}
        }
    });

    const grpPackage = col.addGroup('Package (InDesign-style)');
    grpPackage.enableSeparator = true;
    const chkPackage = grpPackage.addCheckBox('Collect images + fonts report', false);
    grpPackage.addStaticText('note',
        'Copies every image used (linked and embedded) into resources/images\nand writes a report listing all fonts used. Affinity\'s scripting API\ncannot copy font files — install the listed fonts on the target machine.');

    const grpName = col.addGroup('Files');
    grpName.enableSeparator = true;
    const txtPrefix = grpName.addTextBox('Prefix (optional)', '');
    const chkIndex = grpName.addCheckBox('Number files in export order', true);
    const chkSkip = grpName.addCheckBox('Skip files that already exist', false);
    const chkGroupDoc = grpName.addCheckBox('Group exports in a folder named after this document', true);
    const txtFolder = grpName.addTextBox('Parent folder on Desktop', 'Artboard Export');
    txtFolder.isFullWidth = true;

    let result;
    try { result = dialog.runModal(); } catch (e) { return null; }
    if (!result || result.value !== DialogResult.Ok.value) return null;

    const chosen = checks
        .filter(c => c.check.value && c.preset)
        .map(c => ({ format: c.format, preset: c.preset }));
    if (chosen.length === 0) return { error: 'Select at least one available format.' };

    const scopeIndex = (() => {
        try { return cmbScope.selectedIndex; } catch (e) { return 0; }
    })();
    const scopeOrder = scopeDefs.map(s => s.id);
    const scopeId = scopeOrder[scopeIndex] || 'all';

    return {
        formats: chosen,
        colourMode: COLOUR_MODES[cmbColour.selectedIndex] || COLOUR_MODES[0],
        resolution: RESOLUTIONS[cmbScale.selectedIndex] || RESOLUTIONS[1],
        scope: scopeId,
        package: chkPackage.value,
        prefix: trim(txtPrefix.value || txtPrefix.text),
        useIndex: chkIndex.value,
        skipExisting: chkSkip.value,
        groupByDoc: chkGroupDoc.value,
        subFolder: trim(txtFolder.value || txtFolder.text),
    };
}

function main() {
    const doc = Document.current;
    if (!doc) {
        app.alert('Open a document first, then run Batch Artboard Exporter HQ.', 'Batch Artboard Exporter HQ');
        return;
    }

    const presets = allPresetNames();
    if (!presets.length) {
        app.alert('Could not read export presets from this Affinity installation.', 'Batch Artboard Exporter HQ');
        return;
    }

    const allArtboards = doc.hasArtboards ? collectAllArtboards(doc) : [];
    const selectedArtboards = collectSelectedArtboards(doc);
    const selectedObjects = countSelectedNonArtboards(doc);

    if (allArtboards.length === 0 && selectedObjects === 0) {
        app.alert('This document has no artboards and nothing is selected.\n\nUse the Artboard Tool to create artboards, or select\nobjects in the Layers panel, then run again.', 'Batch Artboard Exporter HQ');
        return;
    }

    const options = showOptionsDialog(presets, {
        artboards: allArtboards.length,
        selectedArtboards: selectedArtboards.length,
        selectedObjects: selectedObjects,
    });
    if (!options) return;

    if (options.error) {
        app.alert(options.error, 'Batch Artboard Exporter HQ');
        return;
    }

    const targets = buildTargets(doc, options.scope, allArtboards, selectedArtboards);
    if (targets.length === 0) {
        app.alert('Nothing to export for the chosen scope.\n\nSelect artboards or objects in the Layers panel\nand run again.', 'Batch Artboard Exporter HQ');
        return;
    }

    const resolvedFormats = options.formats.map(entry => {
        const match = findPresetForMode(entry.format, presets, options.colourMode.key);
        return { format: entry.format, preset: match.preset, applied: match.applied, note: match.note };
    });

    const usableFormats = resolvedFormats.filter(f => f.preset);
    if (usableFormats.length === 0) {
        app.alert('None of the selected formats have a usable export preset.', 'Batch Artboard Exporter HQ');
        return;
    }
    const modeWarnings = resolvedFormats
        .filter(f => f.preset && !f.applied)
        .map(f => `${f.format.label.split(' — ')[0]}: no ${options.colourMode.label} preset found — used "${f.preset}" (its own colour settings apply). Create a custom preset with "${options.colourMode.label}" in its name to control this.`);

    const desktop = app.userDesktopPath || app.getUserDesktopPath || '';
    if (!desktop) {
        app.alert('Could not resolve the Desktop path.', 'Batch Artboard Exporter HQ');
        return;
    }

    const docTitle = trim(doc.title || 'export').replace(/\.[^.]+$/, '');
    let destFolder = options.subFolder ? pathJoin(desktop, sanitizeFileName(options.subFolder)) : desktop;
    if (options.groupByDoc) destFolder = pathJoin(destFolder, sanitizeFileName(docTitle) || 'Export');
    ensureDirectories(destFolder);

    const indexWidth = String(targets.length).length;
    const usedNames = new Set();
    const startedAt = Date.now();

    const resLabel = options.resolution.dpi ? `${options.resolution.dpi} DPI` : `${options.resolution.mult}x`;
    const colourLabel = options.colourMode.key
        ? `${options.colourMode.label} (via presets)`
        : 'Automatic (preset defaults)';

    console.log(`Batch Artboard Exporter HQ — ${targets.length} item(s) → ${usableFormats.map(f => f.format.extension.toUpperCase()).join(' + ')} @ ${resLabel}`);
    console.log(`Colour: ${colourLabel}`);
    console.log(`Destination: ${destFolder}`);

    let exported = 0;
    let skipped = 0;
    let failed = 0;
    let totalBytes = 0;
    const perFormat = {};
    const errors = [];

    for (let i = 0; i < targets.length; i++) {
        const target = targets[i];

        let base = options.prefix ? `${sanitizeFileName(options.prefix)}_` : '';
        base += options.useIndex ? `${String(i + 1).padStart(indexWidth, '0')}_` : '';
        base += sanitizeFileName(target.label);

        let unique = base;
        let suffix = 2;
        while (usedNames.has(unique.toLowerCase())) unique = `${base}-${suffix++}`;
        usedNames.add(unique.toLowerCase());

        for (const entry of usableFormats) {
            const format = entry.format;
            const outPath = pathJoin(destFolder, `${unique}.${format.extension}`);
            const tag = `[${i + 1}/${targets.length}] ${target.label} → ${format.extension.toUpperCase()}`;

            if (options.skipExisting && fileExists(outPath)) {
                skipped++;
                perFormat[format.key] = (perFormat[format.key] || 0) + 1;
                console.log(`  = ${tag} — skipped (file exists)`);
                continue;
            }

            try {
                const exportOptions = FileExportOptions.createWithPresetName(entry.preset);
                const area = targetArea(doc, target);
                const size = format.raster ? rasterSize(target.box, options.resolution) : null;
                doc.export(outPath, exportOptions, area, size);
                exported++;
                perFormat[format.key] = (perFormat[format.key] || 0) + 1;
                totalBytes += fileSize(outPath);
                console.log(`  ✓ ${tag}`);
            } catch (e) {
                failed++;
                const msg = describeError(e);
                errors.push(`${target.label} (${format.extension.toUpperCase()}): ${msg}`);
                console.log(`  ✗ ${tag} — ${msg}`);
            }
        }
    }

    let packageLines = [];
    let packageWritten = false;
    let reportPath = '';

    if (options.package) {
        console.log('Collecting package resources…');
        let fonts = [];
        try { fonts = doc.getFontNames().slice().sort(); } catch (e) {
            try { fonts = []; } catch (e2) {}
        }

        const images = collectImageResources(doc);
        let imagesCopied = 0;
        let imagesFailed = 0;
        const imageLines = [];

        if (images.length > 0) {
            const imagesDir = pathJoin(destFolder, 'resources');
            const imagesSub = pathJoin(imagesDir, 'images');
            ensureDirectories(imagesSub);
            for (const iri of images) {
                const placement = imagePlacementLabel(iri);
                const baseName = imageBaseName(iri);
                const dest = uniquePath(imagesSub, baseName);
                try {
                    const saved = iri.saveOriginalFile(dest);
                    if (saved) {
                        imagesCopied++;
                        let original = '';
                        try { original = iri.imageFilePath || ''; } catch (e3) {}
                        imageLines.push(`  [${placement}] ${baseName}${original && original !== baseName ? ' — original: ' + original : ''}`);
                    } else {
                        imagesFailed++;
                        imageLines.push(`  [${placement}] ${baseName} — could not be saved`);
                    }
                } catch (e4) {
                    imagesFailed++;
                    imageLines.push(`  [${placement}] ${baseName} — ${describeError(e4)}`);
                }
            }
        }

        const report = [];
        report.push('PACKAGE REPORT');
        report.push(`Document: ${docTitle}`);
        report.push(`Generated: ${new Date().toISOString()}`);
        report.push('');
        report.push('EXPORTS');
        report.push(`  Items exported: ${targets.length}`);
        report.push(`  Formats: ${usableFormats.map(f => f.format.extension.toUpperCase()).join(', ')} @ ${resLabel}`);
        report.push(`  Colour mode: ${colourLabel}`);
        report.push('');
        report.push(`FONTS USED (${fonts.length}) — ensure these are installed on the target machine`);
        if (fonts.length) {
            for (const f of fonts) report.push(`  - ${f}`);
        } else {
            report.push('  (none reported)');
        }
        report.push('');
        report.push(`IMAGES (${imagesCopied} collected, ${imagesFailed} failed) — stored in resources/images/`);
        if (imageLines.length) {
            for (const line of imageLines) report.push(line);
        } else {
            report.push('  (no images found in the document)');
        }
        report.push('');
        report.push('NOTE: Affinity scripting cannot copy font files, only report their names.');
        report.push('Install the fonts listed above on the target machine before opening exports.');

        reportPath = pathJoin(destFolder, 'package-report.txt');
        packageWritten = writeTextFile(reportPath, report.join('\n'));

        packageLines = [
            `Fonts:      ${fonts.length} listed${fonts.length ? ' (' + fonts.slice(0, 3).join(', ') + (fonts.length > 3 ? ', …' : '') + ')' : ''}`,
            `Images:     ${imagesCopied} collected, ${imagesFailed} failed → resources/images/`,
        ];
        if (packageWritten) {
            console.log(`Package report written: ${reportPath}`);
        } else {
            console.log('Package report could not be written to disk (API limitation) — shown here instead.');
        }
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

    const lines = [];
    lines.push('Batch export finished.');
    lines.push('');
    lines.push(`Items:      ${targets.length}`);
    lines.push(`Exported:   ${exported} file(s)`);
    if (skipped > 0) lines.push(`Skipped:    ${skipped} (already existed)`);
    if (failed > 0) lines.push(`Failed:     ${failed}`);
    lines.push(`Resolution: ${resLabel} (raster) · native size (vector)`);
    lines.push(`Colour:     ${colourLabel}`);
    lines.push(`Folder:     ${destFolder}`);
    if (exported > 0) lines.push(`Total size: ${fmtBytes(totalBytes)} in ${elapsed}s`);

    if (packageLines.length) {
        lines.push('');
        lines.push('Package:');
        lines.push(...packageLines);
        lines.push(packageWritten ? `Report:     ${reportPath}` : 'Report:     shown in this dialog only (text file write not supported)');
    }

    const formatLines = usableFormats.map(entry => {
        const count = perFormat[entry.format.key] || 0;
        const modeTag = options.colourMode.key && !entry.applied ? '  [colour mode not applied]' : (entry.note ? `  [${entry.note}]` : '');
        return `  ${entry.format.extension.toUpperCase().padEnd(4)} × ${count}  (preset: "${entry.preset}")${modeTag}`;
    });
    if (formatLines.length) {
        lines.push('');
        lines.push('Per format:');
        lines.push(...formatLines);
    }

    if (modeWarnings.length) {
        lines.push('');
        lines.push('Colour mode warnings:');
        for (const w of modeWarnings) lines.push(`  · ${w}`);
    }

    if (failed > 0) {
        lines.push('');
        lines.push('Failures:');
        for (const err of errors) lines.push(`  · ${err}`);
    }

    app.alert(lines.join('\n'), 'Batch Artboard Exporter HQ');
}

main();
