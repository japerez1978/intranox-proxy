const URL = require('url').URL;
const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const HS_TOKEN = process.env.HS_TOKEN || '';
const HS_OBJECT_ID = process.env.HS_OBJECT_ID || '2-198173351';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

function hsRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    let payload = null;
    if (body) {
      try { payload = JSON.stringify(body); } catch (e) { payload = body; }
    }

    const options = {
      hostname: 'api.hubapi.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${HS_TOKEN.trim()}`,
        'Content-Type': 'application/json',
      }
    };

    if (payload) {
      options.headers['Content-Length'] = Buffer.byteLength(payload, 'utf8');
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch (e) { resolve(body); }
    });
  });
}

async function router(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const urlParams = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method.toUpperCase();

  if (method === 'GET' && urlParams.pathname === '/health') {
    res.writeHead(200, CORS_HEADERS);
    res.end(JSON.stringify({ ok: true, objectId: HS_OBJECT_ID, tokenConfigured: !!HS_TOKEN }));
    return;
  }

  // ── START ROUTE: VINCULACIONES UNIVERSALES ──
  if (urlParams.pathname.startsWith('/proxy/')) {
    const targetPath = req.url.replace('/proxy', '');
    try {
      const body = (method === 'POST' || method === 'PUT' || method === 'PATCH') ? await readBody(req) : null;
      const result = await hsRequest(method, targetPath, body);
      res.writeHead(result.status, CORS_HEADERS);
      res.end(JSON.stringify(result.body));
    } catch (e) {
      res.writeHead(500, CORS_HEADERS);
      res.end(JSON.stringify({ error: 'HubSpot Proxy Request Failed', details: e.message }));
    }
    return;
  }
  // ── END ROUTE ──

  if (['/companies', '/deals', '/contacts', '/ofertas', '/properties', '/ofertas/search'].includes(urlParams.pathname)) {
      if (method === 'GET' && urlParams.pathname === '/companies') {
          const result = await hsRequest('GET', `/crm/v3/objects/companies?limit=100&properties=name,domain`);
          res.writeHead(result.status, CORS_HEADERS); res.end(JSON.stringify(result.body)); return;
      }
      if (method === 'GET' && urlParams.pathname === '/deals') {
          const companyId = urlParams.searchParams.get('companyId');
          const p = `/crm/v3/objects/deals/search`;
          const b = companyId 
            ? { filterGroups: [{ filters: [{ propertyName: "associations.company", operator: "EQ", value: companyId }] }], properties: ["dealname", "amount"], limit: 100 }
            : { properties: ["dealname", "amount"], limit: 100 };
          const result = await hsRequest('POST', p, b);
          res.writeHead(result.status, CORS_HEADERS); res.end(JSON.stringify(result.body)); return;
      }
      if (method === 'GET' && urlParams.pathname === '/contacts') {
          const companyId = urlParams.searchParams.get('companyId');
          const p = `/crm/v3/objects/contacts/search`;
          const b = companyId 
            ? { filterGroups: [{ filters: [{ propertyName: "associations.company", operator: "EQ", value: companyId }] }], properties: ["firstname", "lastname", "email"], limit: 100 }
            : { properties: ["firstname", "lastname", "email"], limit: 100 };
          const result = await hsRequest('POST', p, b);
          res.writeHead(result.status, CORS_HEADERS); res.end(JSON.stringify(result.body)); return;
      }
      if (method === 'GET' && urlParams.pathname === '/ofertas') {
          const result = await hsRequest('GET', `/crm/v3/objects/${HS_OBJECT_ID}?properties=n__de_oferta,numero_de_oferta_heredado,dealname,tipo_de_obra__proyecto,estado_de_la_oferta_presupuesto,amount,presupuestador_asignado,createdate&limit=100`);
          res.writeHead(result.status, CORS_HEADERS); res.end(JSON.stringify(result.body)); return;
      }
      if (method === 'POST' && urlParams.pathname === '/ofertas') {
          const body = await readBody(req);
          const hubspotPayload = { properties: body.properties || body };
          const result = await hsRequest('POST', `/crm/v3/objects/${HS_OBJECT_ID}`, hubspotPayload);
          res.writeHead(result.status, CORS_HEADERS); res.end(JSON.stringify(result.body)); return;
      }
      if (method === 'POST' && urlParams.pathname === '/ofertas/search') {
          const body = await readBody(req);
          const result = await hsRequest('POST', `/crm/v3/objects/${HS_OBJECT_ID}/search`, body);
          res.writeHead(result.status, CORS_HEADERS); res.end(JSON.stringify(result.body)); return;
      }
      if (method === 'GET' && urlParams.pathname === '/properties') {
          const result = await hsRequest('GET', `/crm/v3/properties/${HS_OBJECT_ID}`);
          res.writeHead(result.status, CORS_HEADERS); res.end(JSON.stringify(result.body)); return;
      }
  }

  if (method === 'GET' && urlParams.pathname.startsWith('/ofertas/versiones/')) {
      const dealId = urlParams.pathname.split('/').pop();
      try {
        const body = {
          filterGroups: [{ filters: [{ propertyName: "associations.deal", operator: "EQ", value: dealId }] }],
          properties: ["n__de_oferta", "numero_de_oferta_heredado"],
          limit: 100
        };
        const result = await hsRequest('POST', `/crm/v3/objects/${HS_OBJECT_ID}/search`, body);
        res.writeHead(result.status, CORS_HEADERS);
        res.end(JSON.stringify({ ...result.body, count: result.body.total || 0, siguiente: (result.body.total || 0) + 1 }));
      } catch(e) {
        res.writeHead(200, CORS_HEADERS); res.end(JSON.stringify({ count: 0, siguiente: 1 }));
      }
      return;
  }

  res.writeHead(404, CORS_HEADERS);
  res.end(JSON.stringify({ error: 'Ruta no encontrada' }));
}

const server = http.createServer((req, res) => {
  router(req, res).catch(err => {
    if (!res.headersSent) {
      res.writeHead(500, CORS_HEADERS);
      res.end(JSON.stringify({ error: err.message }));
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Proxy escuchando en puerto ${PORT}`);
});
