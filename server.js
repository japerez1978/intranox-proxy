/**
 * INTRANOX · Proxy HubSpot
 * ─────────────────────────────────────────────
 * Servidor mínimo Node.js que actúa de puente entre
 * la calculadora (HTML) y la API de HubSpot, resolviendo
 * el problema de CORS.
 *
 * Deploy gratuito en Railway: https://railway.app
 *   1. Sube esta carpeta a un repo de GitHub
 *   2. Conecta el repo en Railway → New Project → Deploy from GitHub
 *   3. Añade las variables de entorno (HS_TOKEN y HS_OBJECT_ID)
 *   4. Railway te dará una URL pública tipo https://xxxx.railway.app
 *
 * Variables de entorno necesarias:
 *   HS_TOKEN     → Token de tu app privada de HubSpot (pat-eu1-...)
 *   HS_OBJECT_ID → ID del objeto personalizado Ofertas (2-198173351)
 *   ALLOWED_ORIGIN → Origen permitido (opcional, por defecto *)
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

// ── Cabeceras CORS ──────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

// ── Helper: llamada a HubSpot ───────────────────────────
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
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
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

// ── Helper: leer body de la request ────────────────────
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

// ── Router ──────────────────────────────────────────────
async function router(req, res) {
  const url    = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method.toUpperCase();

  // Preflight CORS
  if (method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // ── GET /health ─────────────────────────────────────
  if (method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, CORS_HEADERS);
    res.end(JSON.stringify({
      ok: true,
      objectId: HS_OBJECT_ID,
      tokenConfigured: !!HS_TOKEN,
    }));
    return;
  }

  // ── GET /properties ─────────────────────────────────
  // Devuelve todas las propiedades del objeto Ofertas
  if (method === 'GET' && url.pathname === '/properties') {
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

  // ── GET /ofertas ─────────────────────────────────────
  // Últimas 20 ofertas
  if (method === 'GET' && url.pathname === '/ofertas') {
    const props  = url.searchParams.get('properties') || '';
    const propList = props ? props.split(',').filter(Boolean) : [];
    const searchBody = {
      limit: 20,
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
      ...(propList.length ? { properties: propList } : {}),
    };
    try {
      const result = await hsRequest('POST',
        `/crm/v3/objects/${HS_OBJECT_ID}/search`, searchBody);
      res.writeHead(result.status, CORS_HEADERS);
      res.end(JSON.stringify(result.body));
    } catch (e) {
      res.writeHead(500, CORS_HEADERS);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── POST /ofertas/search ─────────────────────────────
  // Búsqueda con query libre
  if (method === 'POST' && url.pathname === '/ofertas/search') {
    const body = await readBody(req);
    try {
      const result = await hsRequest('POST',
        `/crm/v3/objects/${HS_OBJECT_ID}/search`, body);
      res.writeHead(result.status, CORS_HEADERS);
      res.end(JSON.stringify(result.body));
    } catch (e) {
      res.writeHead(500, CORS_HEADERS);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── POST /ofertas ─────────────────────────────────────
  // Crear nueva oferta
  if (method === 'POST' && url.pathname === '/ofertas') {
    const body = await readBody(req);
    if (!body.properties || typeof body.properties !== 'object') {
      res.writeHead(400, CORS_HEADERS);
      res.end(JSON.stringify({ error: 'Se requiere { properties: { ... } }' }));
      return;
    }
    try {
      const result = await hsRequest('POST',
        `/crm/v3/objects/${HS_OBJECT_ID}`, { properties: body.properties });
      res.writeHead(result.status, CORS_HEADERS);
      res.end(JSON.stringify(result.body));
    } catch (e) {
      res.writeHead(500, CORS_HEADERS);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── PATCH /ofertas/:id ────────────────────────────────
  // Actualizar oferta existente
  const patchMatch = url.pathname.match(/^\/ofertas\/(\d+)$/);
  if (method === 'PATCH' && patchMatch) {
    const id   = patchMatch[1];
    const body = await readBody(req);
    if (!body.properties || typeof body.properties !== 'object') {
      res.writeHead(400, CORS_HEADERS);
      res.end(JSON.stringify({ error: 'Se requiere { properties: { ... } }' }));
      return;
    }
    try {
      const result = await hsRequest('PATCH',
        `/crm/v3/objects/${HS_OBJECT_ID}/${id}`, { properties: body.properties });
      res.writeHead(result.status, CORS_HEADERS);
      res.end(JSON.stringify(result.body));
    } catch (e) {
      res.writeHead(500, CORS_HEADERS);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  // ── GET /companies ────────────────────────────────────
  // Buscar empresas por nombre
  if (method === 'GET' && url.pathname === '/companies') {
    const query = url.searchParams.get('q') || '';
    const body = {
      filterGroups: [{
        filters: [{
          propertyName: "name",
          operator: "CONTAINS_TOKEN",
          value: `*${query}*`
        }]
      }],
      properties: ["name", "domain"],
      limit: 10
    };
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

  // ── GET /deals ────────────────────────────────────────
  // Buscar negocios por nombre
  if (method === 'GET' && url.pathname === '/deals') {
    const query = url.searchParams.get('q') || '';
    const body = {
      filterGroups: [{
        filters: [{
          propertyName: "dealname",
          operator: "CONTAINS_TOKEN",
          value: `*${query}*`
        }]
      }],
      properties: ["dealname", "amount"],
      limit: 10
    };
    try {
      const result = await hsRequest('POST', '/crm/v3/objects/deals/search', body);
      res.writeHead(result.status, CORS_HEADERS);
      res.end(JSON.stringify(result.body));
    } catch (e) {
      res.writeHead(500, CORS_HEADERS);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── GET /ofertas/versiones/:dealId ────────────────────
  // Calcular siguiente versión del negocio
  const versionMatch = url.pathname.match(/^\/ofertas\/versiones\/(.+)$/);
  if (method === 'GET' && versionMatch) {
    const dealId = versionMatch[1];
    const body = {
      limit: 1,
      sorts: [{ propertyName: "n__de_oferta", direction: "DESCENDING" }],
      properties: ["n__de_oferta"],
      filterGroups: [{
        filters: [{
          propertyName: "associations.deal",
          operator: "EQ",
          value: dealId
        }]
      }]
    };
    try {
      const result = await hsRequest('POST', `/crm/v3/objects/${HS_OBJECT_ID}/search`, body);
      const data = result.body || {};
      const count = data.total || 0;
      res.writeHead(result.status, CORS_HEADERS);
      res.end(JSON.stringify({
        siguiente: count + 1,
        total: count
      }));
    } catch (e) {
      res.writeHead(500, CORS_HEADERS);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── 404 ───────────────────────────────────────────────
  res.writeHead(404, CORS_HEADERS);
  res.end(JSON.stringify({ error: 'Ruta no encontrada', routes: [
    'GET  /health',
    'GET  /properties',
    'GET  /ofertas?properties=campo1,campo2',
    'POST /ofertas/search',
    'POST /ofertas',
    'PATCH /ofertas/:id',
  ]}));
}

// ── Arrancar servidor ───────────────────────────────────
const server = http.createServer(router);
server.listen(PORT, () => {
  console.log(`✅ INTRANOX HubSpot Proxy corriendo en puerto ${PORT}`);
  console.log(`   Objeto HubSpot: ${HS_OBJECT_ID}`);
  console.log(`   Token configurado: ${HS_TOKEN ? 'Sí ✓' : 'No ✗'}`);
});
