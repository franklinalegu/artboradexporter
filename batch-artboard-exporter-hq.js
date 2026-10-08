/**
 * name: Batch Artboard Exporter HQ
 * description: Exports artboards or selected objects individually to PNG, JPEG, TIFF, SVG, PDF or EPS. Choose any destination (Desktop/Documents/Downloads/Pictures/custom path/system folder picker, macOS + Windows), name patterns, multi-size export (@1x/@2x/@3x), name filters, dry run, export log and InDesign-style packaging.
 * version: 5.0.0
 * author: Franklin Alegu (v5 edit: destination picker, audit fixes, extra features)
 */

'use strict';

const { Document, FileExportOptions, FileExportArea } = require('/document');
const { Dialog, DialogResult } = require('/dialog');
const { app } = require('/application');
const { Size } = require('/geometry');
const { File, FileSystemApi } = require('/fs');
const { Selection } = require('/selections');
const { EnumerationResult } = require('affinity:common');

const TITLE = 'Batch Artboard Exporter HQ';

// Constants

const FORMATS = [
    { key: 'png',  label: 'PNG',  hint: 'Lossless raster, keeps transparency',          extension: 'png', raster: true,  candidates: ['PNG'] },
    { key: 'jpg',  label: 'JPEG', hint: 'Best quality, no transparency (white bg)',     extension: 'jpg', raster: true,  candidates: ['JPEG (Best quality)', 'JPEG (High quality)', 'JPEG', 'JPG'] },
    { key: 'tiff', label: 'TIFF', hint: 'Lossless raster, good for print',              extension: 'tif', raster: true,  candidates: ['TIFF', 'TIF'] },
    { key: 'svg',  label: 'SVG',  hint: 'Vector, always RGB',                           extension: 'svg', raster: false, candidates: ['SVG'] },
    { key: 'pdf',  label: 'PDF',  hint: 'Vector, press-ready (prefers PDF/X for CMYK)', extension: 'pdf', raster: false, candidates: ['PDF', 'PDF (for export)', 'PDF/X-4', 'PDF/X-3', 'PDF/X-1a'] },
    { key: 'eps',  label: 'EPS',  hint: 'Vector, legacy print handoff',                 extension: 'eps', raster: false, candidates: ['EPS', 'EPS (for export)'] },
];

const COLOUR_MODES = [
    { key: null,        label: 'Auto (preset default)' },
    { key: 'rgb',       label: 'RGB' },
    { key: 'cmyk',      label: 'CMYK' },
    { key: 'greyscale', label: 'Greyscale' },
];

const MODE_TOKENS = {
    rgb: ['rgb'],
    cmyk: ['cmyk'],
    greyscale: ['greyscale', 'grayscale', 'grey', 'gray', 'mono'],
};

// Each entry exports one file per item in `list` (raster formats only).
const RESOLUTIONS = [
    { label: '1x (native)',      list: [{ mult: 1 }] },
    { label: '2x (screen)',      list: [{ mult: 2 }] },
    { label: '3x',               list: [{ mult: 3 }] },
    { label: '4x (max raster)',  list: [{ mult: 4 }] },
    { label: '300 DPI (print)',  list: [{ dpi: 300 }] },
    { label: '600 DPI (large)',  list: [{ dpi: 600 }] },
    { label: '1x + 2x',          list: [{ mult: 1 }, { mult: 2 }] },
    { label: '1x + 2x + 3x',     list: [{ mult: 1 }, { mult: 2 }, { mult: 3 }] },
    { label: '1x to 4x (all)',   list: [{ mult: 1 }, { mult: 2 }, { mult: 3 }, { mult: 4 }] },
];

const LOCATIONS = [
    { id: 'desktop',   label: 'Desktop' },
    { id: 'documents', label: 'Documents' },
    { id: 'downloads', label: 'Downloads' },
    { id: 'pictures',  label: 'Pictures' },
    { id: 'custom',    label: 'Custom path (below)' },
    { id: 'browse',    label: 'Browse... (system picker)' },
];

const ORDERS = [
    { id: 'doc',  label: 'Document order' },
    { id: 'asc',  label: 'Name A-Z' },
    { id: 'desc', label: 'Name Z-A' },
];

const DEFAULT_PATTERN = '{n}_{name}';

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function trim(text) {
    return String(text == null ? '' : text).replace(/^\s+|\s+$/g, '');
}

function norm(text) {
    return trim(text).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function sanitizeFileName(text) {
    let cleaned = trim(text || 'artboard')
        .replace(/[\u0000-\u001f]/g, '')
        .replace(/[\\\/:*?"<>|#%{}$!'@+`=]/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/^[.\s]+|[.\s]+$/g, '')
        .replace(/-{2,}/g, '-');
    if (cleaned.length > 120) cleaned = cleaned.slice(0, 120).replace(/[.\s]+$/, '');
    if (!cleaned) cleaned = 'artboard';
    if (RESERVED_NAMES.test(cleaned)) cleaned = '_' + cleaned;
    return cleaned;
}

function isWindowsPath(path) {
    return String(path).indexOf('\\') >= 0 || /^[A-Za-z]:/.test(String(path));
}

function isAbsolutePath(path) {
    return /^([A-Za-z]:[\\\/]|\\\\|\/)/.test(String(path));
}

function pathJoin(folder, fileName) {
    const sep = isWindowsPath(folder) ? '\\' : '/';
    return folder.replace(/[\\\/]+$/, '') + sep + fileName;
}

function parentPath(path) {
    const t = String(path).replace(/[\\\/]+$/, '');
    const i = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'));
    return i > 0 ? t.slice(0, i) : t;
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
    try { return Boolean(FileSystemApi.exists(path)); } catch (e) {}
    try { return File.size(path) > 0; } catch (e2) { return false; }
}

function fileSize(path) {
    try { return File.size(path); } catch (e) { return 0; }
}

// Creates every missing folder level (createDirectories if available, otherwise level by level).
function ensureDirectories(path) {
    try {
        if (FileSystemApi.createDirectories) {
            FileSystemApi.createDirectories(path);
            return;
        }
    } catch (e) {}
    if (!FileSystemApi.createDirectory) return;
    const sep = isWindowsPath(path) ? '\\' : '/';
    const rootMatch = /^([A-Za-z]:[\\\/]?|\\\\|\/)/.exec(path);
    const root = rootMatch ? rootMatch[0] : '';
    const rest = path.slice(root.length).split(/[\\\/]+/).filter(Boolean);
    let current = root.replace(/[\\\/]+$/, '');
    for (const part of rest) {
        current = current + sep + part;
        try { FileSystemApi.createDirectory(current); } catch (e2) {}
    }
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

function fmtBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function tip(control, text) {
    try { control.description = text; } catch (e) {}
}

function compareNames(a, b) {
    try { return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }); } catch (e) {}
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x < y ? -1 : (x > y ? 1 : 0);
}

// Destination handling (macOS + Windows)

function appString(names) {
    for (const name of names) {
        try {
            let value = app[name];
            if (typeof value === 'function') value = value.call(app);
            if (typeof value === 'string' && value) return value;
        } catch (e) {}
    }
    return '';
}

function resolveDesktop() {
    return appString(['userDesktopPath', 'getUserDesktopPath', 'desktopPath']);
}

function knownFolder(kind, desktop) {
    const apiNames = {
        documents: ['userDocumentsPath', 'getUserDocumentsPath', 'documentsPath'],
        downloads: ['userDownloadsPath', 'getUserDownloadsPath', 'downloadsPath'],
        pictures:  ['userPicturesPath', 'getUserPicturesPath', 'picturesPath'],
    };
    const fromApi = appString(apiNames[kind] || []);
    if (fromApi) return fromApi;
    const folderNames = { documents: 'Documents', downloads: 'Downloads', pictures: 'Pictures' };
    return pathJoin(parentPath(desktop), folderNames[kind] || 'Documents');
}

// Accepts typed/pasted paths: quotes, file:// URLs, ~, %USERPROFILE%, $HOME, relative-to-Desktop.
function normalizeUserPath(raw, desktop) {
    let p = trim(raw).replace(/^["']+|["']+$/g, '');
    if (!p) return '';
    if (/^file:\/\//i.test(p)) {
        p = p.replace(/^file:\/\//i, '');
        if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
        try { p = decodeURIComponent(p); } catch (e) {}
    }
    const home = parentPath(desktop);
    p = p.replace(/^~(?=$|[\\\/])/, home)
         .replace(/^%USERPROFILE%/i, home)
         .replace(/^\$HOME/, home);
    if (!isAbsolutePath(p)) p = pathJoin(desktop, p);
    return p.replace(/[\\\/]+$/, '') || p;
}

function extractPath(result) {
    if (typeof result === 'string') return trim(result);
    if (!result || typeof result !== 'object') return '';
    for (const key of ['path', 'fsName', 'fullPath', 'folder', 'directory', 'selectedPath', 'selectedFolder', 'value']) {
        try {
            const v = result[key];
            if (typeof v === 'string' && trim(v)) return trim(v);
        } catch (e) {}
    }
    for (const key of ['paths', 'files', 'folders']) {
        try {
            const arr = result[key];
            if (arr && arr.length && typeof arr[0] === 'string') return trim(arr[0]);
        } catch (e2) {}
    }
    return '';
}

function ownNames(obj) {
    const names = [];
    try { names.push(...Object.getOwnPropertyNames(obj)); } catch (e) {}
    try {
        const proto = Object.getPrototypeOf(obj);
        if (proto && proto !== Object.prototype && proto !== Function.prototype) names.push(...Object.getOwnPropertyNames(proto));
    } catch (e2) {}
    return names;
}

/**
 * Looks for a native "choose folder" function in the scripting SDK and calls it.
 * The Affinity SDK does not document one, so this scans the SDK modules for a
 * function named like selectFolder / pickFolder / chooseDirectory / browseFolder.
 * Returns { status: 'ok' | 'cancel' | 'unavailable', path, tried: [] }.
 */
function pickFolderNative(title, startPath) {
    const tried = [];
    const sources = [];
    for (const id of ['/dialog', '/fs', '/application']) {
        try { sources.push({ id, obj: require(id) }); } catch (e) {}
    }
    sources.push({ id: 'app', obj: app });
    sources.push({ id: 'FileSystemApi', obj: FileSystemApi });
    sources.push({ id: 'File', obj: File });

    const fnRe = /^(select|pick|choose|browse|prompt|ask)\w*(folder|dir)/i;
    const clsRe = /(folder|dir(ectory)?)\w*(dialog|picker|chooser)/i;
    const seen = new Set();
    const candidates = [];

    function scan(obj, label, depth) {
        if (!obj || seen.has(obj) || depth > 2) return;
        if (typeof obj !== 'object' && typeof obj !== 'function') return;
        seen.add(obj);
        for (const name of ownNames(obj)) {
            if (name === 'constructor' || name === 'prototype' || name === 'length' || name === 'name') continue;
            let value;
            try { value = obj[name]; } catch (e) { continue; }
            const path = `${label}.${name}`;
            if (typeof value === 'function' && fnRe.test(name)) {
                candidates.push({ kind: 'fn', owner: obj, fn: value, label: path });
            } else if ((typeof value === 'function' || typeof value === 'object') && clsRe.test(name) && depth < 2) {
                candidates.push({ kind: 'class', cls: value, label: path });
            }
            if (depth < 1 && (typeof value === 'function' || typeof value === 'object')) scan(value, path, depth + 1);
        }
    }
    for (const source of sources) scan(source.obj, source.id, 0);

    for (const candidate of candidates) {
        try {
            if (candidate.kind === 'fn') {
                const result = candidate.fn.call(candidate.owner, title, startPath);
                tried.push(candidate.label);
                const p = extractPath(result);
                if (p) return { status: 'ok', path: p, tried };
                return { status: 'cancel', path: '', tried };
            }
            const cls = candidate.cls;
            const dialog = typeof cls.create === 'function' ? cls.create(title) : null;
            if (!dialog) continue;
            try { if (startPath) dialog.initialPath = startPath; } catch (e1) {}
            let result = null;
            if (typeof dialog.runModal === 'function') result = dialog.runModal();
            else if (typeof dialog.show === 'function') result = dialog.show();
            tried.push(candidate.label);
            const accepted = !result || result === true || (result.value !== undefined && DialogResult && result.value === DialogResult.Ok.value);
            if (!accepted) return { status: 'cancel', path: '', tried };
            const p = extractPath(dialog) || extractPath(result);
            if (p) return { status: 'ok', path: p, tried };
        } catch (e3) {
            tried.push(`${candidate.label} (error: ${describeError(e3)})`);
        }
    }
    return { status: 'unavailable', path: '', tried };
}

function resolveBaseFolder(options, desktop, notes) {
    switch (options.location) {
        case 'documents':
        case 'downloads':
        case 'pictures':
            return knownFolder(options.location, desktop);
        case 'custom': {
            const custom = normalizeUserPath(options.customPath, desktop);
            if (!custom) {
                notes.push('Custom path was empty - using Desktop.');
                return desktop;
            }
            return custom;
        }
        default:
            return desktop;
    }
}

function buildDestination(base, options, docTitle) {
    let dest = base;
    const segments = String(options.subFolder || '').split(/[\\\/]+/).filter(Boolean).map(sanitizeFileName);
    for (const segment of segments) dest = pathJoin(dest, segment);
    if (options.groupByDoc) dest = pathJoin(dest, sanitizeFileName(docTitle) || 'Export');
    return dest;
}

// Export presets

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

// Document / artboard helpers

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

// "home, about, -draft": include names containing any plain term, exclude names containing any -term.
function parseFilter(text) {
    const inc = [];
    const exc = [];
    trim(text).split(',').map(trim).filter(Boolean).forEach(token => {
        if (token.charAt(0) === '-') {
            const value = trim(token.slice(1)).toLowerCase();
            if (value) exc.push(value);
        } else {
            inc.push(token.toLowerCase());
        }
    });
    return { inc, exc };
}

function passesFilter(label, filter) {
    const lower = String(label).toLowerCase();
    if (filter.exc.some(t => lower.indexOf(t) >= 0)) return false;
    if (filter.inc.length && !filter.inc.some(t => lower.indexOf(t) >= 0)) return false;
    return true;
}

function sortTargets(targets, order) {
    if (order === 'asc') return targets.slice().sort((a, b) => compareNames(a.label, b.label));
    if (order === 'desc') return targets.slice().sort((a, b) => compareNames(b.label, a.label));
    return targets;
}

// Sizing, naming, planning

function rasterScale(size) {
    return size.dpi ? size.dpi / 72 : size.mult;
}

function rasterSize(box, size) {
    const scale = rasterScale(size);
    if (!box) {
        if (size.dpi) throw new Error('Could not read the item size - DPI sizing unavailable.');
        return null;
    }
    if (Math.abs(scale - 1) < 0.0001) return null;
    const w = Math.max(1, Math.round(box.width * scale));
    const h = Math.max(1, Math.round(box.height * scale));
    try { return new Size(w, h); } catch (e) { return null; }
}

function sizeLabel(size) {
    if (!size) return '';
    return size.dpi ? `${size.dpi}dpi` : `${size.mult}x`;
}

function sizeSuffix(size, resolution, forceSuffix) {
    if (!size) return '';
    const multi = resolution.list.length > 1;
    if (!multi && !forceSuffix) return '';
    if (size.dpi) return `_${size.dpi}dpi`;
    return (size.mult === 1 && multi) ? '' : `@${size.mult}x`;
}

// Tokens: {name} {n} {doc} {date} {w} {h}
function applyPattern(pattern, context) {
    const text = trim(pattern) || DEFAULT_PATTERN;
    return text.replace(/\{(\w+)\}/g, (match, key) => {
        switch (key.toLowerCase()) {
            case 'name': return context.name;
            case 'n':    return context.n;
            case 'doc':  return context.doc;
            case 'date': return context.date;
            case 'w':    return context.w;
            case 'h':    return context.h;
            default:     return match;
        }
    });
}

function buildPlan(targets, usableFormats, options, docTitle) {
    const plan = [];
    const usedNames = new Set();
    const indexWidth = String(targets.length).length;
    const date = new Date().toISOString().slice(0, 10);

    targets.forEach((target, i) => {
        const box = target.box;
        const context = {
            name: sanitizeFileName(target.label),
            n: String(i + 1).padStart(indexWidth, '0'),
            doc: sanitizeFileName(docTitle),
            date: date,
            w: box ? String(Math.round(box.width)) : '',
            h: box ? String(Math.round(box.height)) : '',
        };
        const base = sanitizeFileName(applyPattern(options.pattern, context));
        let unique = base;
        let counter = 2;
        while (usedNames.has(unique.toLowerCase())) unique = `${base}-${counter++}`;
        usedNames.add(unique.toLowerCase());

        for (const entry of usableFormats) {
            const sizes = entry.format.raster ? options.resolution.list : [null];
            for (const size of sizes) {
                plan.push({
                    target: target,
                    index: i,
                    entry: entry,
                    size: size,
                    fileName: `${unique}${sizeSuffix(size, options.resolution, options.sizeSuffix)}.${entry.format.extension}`,
                });
            }
        }
    });
    return plan;
}

// ---------------------------------------------------------------------------
// Packaging helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Dialog (two columns; help text lives in tooltips)
// ---------------------------------------------------------------------------

function showOptionsDialog(presets, counts, desktop) {
    const dialog = Dialog.create(TITLE);
    dialog.initialWidth = 620;

    const left = dialog.addColumn();
    let right = left;
    try { right = dialog.addColumn() || left; } catch (e) { right = left; }

    // ----- LEFT: formats -----
    const grpFormat = left.addGroup('Formats');
    const checks = [];
    for (const format of FORMATS) {
        const preset = findPreset(format, presets);
        const check = grpFormat.addCheckBox(format.label, false);
        check.isEnabled = Boolean(preset);
        tip(check, preset ? format.hint : 'No matching export preset in this Affinity installation.');
        checks.push({ format, preset, check });
    }
    const firstAvailable = checks.find(c => c.preset);
    if (firstAvailable) firstAvailable.check.value = true;

    // ----- LEFT: output -----
    const grpOut = left.addGroup('Output');
    grpOut.enableSeparator = true;

    const scopeDefs = [
        { id: 'all',      label: `All artboards (${counts.artboards})`,              enabled: counts.artboards > 0 },
        { id: 'selected', label: `Selected artboards (${counts.selectedArtboards})`, enabled: counts.selectedArtboards > 0 },
        { id: 'objects',  label: `Selected objects (${counts.selectedObjects})`,     enabled: counts.selectedObjects > 0 },
    ];
    let scopeDefault = 0;
    if (scopeDefs[1].enabled && counts.artboards !== counts.selectedArtboards) scopeDefault = 1;
    else if (scopeDefs[0].enabled) scopeDefault = 0;
    else if (scopeDefs[2].enabled) scopeDefault = 2;

    const cmbScope = grpOut.addComboBox('Scope', scopeDefs.map(s => s.label), scopeDefault);
    tip(cmbScope, 'What to export. "Selected objects" exports each selected object as its own file.');
    scopeDefs.forEach((s, i) => {
        if (!s.enabled) {
            try { cmbScope.setEnabledAtIndex(i, false); } catch (e) {}
        }
    });

    const cmbScale = grpOut.addComboBox('Size', RESOLUTIONS.map(r => r.label), 1);
    tip(cmbScale, 'Raster formats only. Multi-size options write one file per size (name@2x.png). SVG, PDF and EPS are vector and always exported at native size.');

    const cmbColour = grpOut.addComboBox('Colour', COLOUR_MODES.map(m => m.label), 0);
    tip(cmbColour, 'Colour settings live inside export presets. To force RGB/CMYK/Greyscale, save a custom preset (File > Export > More... > Manage Presets) with the mode in its name, e.g. "PNG CMYK". PDF/X presets are CMYK by definition.');

    const cmbOrder = grpOut.addComboBox('Order', ORDERS.map(o => o.label), 0);
    tip(cmbOrder, 'Order used for {n} numbering and processing.');

    // ----- LEFT: options -----
    const grpOpt = left.addGroup('Options');
    grpOpt.enableSeparator = true;
    const chkSkip = grpOpt.addCheckBox('Skip existing files', false);
    tip(chkSkip, 'Incremental mode: only exports files that are missing.');
    const chkDry = grpOpt.addCheckBox('Dry run (list only)', false);
    tip(chkDry, 'Shows exactly which files would be written and where, without exporting anything.');
    const chkLog = grpOpt.addCheckBox('Save export log (.txt)', false);
    tip(chkLog, 'Writes export-log.txt next to the exported files.');

    // ----- RIGHT: destination -----
    const grpDest = right.addGroup('Destination');
    const cmbLoc = grpDest.addComboBox('Save to', LOCATIONS.map(l => l.label), 0);
    tip(cmbLoc, `Desktop: ${desktop}\nBrowse opens the system folder picker (macOS Finder / Windows Explorer) after you press OK, if this Affinity build supports it.`);
    const txtPath = grpDest.addTextBox('Custom path', '');
    txtPath.isFullWidth = true;
    tip(txtPath, 'Used when "Save to" is Custom path. Accepts macOS (/Users/me/Exports, ~/Exports) and Windows (C:\\Users\\me\\Exports) paths. Relative paths start from the Desktop.');
    const txtSub = grpDest.addTextBox('Subfolder', 'Artboard Export');
    txtSub.isFullWidth = true;
    tip(txtSub, 'Created inside the destination. Can be nested, e.g. Exports/Web. Leave empty to write straight into the destination.');

    // ----- RIGHT: files -----
    const grpFiles = right.addGroup('Files');
    grpFiles.enableSeparator = true;
    const txtPattern = grpFiles.addTextBox('Name pattern', DEFAULT_PATTERN);
    txtPattern.isFullWidth = true;
    tip(txtPattern, 'Tokens: {name} artboard name, {n} order number, {doc} document name, {date} YYYY-MM-DD, {w} {h} size in px. Example: {doc}_{name}');
    const txtFilter = grpFiles.addTextBox('Name filter', '');
    txtFilter.isFullWidth = true;
    tip(txtFilter, 'Comma separated. Plain terms must appear in the name; terms starting with - are excluded. Example: home, about, -draft');
    const chkSuffix = grpFiles.addCheckBox('Always add size suffix (@2x)', false);
    tip(chkSuffix, 'Single-size exports normally have no suffix. Multi-size exports always do (1x has none).');
    const chkGroupDoc = grpFiles.addCheckBox('Folder per document', true);
    tip(chkGroupDoc, 'Puts exports in a sub-folder named after this document.');
    const chkFormatFolders = grpFiles.addCheckBox('Folder per format', false);
    tip(chkFormatFolders, 'Sorts files into png/, pdf/, svg/ ... sub-folders.');

    // ----- RIGHT: extras -----
    const grpExtras = right.addGroup('Extras');
    grpExtras.enableSeparator = true;
    const chkPackage = grpExtras.addCheckBox('Package images + fonts list', false);
    tip(chkPackage, 'Copies every image used (linked and embedded) into resources/images and writes package-report.txt listing all fonts. Font files themselves cannot be copied by scripts.');
    const chkFallback = grpExtras.addCheckBox('Fall back to Desktop on failure', true);
    tip(chkFallback, 'Affinity scripting may only be allowed to write to some folders (the Desktop is always safe). If nothing could be written, the whole batch is retried on the Desktop.');

    let result;
    try { result = dialog.runModal(); } catch (e) { return null; }
    if (!result || result.value !== DialogResult.Ok.value) return null;

    const chosen = checks
        .filter(c => c.check.value && c.preset)
        .map(c => ({ format: c.format, preset: c.preset }));
    if (chosen.length === 0) return { error: 'Select at least one available format.' };

    const pick = (combo, list, fallbackIndex) => {
        let index = fallbackIndex;
        try { index = combo.selectedIndex; } catch (e) {}
        return list[index] || list[fallbackIndex];
    };
    const text = control => trim(control.value !== undefined && control.value !== null ? control.value : control.text);

    return {
        formats: chosen,
        scope: pick(cmbScope, scopeDefs, 0).id,
        resolution: pick(cmbScale, RESOLUTIONS, 1),
        colourMode: pick(cmbColour, COLOUR_MODES, 0),
        order: pick(cmbOrder, ORDERS, 0).id,
        skipExisting: chkSkip.value,
        dryRun: chkDry.value,
        writeLog: chkLog.value,
        location: pick(cmbLoc, LOCATIONS, 0).id,
        customPath: text(txtPath),
        subFolder: text(txtSub),
        pattern: text(txtPattern) || DEFAULT_PATTERN,
        filter: text(txtFilter),
        sizeSuffix: chkSuffix.value,
        groupByDoc: chkGroupDoc.value,
        formatFolders: chkFormatFolders.value,
        package: chkPackage.value,
        fallback: chkFallback.value,
    };
}

// ---------------------------------------------------------------------------
// Export run
// ---------------------------------------------------------------------------

function runBatch(doc, plan, dest, options, totalItems) {
    const stats = { exported: 0, skipped: 0, failed: 0, bytes: 0, perFormat: {}, errors: [], lines: [] };
    ensureDirectories(dest);
    const madeDirs = new Set();

    for (const item of plan) {
        const format = item.entry.format;
        const dir = options.formatFolders ? pathJoin(dest, format.extension) : dest;
        if (!madeDirs.has(dir)) {
            ensureDirectories(dir);
            madeDirs.add(dir);
        }
        const outPath = pathJoin(dir, item.fileName);
        const sizeTag = item.size ? ` @${sizeLabel(item.size)}` : '';
        const tag = `[${item.index + 1}/${totalItems}] ${item.target.label} -> ${format.extension.toUpperCase()}${sizeTag}`;

        if (options.skipExisting && fileExists(outPath)) {
            stats.skipped++;
            stats.lines.push(`SKIP  ${outPath}`);
            console.log(`  = ${tag} - skipped (file exists)`);
            continue;
        }

        try {
            const exportOptions = FileExportOptions.createWithPresetName(item.entry.preset);
            const area = targetArea(doc, item.target);
            const pixelSize = item.size ? rasterSize(item.target.box, item.size) : null;
            doc.export(outPath, exportOptions, area, pixelSize);
            stats.exported++;
            stats.perFormat[format.key] = (stats.perFormat[format.key] || 0) + 1;
            stats.bytes += fileSize(outPath);
            stats.lines.push(`OK    ${outPath}`);
            console.log(`  + ${tag}`);
        } catch (e) {
            stats.failed++;
            const message = describeError(e);
            stats.errors.push(`${item.target.label} (${format.extension.toUpperCase()}${sizeTag}): ${message}`);
            stats.lines.push(`FAIL  ${outPath} - ${message}`);
            console.log(`  x ${tag} - ${message}`);
        }
    }
    return stats;
}

function packageResources(doc, destFolder, docTitle, usableFormats, options, resLabel, colourLabel, itemCount) {
    console.log('Collecting package resources...');
    let fonts = [];
    try { fonts = doc.getFontNames().slice().sort(); } catch (e) { fonts = []; }

    const images = collectImageResources(doc);
    let imagesCopied = 0;
    let imagesFailed = 0;
    const imageLines = [];

    if (images.length > 0) {
        const imagesSub = pathJoin(pathJoin(destFolder, 'resources'), 'images');
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
                    imageLines.push(`  [${placement}] ${baseName}${original && original !== baseName ? ' - original: ' + original : ''}`);
                } else {
                    imagesFailed++;
                    imageLines.push(`  [${placement}] ${baseName} - could not be saved`);
                }
            } catch (e4) {
                imagesFailed++;
                imageLines.push(`  [${placement}] ${baseName} - ${describeError(e4)}`);
            }
        }
    }

    const report = [];
    report.push('PACKAGE REPORT');
    report.push(`Document: ${docTitle}`);
    report.push(`Generated: ${new Date().toISOString()}`);
    report.push('');
    report.push('EXPORTS');
    report.push(`  Items exported: ${itemCount}`);
    report.push(`  Formats: ${usableFormats.map(f => f.format.extension.toUpperCase()).join(', ')} @ ${resLabel}`);
    report.push(`  Colour mode: ${colourLabel}`);
    report.push('');
    report.push(`FONTS USED (${fonts.length}) - ensure these are installed on the target machine`);
    if (fonts.length) {
        for (const f of fonts) report.push(`  - ${f}`);
    } else {
        report.push('  (none reported)');
    }
    report.push('');
    report.push(`IMAGES (${imagesCopied} collected, ${imagesFailed} failed) - stored in resources/images/`);
    if (imageLines.length) {
        for (const line of imageLines) report.push(line);
    } else {
        report.push('  (no images found in the document)');
    }
    report.push('');
    report.push('NOTE: Affinity scripting cannot copy font files, only report their names.');

    const reportPath = pathJoin(destFolder, 'package-report.txt');
    const written = writeTextFile(reportPath, report.join('\n'));
    console.log(written ? `Package report written: ${reportPath}` : 'Package report could not be written to disk (API limitation).');

    return {
        written,
        reportPath,
        lines: [
            `Fonts:      ${fonts.length} listed${fonts.length ? ' (' + fonts.slice(0, 3).join(', ') + (fonts.length > 3 ? ', ...' : '') + ')' : ''}`,
            `Images:     ${imagesCopied} collected, ${imagesFailed} failed -> resources/images/`,
        ],
    };
}

function main() {
    const doc = Document.current;
    if (!doc) {
        app.alert(`Open a document first, then run ${TITLE}.`, TITLE);
        return;
    }

    const presets = allPresetNames();
    if (!presets.length) {
        app.alert('Could not read export presets from this Affinity installation.', TITLE);
        return;
    }

    const desktop = resolveDesktop();
    if (!desktop) {
        app.alert('Could not resolve the Desktop path.', TITLE);
        return;
    }

    const allArtboards = doc.hasArtboards ? collectAllArtboards(doc) : [];
    const selectedArtboards = collectSelectedArtboards(doc);
    const selectedObjects = countSelectedNonArtboards(doc);

    if (allArtboards.length === 0 && selectedObjects === 0) {
        app.alert('This document has no artboards and nothing is selected.\n\nUse the Artboard Tool to create artboards, or select\nobjects in the Layers panel, then run again.', TITLE);
        return;
    }

    const options = showOptionsDialog(presets, {
        artboards: allArtboards.length,
        selectedArtboards: selectedArtboards.length,
        selectedObjects: selectedObjects,
    }, desktop);
    if (!options) return;

    if (options.error) {
        app.alert(options.error, TITLE);
        return;
    }

    // ----- destination -----
    const notes = [];
    let basePath = '';
    if (options.location === 'browse') {
        const picked = pickFolderNative('Choose export folder', desktop);
        console.log(`Folder picker: ${picked.status}${picked.tried.length ? ' via ' + picked.tried.join(', ') : ''}`);
        if (picked.status === 'cancel') return;
        if (picked.status === 'ok') {
            basePath = normalizeUserPath(picked.path, desktop);
        } else {
            const custom = normalizeUserPath(options.customPath, desktop);
            basePath = custom || desktop;
            notes.push(`The system folder picker is not available in this Affinity build - using ${custom ? 'your custom path' : 'the Desktop'} instead. Choose "Custom path" and paste a folder path to pick another place.`);
        }
    } else {
        basePath = resolveBaseFolder(options, desktop, notes);
    }

    const docTitle = trim(doc.title || 'export').replace(/\.[^.]+$/, '') || 'export';
    let destFolder = buildDestination(basePath, options, docTitle);

    // ----- targets -----
    const filter = parseFilter(options.filter);
    let targets = buildTargets(doc, options.scope, allArtboards, selectedArtboards);
    const beforeFilter = targets.length;
    targets = targets.filter(t => passesFilter(t.label, filter));
    targets = sortTargets(targets, options.order);
    if (targets.length === 0) {
        app.alert(beforeFilter === 0
            ? 'Nothing to export for the chosen scope.\n\nSelect artboards or objects in the Layers panel\nand run again.'
            : `The name filter "${options.filter}" excluded all ${beforeFilter} item(s).`, TITLE);
        return;
    }

    // ----- presets -----
    const resolvedFormats = options.formats.map(entry => {
        const match = findPresetForMode(entry.format, presets, options.colourMode.key);
        return { format: entry.format, preset: match.preset, applied: match.applied, note: match.note };
    });
    const usableFormats = resolvedFormats.filter(f => f.preset);
    if (usableFormats.length === 0) {
        app.alert('None of the selected formats have a usable export preset.', TITLE);
        return;
    }
    const modeWarnings = resolvedFormats
        .filter(f => f.preset && !f.applied)
        .map(f => `${f.format.label}: no ${options.colourMode.label} preset found - used "${f.preset}" (its own colour settings apply). Create a custom preset with "${options.colourMode.label}" in its name to control this.`);

    const plan = buildPlan(targets, usableFormats, options, docTitle);
    const resLabel = options.resolution.list.map(sizeLabel).join(' + ');
    const colourLabel = options.colourMode.key ? `${options.colourMode.label} (via presets)` : 'Automatic (preset defaults)';

    console.log(`${TITLE} - ${targets.length} item(s), ${plan.length} file(s) -> ${usableFormats.map(f => f.format.extension.toUpperCase()).join(' + ')} @ ${resLabel}`);
    console.log(`Colour: ${colourLabel}`);
    console.log(`Destination: ${destFolder}`);

    // ----- dry run -----
    if (options.dryRun) {
        const sample = plan.slice(0, 25).map(item => {
            const dir = options.formatFolders ? pathJoin(destFolder, item.entry.format.extension) : destFolder;
            return `  ${pathJoin(dir, item.fileName)}`;
        });
        const lines = [
            'DRY RUN - nothing was written.',
            '',
            `Items:   ${targets.length}${beforeFilter !== targets.length ? ` (filtered from ${beforeFilter})` : ''}`,
            `Files:   ${plan.length}`,
            `Sizes:   ${resLabel} (raster) / native (vector)`,
            `Colour:  ${colourLabel}`,
            `Folder:  ${destFolder}`,
            '',
            plan.length > sample.length ? `First ${sample.length} files:` : 'Files:',
            ...sample,
        ];
        if (notes.length) lines.push('', 'Notes:', ...notes.map(n => `  - ${n}`));
        if (modeWarnings.length) lines.push('', 'Colour mode warnings:', ...modeWarnings.map(w => `  - ${w}`));
        app.alert(lines.join('\n'), TITLE);
        return;
    }

    // ----- export (with optional Desktop fallback) -----
    const startedAt = Date.now();
    let stats = runBatch(doc, plan, destFolder, options, targets.length);

    const desktopDest = buildDestination(desktop, options, docTitle);
    if (options.fallback && stats.exported === 0 && stats.skipped === 0 && stats.failed > 0 && desktopDest !== destFolder) {
        notes.push(`Nothing could be written to "${destFolder}" (${stats.errors[0] || 'unknown error'}). Retried on the Desktop.`);
        console.log(`Falling back to Desktop: ${desktopDest}`);
        destFolder = desktopDest;
        stats = runBatch(doc, plan, destFolder, options, targets.length);
    } else if (stats.exported === 0 && stats.failed > 0 && !isDesktopPath(destFolder, desktop)) {
        notes.push('Affinity scripting may only be allowed to write to the Desktop. Try the Desktop (or enable fallback) if exports keep failing.');
    }

    // ----- package -----
    let packageInfo = null;
    if (options.package) {
        packageInfo = packageResources(doc, destFolder, docTitle, usableFormats, options, resLabel, colourLabel, targets.length);
    }

    // ----- log file -----
    let logPath = '';
    let logWritten = false;
    if (options.writeLog) {
        const log = [
            `${TITLE} - export log`,
            `Document: ${docTitle}`,
            `Date: ${new Date().toISOString()}`,
            `Folder: ${destFolder}`,
            `Formats: ${usableFormats.map(f => f.format.extension.toUpperCase()).join(', ')} @ ${resLabel}`,
            `Colour: ${colourLabel}`,
            `Pattern: ${options.pattern}`,
            '',
            ...stats.lines,
        ];
        logPath = pathJoin(destFolder, 'export-log.txt');
        logWritten = writeTextFile(logPath, log.join('\n'));
    }

    // ----- summary -----
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    const lines = [];
    lines.push(stats.failed > 0 && stats.exported === 0 ? 'Export failed.' : 'Batch export finished.');
    lines.push('');
    lines.push(`Items:      ${targets.length}${beforeFilter !== targets.length ? ` (filtered from ${beforeFilter})` : ''}`);
    lines.push(`Exported:   ${stats.exported} file(s)`);
    if (stats.skipped > 0) lines.push(`Skipped:    ${stats.skipped} (already existed)`);
    if (stats.failed > 0) lines.push(`Failed:     ${stats.failed}`);
    lines.push(`Sizes:      ${resLabel} (raster) / native (vector)`);
    lines.push(`Colour:     ${colourLabel}`);
    lines.push(`Folder:     ${destFolder}`);
    if (stats.exported > 0) lines.push(`Total size: ${fmtBytes(stats.bytes)} in ${elapsed}s`);

    if (packageInfo) {
        lines.push('', 'Package:', ...packageInfo.lines);
        lines.push(packageInfo.written ? `Report:     ${packageInfo.reportPath}` : 'Report:     could not be written to disk');
    }
    if (options.writeLog) lines.push(logWritten ? `Log:        ${logPath}` : 'Log:        could not be written to disk');

    const formatLines = usableFormats.map(entry => {
        const count = stats.perFormat[entry.format.key] || 0;
        const modeTag = options.colourMode.key && !entry.applied ? '  [colour mode not applied]' : (entry.note ? `  [${entry.note}]` : '');
        return `  ${entry.format.extension.toUpperCase().padEnd(4)} x ${count}  (preset: "${entry.preset}")${modeTag}`;
    });
    if (formatLines.length) lines.push('', 'Per format:', ...formatLines);

    if (notes.length) lines.push('', 'Notes:', ...notes.map(n => `  - ${n}`));
    if (modeWarnings.length) lines.push('', 'Colour mode warnings:', ...modeWarnings.map(w => `  - ${w}`));

    if (stats.failed > 0) {
        const shown = stats.errors.slice(0, 12);
        lines.push('', 'Failures:', ...shown.map(e => `  - ${e}`));
        if (stats.errors.length > shown.length) lines.push(`  ... and ${stats.errors.length - shown.length} more (see the console)`);
    }

    app.alert(lines.join('\n'), TITLE);
}

function isDesktopPath(path, desktop) {
    const a = String(path).replace(/[\\\/]+$/, '').toLowerCase();
    const b = String(desktop).replace(/[\\\/]+$/, '').toLowerCase();
    return a === b || a.indexOf(b + '/') === 0 || a.indexOf(b + '\\') === 0;
}

main();
