/**
 * INTRANOX · Proxy HubSpot Completo y Corregido
 */

const http = require('http');
const https = require('https');

const HS_TOKEN     = process.env.HS_TOKEN     || '';
const HS_OBJECT_ID = process.env.HS_OBJECT_ID || '2-198173351';
const PORT         = process.env.PORT          || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

if (!HS_TOKEN) {
  console.warn('⚠️  HS_TOKEN no configurado. Añádelo como variable de entorno.');
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS,PATCH',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function hsRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.hubapi.com',
      port: 443,
      path,
      method,
      headers: {
        'Authorization': `Bearer ${HS_TOKEN}`,
        'Content-Type':  'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload, 'utf8') } : {}),
      },
    };

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
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
  });
}

async function router(req, res) {
  const urlParams = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method.toUpperCase();

  if (method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // ── GET /health 
  if (method === 'GET' && urlParams.pathname === '/health') {
    res.writeHead(200, CORS_HEADERS);
    res.end(JSON.stringify({ ok: true, objectId: HS_OBJECT_ID, tokenConfigured: !!HS_TOKEN }));
    return;
  }

  // ── GET /properties 
  if (method === 'GET' && urlParams.pathname === '/properties') {
    try {
      const result = await hsRequest('GET', `/crm/v3/properties/${HS_OBJECT_ID}`);
      res.writeHead(result.status, CORS_HEADERS);
      res.end(JSON.stringify(result.body));
    } catch (e) {
      res.writeHead(500, CORS_HEADERS);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── GET /ofertas 
  if (method === 'GET' && urlParams.pathname === '/ofertas') {
    const props = urlParams.searchParams.get('properties') || '';
    const propList = props ? props.split(',').filter(Boolean) : [];
    const searchBody = {
      limit: 50,
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
      ...(propList.length ? { properties: propList } : {}),
    };
    try {
      const result = await hsRequest('POST', `/crm/v3/objects/${HS_OBJECT_ID}/search`, searchBody);
      res.writeHead(result.status, CORS_HEADERS);
      res.end(JSON.stringify(result.body));
    } catch (e) {
      res.writeHead(500, CORS_HEADERS);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── POST /ofertas/search 
  if (method === 'POST' && urlParams.pathname === '/ofertas/search') {
    const body = await readBody(req);
    try {
      const result = await hsRequest('POST', `/crm/v3/objects/${HS_OBJECT_ID}/search`, body);
      res.writeHead(result.status, CORS_HEADERS);
      res.end(JSON.stringify(result.body));
    } catch (e) {
      res.writeHead(500, CORS_HEADERS);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── POST /ofertas 
  if (method === 'POST' && urlParams.pathname === '/ofertas') {
    const body = await readBody(req);
    if (!body.properties) {
      res.writeHead(400, CORS_HEADERS);
      res.end(JSON.stringify({ error: 'Se requiere { properties: {...} }' }));
      return;
    }
    try {
      const result = await hsRequest('POST', `/crm/v3/objects/${HS_OBJECT_ID}`, { properties: body.properties });
      res.writeHead(result.status, CORS_HEADERS);
      res.end(JSON.stringify(result.body));
    } catch (e) {
      res.writeHead(500, CORS_HEADERS);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── PATCH /ofertas/:id 
  const patchMatch = urlParams.pathname.match(/^\/ofertas\/(\d+)$/);
  if (method === 'PATCH' && patchMatch) {
    const id = patchMatch[1];
    const body = await readBody(req);
    try {
      const result = await hsRequest('PATCH', `/crm/v3/objects/${HS_OBJECT_ID}/${id}`, { properties: body.properties });
      res.writeHead(result.status, CORS_HEADERS);
      res.end(JSON.stringify(result.body));
    } catch (e) {
      res.writeHead(500, CORS_HEADERS);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── GET /companies 
  if (method === 'GET' && urlParams.pathname === '/companies') {
    const query = urlParams.searchParams.get('q') || '';
    const body = {
      properties: ["name", "domain"],
      limit: 100
    };
    if (query) {
      body.filterGroups = [{ filters: [{ propertyName: "name", operator: "CONTAINS_TOKEN", value: `*${query}*` }] }];
    }
    try {
      const result = await hsRequest('POST', '/crm/v3/objects/companies/search', body);
      res.writeHead(result.status, CORS_HEADERS);
      res.end(JSON.stringify(result.body));
    } catch (e) {
      res.writeHead(500, CORS_HEADERS);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── GET /deals 
  if (method === 'GET' && urlParams.pathname === '/deals') {
    const query = urlParams.searchParams.get('q') || '';
    const companyId = urlParams.searchParams.get('companyId');
    const filters = [];
    if (query) filters.push({ propertyName: "dealname", operator: "CONTAINS_TOKEN", value: `*${query}*` });
    if (companyId) filters.push({ propertyName: "associations.company", operator: "EQ", value: companyId });

    const body = { properties: ["dealname", "amount"], limit: 100 };
    if (filters.length > 0) body.filterGroups = [{ filters }];

    try {
      const result = await hsRequest('POST', '/crm/v3/
