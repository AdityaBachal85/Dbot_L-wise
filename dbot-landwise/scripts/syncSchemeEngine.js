// Vendors the scheme-engine package's source into public/vendor/scheme-engine/ so the
// static GitHub Pages site can import it directly as browser ES modules (no bundler —
// it's already plain relative-import ESM, so a straight copy works). Run this any time
// scheme-engine/src/ changes, so the two don't silently drift apart.
//
// Run from dbot-landwise/: node scripts/syncSchemeEngine.js

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..', '..', 'scheme-engine', 'src');
const DEST = path.join(__dirname, '..', '..', 'docs', 'vendor', 'scheme-engine', 'src');

await fs.rm(DEST, { recursive: true, force: true });
await fs.cp(SRC, DEST, { recursive: true });
console.log(`Synced ${SRC} -> ${DEST}`);
