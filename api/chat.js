export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `Sos el asistente virtual de Mantello Neumáticos atendiendo por WhatsApp. Representás una empresa profesional de Mendoza, Argentina, hemisferio sur. Tu objetivo es vender y resolver consultas. Trato de vos, tono amable y comercial, como un vendedor profesional de una empresa seria. Sin groserías, sin slang, sin "che", sin informalidad excesiva. Mensajes cortos. Algún emoji ocasional. Jamás usés mexicanismos. Si te preguntan si sos un bot o una IA, respondé honestamente que sí, que sos el asistente virtual de Mantello.

SUCURSALES:
- Casa Central: Gabrielli 3885, Maipú — Tel: 0261 559-7990
- Godoy Cruz: San Martín y Rivadavia
- Guaymallén: Sarmiento 1150 — Tel: 261 593-8312
- Luján: Azcuénaga 496
- Mercado Central: Mitre 25, lat norte Acceso Este

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

SI NO SABE LA MEDIDA: decile que la puede ver en el lateral de la cubierta actual o en la tapa del baúl.

SIEMPRE cerrá con una acción concreta: que compre, que vaya al local, que pida Mantello en Casa. Si no dio su nombre, pedíselo. Nunca uses la palabra "neumatiquería". El negocio se llama Mantello Neumáticos.`;

function extraerMedida(texto) {
  // Normalizar el texto
  const norm = texto
    .toLowerCase()
    .replace(/r(\d{2})\b/g, ' $1') // r16 → 16
    .replace(/[\/\-\.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Patrones de medida: ancho perfil llanta
  const anchos = [165,175,185,190,195,205,215,225,235,245,255,265,275,285,295,310,315];
  const perfiles = [35,40,45,50,55,60,65,70,75,80];
  const llantas = [13,14,15,16,17,18,19,20,21,22];

  const match = norm.match(/\b(1[67]\d|1[4-9]\d|2[0-9]\d|3[01]\d)\s+(\d{2})\s+(1[3-9]|2[0-2])\b/);
  if (!match) return null;

  const ancho = parseInt(match[1]);
  const perfil = parseInt(match[2]);
  const llanta = parseInt(match[3]);

  if (!anchos.includes(ancho) || !perfiles.includes(perfil) || !llantas.includes(llanta)) return null;

  return `${ancho}--${perfil}--${llanta}`;
}

async function fetchCatalogo(medida) {
  try {
    const url = `https://mantelloneumaticos.com.ar/page/product_search/${medida}/`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await res.text();

    // Extraer productos del HTML
    const productos = [];
    const regex = /COD:\s*(\d+)[^$]*\$([\d,\.]+)[^<]*<\/.*?>\s*(COMPRAR|SIN STOCK|CONSULTAR)[\s\S]*?product_detail\/(\d+)\/([\w\-]+)/g;
    
    // Parser más robusto basado en los patrones del HTML de Mantello
    const bloques = html.split('COD:');
    
    for (let i = 1; i < bloques.length && productos.length < 5; i++) {
      const bloque = bloques[i];
      
      const codMatch = bloque.match(/^[\s\(]*(\d+)/);
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
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key no configurada' }), { status: 500 });
    }

    // Intentar extraer medida
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
        contextoProductos = `\n\nRESULTADOS DEL CATÁLOGO para medida ${medida.replace(/--/g, '/')}: Sin productos disponibles online en este momento.\nURL: ${catalogo.url}`;
      }
    }

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
        messages: [{
          role: 'user',
          content: mensaje + contextoProductos + (nombre ? `\n\n[Nombre del cliente: ${nombre}]` : '')
        }]
      })
    });

    const claudeData = await claudeRes.json();
    const respuesta = claudeData.content?.[0]?.text || 'Error al generar respuesta';

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
