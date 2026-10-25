// Simulated "network unplugged" for rehearsals and tests (no sudo / network namespaces needed).
//   node --import ./scripts/no-network.mjs server.mjs
// Every outbound TCP connection to a non-loopback address fails with ENETUNREACH and every DNS lookup
// for a non-local name fails with ENOTFOUND, as on a venue Wi-Fi that has dropped. Loopback still works,
// so the server can listen on 127.0.0.1 and talk to itself.
import net from 'node:net';
import dns from 'node:dns';

const LOCAL = new Set(['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']);
const isLocal = (h) => !h || LOCAL.has(String(h).replace(/^\[|\]$/g, '')) || /^127\./.test(h);
const fail = (code, host) => Object.assign(new Error(`${code} ${host} (simulated no-network)`), { code, errno: code, syscall: 'connect', hostname: host });

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const o = typeof args[0] === 'object' && args[0] !== null ? (Array.isArray(args[0]) ? args[0][0] : args[0]) : { port: args[0], host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  if (o && !o.path && !isLocal(o.host)) {
    const err = fail('ENETUNREACH', o.host);
    this.connecting = true;
    process.nextTick(() => this.destroy(err));
    return this;
  }
  return connect.apply(this, args);
};

const lookup = dns.lookup;
dns.lookup = function (host, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  if (isLocal(host)) return lookup.call(this, host, opts, cb);
  process.nextTick(() => cb(fail('ENOTFOUND', host)));
};
const plookup = dns.promises.lookup;
dns.promises.lookup = (host, opts) => (isLocal(host) ? plookup(host, opts) : Promise.reject(fail('ENOTFOUND', host)));

if (process.env.TF_NO_NETWORK_QUIET !== '1') console.log('[no-network] outbound network disabled for this process (simulation)');
