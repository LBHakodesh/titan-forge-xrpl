// Authentic Titan Ghost TUI capture loader (replay only).
// Drop a sanitized capture into data/tui-captures/ and the Theater replays it next to the browser recreation:
//   *.cast  asciicast v2: line 1 = header JSON {"version":2,"width":W,"height":H,...}; then [seconds, "o", "data"] per line
//   *.json  frame list:   {"width":W,"height":H,"frames":[{"t":seconds,"text":"full screen (may contain ANSI)"}]}  or a bare array of frames
// Only "o" (output) events are kept. Input events ("i"), env and command fields are dropped. Anything shaped like an
// XRPL secret (family seed s..., hex private key, mnemonic-ish runs) is redacted before it leaves the server.
// No capture present -> { status: 'none' } and the UI says "no authentic capture loaded". Nothing is ever synthesized here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CAPTURE_DIR = process.env.TF_TUI_CAPTURE_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'tui-captures');
export const MAX_BYTES = 8 * 1024 * 1024;
export const MAX_FRAMES = 20_000;
export const NONE_MSG = 'No authentic capture loaded. Browser recreation of the Titan Ghost TUI layout; authentic TUI capture pending from NY-Node.';

const SEED_RE = /\bs[1-9A-HJ-NP-Za-km-z]{24,34}\b/g; // XRPL family seed
// Redact XRPL family seeds and 64/66-hex private keys. Transaction hashes are also 64 hex, so hex is only redacted when
// labeled as a key/secret/seed on the same line; seeds (s...) are always redacted.
export function sanitize(text) {
  let s = String(text);
  s = s.replace(SEED_RE, '[REDACTED]');
  s = s.replace(/((?:secret|seed|private[_ ]?key|priv|mnemonic)[^\n\r]{0,20}?)([0-9A-Fa-f]{64,66}|[a-z]+(?: [a-z]+){11,23})/gi, '$1[REDACTED]');
  return s;
}

export function parseAsciicast(raw) {
  const lines = String(raw).split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('empty capture');
  const head = JSON.parse(lines[0]);
  if (head.version !== 2) throw new Error(`asciicast version ${head.version} not supported (need v2)`);
  const frames = [];
  for (const l of lines.slice(1)) {
    let ev; try { ev = JSON.parse(l); } catch { continue; }
    if (!Array.isArray(ev) || ev[1] !== 'o' || typeof ev[2] !== 'string') continue;
    frames.push({ t: Number(ev[0]) || 0, data: sanitize(ev[2]) });
    if (frames.length >= MAX_FRAMES) break;
  }
  return { format: 'asciicast-v2', kind: 'stream', width: Number(head.width) || 120, height: Number(head.height) || 40, title: head.title ? sanitize(head.title) : null, frames };
}

export function parseFrameList(raw) {
  const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const list = Array.isArray(j) ? j : j.frames;
  if (!Array.isArray(list)) throw new Error('JSON capture needs a frames array');
  const frames = list.slice(0, MAX_FRAMES).map((f, i) => ({ t: Number(f.t ?? f.time ?? i) || 0, data: sanitize(typeof f === 'string' ? f : f.text ?? f.data ?? '') }));
  return { format: 'json-frames', kind: 'snapshots', width: Number(j.width) || 120, height: Number(j.height) || 40, title: j.title ? sanitize(j.title) : null, frames };
}

export function listCaptures(dir = CAPTURE_DIR) {
  try {
    return fs.readdirSync(dir).filter((f) => /\.(cast|json)$/i.test(f)).sort().map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { file: f, bytes: st.size, modifiedAt: st.mtime.toISOString() };
    });
  } catch { return []; }
}

// Load one capture (default: newest by name). Returns { status: 'none' | 'loaded' | 'error', ... }.
export function loadCapture(name, dir = CAPTURE_DIR) {
  const files = listCaptures(dir);
  if (!files.length) return { status: 'none', message: NONE_MSG, dir: path.relative(process.cwd(), dir) || dir, files: [] };
  const pick = name ? files.find((f) => f.file === path.basename(String(name))) : files.at(-1);
  if (!pick) return { status: 'error', error: `No capture named ${name}`, files };
  if (pick.bytes > MAX_BYTES) return { status: 'error', error: `${pick.file} is larger than ${MAX_BYTES} bytes`, files };
  try {
    const raw = fs.readFileSync(path.join(dir, pick.file), 'utf8');
    const cap = /\.cast$/i.test(pick.file) ? parseAsciicast(raw) : parseFrameList(raw);
    return { status: 'loaded', mode: 'REPLAY', authentic: true, source: pick.file, modifiedAt: pick.modifiedAt, sanitized: true, files, ...cap,
      duration: cap.frames.length ? cap.frames.at(-1).t : 0,
      note: 'Recorded Titan Ghost TUI output, replayed. Sanitized on load (seeds/keys redacted, input events dropped).' };
  } catch (e) { return { status: 'error', error: `${pick.file}: ${e.message}`, files }; }
}
