export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `Sos el asistente virtual de Mantello Neumáticos atendiendo por WhatsApp. Representás una empresa profesional de Mendoza, Argentina, hemisferio sur. Tu objetivo es vender y resolver consultas. Trato de vos, tono amable y comercial, como un vendedor profesional de una empresa seria. Sin groserías, sin slang, sin "che", sin informalidad excesiva. Mensajes cortos. Algún emoji ocasional. Jamás usés mexicanismos. Si te preguntan si sos un bot o una IA, respondé honestamente que sí, que sos el asistente virtual de Mantello. Nunca uses la palabra "neumatiquería". El negocio se llama Mantello Neumáticos.

SUCURSALES:
- Casa Central: Francisco Gabrielli 3885, Maipú — Tel: 0261 559-7990
- Godoy Cruz: San Martín y Rivadavia, Godoy Cruz
- Guaymallén: Sarmiento 1150 Afin Sarmiento Local 1, Guaymallén — Tel: 261 593-8312
- Luján de Cuyo: Azcuénaga 496, Luján
- Mercado Central: Mitre 25 y lat norte Acceso Este

HORARIO: Lunes a viernes 9 a 18hs / Sábados 9 a 13hs

SERVICIOS: neumáticos autos/camionetas/camiones/tractores, cambio de aceite y filtros, baterías, tren delantero, frenos, accesorios 4x4. MANTELLO EN CASA: vamos a tu domicilio a cambiar las ruedas.

MARCAS: Bridgestone, Firestone, Michelin, Pirelli, Continental, Kumho, Good Year.

CUANDO TE PASO RESULTADOS DEL CATÁLOGO:
- Mostrá los productos disponibles con nombre, precio y link
- Si hay stock decilo, si dice SIN STOCK avisalo
- Empujá al cliente a comprar online o ir al local
- Siempre incluí el link del producto para que compre directo

CUANDO NO HAY RESULTADOS:
- Decile que esa medida no está en stock online ahora
- Ofrecele consultar por otra medida o ir al local que pueden tener más stock

Para servicios como cambio de aceite, baterías, tren delantero y frenos, NO cotices precios. Decile que esos servicios los tiene que consultar directamente en la sucursal. Siempre preguntá de qué zona es el cliente para recomendarle la sucursal más cercana.

SI NO SABE LA MEDIDA: decile que la puede ver en el lateral de la cubierta actual o en la tapa del baúl.

No saludes ni te presentes en cada mensaje. Solo saludá la primera vez. En mensajes siguientes respondé directamente la consulta sin introducción.

SIEMPRE cerrá con una acción concreta: que compre, que vaya al local, que pida Mantello en Casa. Si no dio su nombre, pedíselo.`;

function extraerMedida(texto) {
  const norm = texto
    .toLowerCase()
    .replace(/r(\d{2})\b/g, ' $1')
    .replace(/[\/\-\.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const match = norm.match(/\b(1[67]\d|1[4-9]\d|2[0-9]\d|3[01]\d)\s+(\d{2})\s+(1[3-9]|2[0-2])\b/);
  if (!match) return null;

  const anchos = [165,175,185,190,195,205,215,225,235,245,255,265,275,285,295,310,315];
  const perfiles = [35,40,45,50,55,60,65,70,75,80];
  const llantas = [13,14,15,16,17,18,19,20,21,22];

  const ancho = parseInt(match[1]);
  const perfil = parseInt(match[2]);
  const llanta = parseInt(match[3]);

  if (!anchos.includes(ancho) || !perfiles.includes(perfil) || !llantas.includes(llanta)) return null;

  return `${ancho}--${perfil}--${llanta}`;
}

async function fetchCatalogo(medida) {
  try {
    const url = `https://mantelloneumaticos.com.ar/page/product_search/${medida}/`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await res.text();

    const productos = [];
    const bloques = html.split('COD:');

    for (let i = 1; i < bloques.length && productos.length < 5; i++) {
      const bloque = bloques[i];
      const precioMatch = bloque.match(/\$([\d,\.]+)\.00/);
      const nombreMatch = bloque.match(/#+\s*([\d\/\-\w\s]+(?:ECOPIA|BRIDGESTONE|FIRESTONE|MICHELIN|PIRELLI|KUMHO|CONTINENTAL|GOOD YEAR|F-\d+|EP\d+|[\w\-]+))/i);
      const linkMatch = bloque.match(/product_detail\/(\d+)\/([\w\-]+)/);
      const stockMatch = bloque.match(/SIN STOCK/i);

      if (precioMatch && linkMatch) {
        const precio = precioMatch[1].replace(/\./g, '').replace(',', '.');
        const nombre = nombreMatch ? nombreMatch[1].trim() : `Neumático ${medida.replace(/--/g, '/')}`;
        const link = `https://mantelloneumaticos.com.ar/page/product_detail/${linkMatch[1]}/${linkMatch[2]}`;
        const stock = !stockMatch;
        productos.push({ nombre, precio: `$${precio}`, stock, link });
      }
    }

    return { medida: medida.replace(/--/g, '/'), productos, url };
  } catch (e) {
    return null;
  }
}

async function getHistorial(subscriberId, redisUrl, redisToken) {
  try {
    const res = await fetch(`${redisUrl}/get/chat:${subscriberId}`, {
      headers: { Authorization: `Bearer ${redisToken}` }
    });
    const data = await res.json();
    if (data.result && typeof data.result === 'string') {
      return JSON.parse(data.result);
    }
    return [];
  } catch (e) {
    return [];
  }
}

async function saveHistorial(subscriberId, historial, redisUrl, redisToken) {
  try {
    const ultimos = historial.slice(-10);
    const params = new URLSearchParams({ ex: '86400' });
    await fetch(`${redisUrl}/set/chat:${subscriberId}?${params}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redisToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify(ultimos))
    });
  } catch (e) {}
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  try {
    const body = await req.json();
    const mensaje = body.mensaje || '';
    const nombre = body.nombre || '';
    const subscriberId = body.subscriber_id || 'anonimo';
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const redisUrl = process.env.KV_REST_API_URL;
    const redisToken = process.env.KV_REST_API_TOKEN;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key no configurada' }), { status: 500 });
    }

    // Obtener historial
    let historial = [];
    if (redisUrl && redisToken) {
      historial = await getHistorial(subscriberId, redisUrl, redisToken);
    }

    // Extraer medida y buscar catálogo
    const medida = extraerMedida(mensaje);
    let contextoProductos = '';

    if (medida) {
      const catalogo = await fetchCatalogo(medida);
      if (catalogo && catalogo.productos.length > 0) {
        const lista = catalogo.productos.map(p =>
          `- ${p.nombre} | ${p.precio} | ${p.stock ? '✅ EN STOCK' : '❌ SIN STOCK'} | ${p.link}`
        ).join('\n');
        contextoProductos = `\n\nRESULTADOS DEL CATÁLOGO para medida ${catalogo.medida}:\n${lista}\n\nURL de búsqueda: ${catalogo.url}`;
      } else if (catalogo) {
        contextoProductos = `\n\nRESULTADOS DEL CATÁLOGO para medida ${medida.replace(/--/g, '/')}: Sin productos disponibles online ahora.\nURL: ${catalogo.url}`;
      }
    }

    // Armar mensajes con historial
    const mensajeActual = mensaje + contextoProductos + (nombre ? `\n\n[Nombre del cliente: ${nombre}]` : '');
    const messages = [
      ...historial,
      { role: 'user', content: mensajeActual }
    ];

    // Llamar a Claude
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages
      })
    });

    const claudeData = await claudeRes.json();
    const respuesta = claudeData.content?.[0]?.text || 'Error al generar respuesta';

    // Guardar historial actualizado
    if (redisUrl && redisToken) {
      const nuevoHistorial = [
        ...historial,
        { role: 'user', content: mensaje },
        { role: 'assistant', content: respuesta }
      ];
      await saveHistorial(subscriberId, nuevoHistorial, redisUrl, redisToken);
    }

    return new Response(JSON.stringify({ respuesta }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
