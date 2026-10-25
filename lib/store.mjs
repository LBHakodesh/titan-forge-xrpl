// Tiny JSON-file store plus an event bus shared by all route modules.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

export class Store {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'launches.json');
    this.launches = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : [];
  }
  save() {
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.launches, null, 2));
    fs.renameSync(this.file + '.tmp', this.file);
  }
  add(launch) { this.launches.push(launch); this.save(); return launch; }
  get(id) { return this.launches.find((l) => l.id === id); }
  byCode(code) { return this.launches.find((l) => l.code === code && l.status !== 'failed'); }
  update(id, patch) { Object.assign(this.get(id), patch); this.save(); }
}

// Every event: { type, mode: 'LIVE_TESTNET'|'SIMULATION'|'REPLAY'|'MAINNET_OBSERVED'|'UNAVAILABLE', at, ...payload }
export class Bus extends EventEmitter {
  constructor() { super(); this.setMaxListeners(200); this.recent = []; }
  publish(type, mode, payload = {}) {
    if (!['LIVE_TESTNET', 'SIMULATION', 'REPLAY', 'MAINNET_OBSERVED', 'UNAVAILABLE'].includes(mode)) throw new Error(`Bad mode ${mode}`);
    const ev = { type, mode, at: new Date().toISOString(), ...payload };
    this.recent.push(ev);
    if (this.recent.length > 500) this.recent.shift();
    this.emit('event', ev);
    return ev;
  }
}
