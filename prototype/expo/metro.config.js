// Metro serves the shell's JS bundle and, under /vc/, the prototype itself:
// every /vc/* request is passed to the Python server on this computer's
// loopback, so one address (LAN or tunnel) carries both and the Python
// server never has to listen on the network.
const http = require('http');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = 8765;

// Hop-by-hop headers belong to one connection, not to the message.
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding',
  'upgrade', 'te', 'trailer', 'proxy-authenticate', 'proxy-authorization', 'host',
]);

function copyHeaders(source) {
  const out = {};
  for (const [name, value] of Object.entries(source)) {
    if (!HOP_BY_HOP.has(name)) out[name] = value;
  }
  return out;
}

function serverDown(req, res, path) {
  for (const name of res.getHeaderNames()) res.removeHeader(name);
  if (path.startsWith('/api/')) {
    const body = JSON.stringify({ error: 'Kompiuteryje neveikia programėlės serveris. Paleisk Paleisti-telefone.bat.' });
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  const body = '<!doctype html><html lang="lt"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>Serveris neveikia</title></head>'
    + '<body style="font: 17px -apple-system, system-ui, sans-serif; padding: 24px">'
    + '<p>Kompiuteryje neveikia programėlės serveris. Paleisk Paleisti-telefone.bat.</p>'
    + '</body></html>';
  res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function proxyToPrototype(req, res) {
  const [pathname, query = ''] = req.url.split(/\?(.*)/s);
  if (pathname === '/vc') {
    res.writeHead(301, { Location: '/vc/' + (query ? '?' + query : '') });
    res.end();
    return;
  }
  const path = req.url.slice('/vc'.length);
  const headers = copyHeaders(req.headers);
  headers.host = `${TARGET_HOST}:${TARGET_PORT}`;

  // No timeout anywhere: /api/stream stays open for as long as the page does.
  const upstream = http.request(
    { host: TARGET_HOST, port: TARGET_PORT, method: req.method, path, headers },
    (answer) => {
      // Expo's earlier middlewares set no-cache headers; the prototype's own
      // (ETag, Cache-Control, Content-Encoding) go through as they are.
      for (const name of res.getHeaderNames()) res.removeHeader(name);
      res.writeHead(answer.statusCode, answer.statusMessage, copyHeaders(answer.headers));
      // Headers out now, so an event stream starts before its first event.
      res.flushHeaders();
      // Cut off mid-answer (the server stopped): cut the page's answer too,
      // rather than leave it waiting for bytes that will not come.
      answer.on('close', () => { if (!answer.complete) res.destroy(); });
      answer.pipe(res);
    },
  );
  let clientGone = false;
  res.on('close', () => {
    // The page went away mid-answer (a closed event stream): stop asking.
    if (!res.writableFinished) {
      clientGone = true;
      upstream.destroy();
    }
  });
  upstream.on('error', (error) => {
    if (clientGone) return;
    if (res.headersSent) {
      res.destroy(error);
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
      serverDown(req, res, path);
    } else {
      res.statusCode = 502;
      res.end();
    }
  });
  req.pipe(upstream);
}

const previousEnhance = config.server && config.server.enhanceMiddleware;
config.server = {
  ...config.server,
  enhanceMiddleware(metroMiddleware, server) {
    const inner = previousEnhance ? previousEnhance(metroMiddleware, server) : metroMiddleware;
    return (req, res, next) => {
      if (req.url === '/vc' || req.url.startsWith('/vc/') || req.url.startsWith('/vc?')) {
        proxyToPrototype(req, res);
        return;
      }
      inner(req, res, next);
    };
  },
};

module.exports = config;
