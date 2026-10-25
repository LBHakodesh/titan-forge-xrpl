#!/usr/bin/env node
// Pre-render the simple pitch's narration (public/pitch.js SCENE_DEFS[].say) with the self-hosted Kokoro TTS on this node.
//   node scripts/render-pitch-audio.mjs [--voice af_heart] [--speed 1] [--force]
// Writes public/pitch-audio/scene-NN.wav (one per narrated scene; the presenter slot and visual-only beats have none) and manifest.json
// with each file's measured duration. Idempotent: a scene is re-rendered only when its text, voice or speed changed
// (or --force). Exits 1 if any narration (lead-in + audio + 0.3 s) would not fit inside its scene.
// Local only: talks to 127.0.0.1:5131 (no external network). Max 600 chars per TTS request.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SCENE_DEFS, speechText, audioFile, leadOf } from '../public/pitch.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'pitch-audio');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const VOICE = flag('--voice', 'af_heart');
const SPEED = Number(flag('--speed', '1'));
const FORCE = args.includes('--force');
const TTS = process.env.TF_TTS_URL || 'http://127.0.0.1:5131';
const PAD = 0.3;

// Duration of a PCM WAV from its header (fmt byteRate and data chunk size).
export function wavDuration(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let off = 12, byteRate = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4), size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(off + 16);
    if (id === 'data') { if (!byteRate) throw new Error('fmt chunk missing'); return Math.min(size, buf.length - off - 8) / byteRate; }
    off += 8 + size + (size % 2);
  }
  throw new Error('data chunk missing');
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const manPath = path.join(OUT, 'manifest.json');
  let prev = {}; try { prev = JSON.parse(fs.readFileSync(manPath, 'utf8')); } catch {}
  const prevBy = Object.fromEntries((prev.scenes || []).map((s) => [s.id, s]));
  const scenes = []; let bad = 0;
  for (const d of SCENE_DEFS) {
    if (d.talk || d.silent) continue;
    const text = speechText(d.say);
    if (text.length > 600) throw new Error(`${d.id}: narration exceeds 600 chars`);
    const speed = d.speed || SPEED;
    const key = crypto.createHash('sha256').update(JSON.stringify([text, VOICE, speed])).digest('hex').slice(0, 16);
    const file = audioFile(d.id); const fp = path.join(OUT, file);
    let buf;
    if (!FORCE && prevBy[d.id]?.key === key && fs.existsSync(fp)) { buf = fs.readFileSync(fp); }
    else {
      const r = await fetch(`${TTS}/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: VOICE, speed }) });
      if (!r.ok) throw new Error(`${d.id}: TTS HTTP ${r.status}`);
      buf = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(fp, buf);
    }
    const duration = Math.round(wavDuration(buf) * 1000) / 1000;
    const fits = leadOf(d) + duration + PAD <= d.dur;
    if (!fits) bad++;
    scenes.push({ id: d.id, file, duration, lead: leadOf(d), speed, key, scene: d.dur, fits });
    console.log(`${d.id.padEnd(10)} ${file}  ${duration.toFixed(2)} s  (scene ${d.dur} s)${fits ? '' : '  <-- DOES NOT FIT'}`);
  }
  const total = Math.round(scenes.reduce((a, s) => a + s.duration, 0) * 100) / 100;
  fs.writeFileSync(manPath, JSON.stringify({ voice: VOICE, speed: SPEED, engine: 'Kokoro TTS (self-hosted, 127.0.0.1:5131)', format: 'audio/wav', totalSeconds: total, scenes }, null, 2) + '\n');
  console.log(`total narration ${total} s · voice ${VOICE} · ${scenes.length} files`);
  if (bad) { console.error(`${bad} narration(s) do not fit their scene`); process.exit(1); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });
