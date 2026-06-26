export const config = { runtime: 'edge' };

const MARCAS_OFICIALES = ['bridgestone', 'firestone', 'dayton'];

function esMarcaOficial(nombreProducto) {
  const nombre = nombreProducto.toLowerCase();
  return MARCAS_OFICIALES.some(m => nombre.includes(m));
}

const SYSTEM_PROMPT = `Sos el asistente virtual de Mantello Neumáticos atendiendo por WhatsApp. Representás una empresa profesional de Mendoza, Argentina. Tu objetivo es vender y resolver consultas. Trato de vos, tono amable y comercial. Sin groserías ni slang. Mensajes cortos como WhatsApp real. Algún emoji ocasional. Jamás usés mexicanismos. Si te preguntan si sos un bot o una IA, respondé honestamente que sí. Nunca uses la palabra "neumatiquería". El negocio se llama Mantello Neumáticos.
IMPORTANTE: Solo saludá en el primer mensaje de la conversación. En los mensajes siguientes respondé directo sin saludar de nuevo. Usá el historial de la conversación para no repetir preguntas ni información que ya se dio. Si el cliente ya dio su medida, no la volvás a pedir.

SUCURSALES:
- Casa Central: Francisco Gabrielli 3885, Maipú — Tel: 0261 559-7990
- Godoy Cruz: San Martín y Rivadavia, Godoy Cruz
- Guaymallén: Sarmiento 1150 Afin Sarmiento Local 1, Guaymallén — Tel: 261 593-8312
- Luján de Cuyo: Azcuénaga 496, Luján
- Mercado Central: Mitre 25 y lat norte Acceso Este

HORARIO: Lunes a viernes 9 a 18hs / Sábados 9 a 13hs

MARCAS OFICIALES: Bridgestone, Firestone y Dayton by Bridgestone.
- Bridgestone es el fabricante número 1 del mundo en neumáticos.
- Dayton es la segunda marca de Bridgestone, fabricada por Bridgestone con 5 años de garantía respaldada por Bridgestone.

CÓMO OFRECER PRODUCTOS:
- Siempre ofrecé de más caro a más barato.
- Los productos marcados como [OFICIAL] tienen link de compra online — mostralo.
- Los productos marcados como [NO OFICIAL] NO tienen link — no mostrés ninguna URL. Decí que para esa marca lo atiende un asesor personalmente a primera hora del próximo día hábil.
- No menciones la cantidad de stock disponible.

VEHÍCULOS INDUSTRIALES Y PESADOS:
- Camiones, maquinaria agrícola, colectivos, micros y cualquier vehículo industrial o de carga: NO ofrezcas productos ni precios. Informá que este segmento lo atiende un asesor especializado y que a primera hora del próximo día hábil lo van a contactar.

SERVICIOS Y PRECIOS:
- Combo Alineación y Balanceo Auto: $45.000
- Combo Alineación y Balanceo Camioneta: $55.000
- Estos servicios están disponibles en todas las sucursales sin turno previo.
- Colocación y balanceo a domicilio: Mantello en Casa — un técnico va a tu domicilio a colocar y balancear las cubiertas.
- Si preguntan por alineación junto con la colocación: se entrega un voucher para que pase por cualquier sucursal cuando pueda.

MEDIOS DE PAGO:
- Contado, transferencia bancaria o 1 cuota sin interés.
- Para financiación en más cuotas: acercarse a cualquier sucursal.

SI PREGUNTAN POR CUBIERTAS PARA UN MODELO DE AUTO ESPECÍFICO (ej: "tengo un Sandero"):
- Decile amablemente que para darte la medida exacta puede mirarla en el lateral de su cubierta actual o en la tapa del baúl.

SI NO SABE LA MEDIDA: decile que la puede ver en el lateral de la cubierta actual o en la tapa del baúl.

SIEMPRE cerrá con una acción concreta: que compre online, que vaya al local, o que espere el contacto del asesor. Si no dio su nombre, pedíselo.`;

const EXTRACT_PROMPT = `Sos un extractor de datos de mensajes sobre neumáticos. Tu única tarea es detectar si el mensaje contiene una medida de neumático y cuántas unidades pide el cliente. Devolvé SOLO un JSON, sin texto adicional, sin explicaciones.

Ejemplos:
- "185/65R15" → {"encontrada": true, "ancho": "185", "perfil": "65", "llanta": "15", "cantidad": 4}
- "necesito 4 gomas 205/55-16" → {"encontrada": true, "ancho": "205", "perfil": "55", "llanta": "16", "cantidad": 4}
- "quiero 2 cubiertas 195/60-15" → {"encontrada": true, "ancho": "195", "perfil": "60", "llanta": "15", "cantidad": 2}
- "cuánto sale una 175/70r13" → {"encontrada": true, "ancho": "175", "perfil": "70", "llanta": "13", "cantidad": 1}
- "necesito el precio de 4 cubiertas 205/55-16" → {"encontrada": true, "ancho": "205", "perfil": "55", "llanta": "16", "cantidad": 4}
- "hola quiero saber precios" → {"encontrada": false}
- "tienen gomas para un Sandero?" → {"encontrada": false}

Reglas:
- Si el cliente no especifica cantidad, usá 4 por defecto.
- La medida puede venir en cualquier formato: 185/65R15, 185-65-15, 185 65 15, etc.
- SOLO JSON, nada más.`;

async function detectarMedidaConClaude(mensaje) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        system: EXTRACT_PROMPT,
        messages: [{ role: 'user', content: mensaje }]
      })
    });
    const data = await res.json();
    const texto = data.content?.[0]?.text || '{"encontrada": false}';
    const clean = texto.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    return { encontrada: false };
  }
}

async function buscarProductos(medida, cantidad) {
  try {
    const { ancho, perfil, llanta } = medida;
    const termino = `${ancho}/${perfil}-${llanta}`;
    const url = `https://mantelloneumaticos.com/wp-json/wc/v3/products?search=${encodeURIComponent(termino)}&per_page=20&status=publish`;

    const ck = process.env.WC_CONSUMER_KEY;
    const cs = process.env.WC_CONSUMER_SECRET;
    const auth = btoa(`${ck}:${cs}`);

    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` }
    });

    if (!res.ok) return null;
    const productos = await res.json();
    const minStock = cantidad || 4;

    const conStock = productos.filter(p =>
      p.stock_status === 'instock' &&
      p.stock_quantity !== null &&
      p.stock_quantity >= minStock
    );

    if (conStock.length === 0) return null;
    conStock.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));

    return conStock.map(p => ({
      nombre: p.name,
      precio: p.price,
      link: p.permalink,
      oficial: esMarcaOficial(p.name)
    }));

  } catch (e) {
    return null;
  }
}

async function obtenerHistorial(subscriberId) {
  try {
    const url = `${process.env.SUPABASE_URL}/rest/v1/conversaciones?subscriber_id=eq.${encodeURIComponent(subscriberId)}&select=id,historial`;
    const res = await fetch(url, {
      headers: {
        'apikey': process.env.SUPABASE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_KEY}`
      }
    });
    if (!res.ok) return { id: null, historial: [] };
    const data = await res.json();
    if (!data || data.length === 0) return { id: null, historial: [] };
    return { id: data[0].id, historial: data[0].historial || [] };
  } catch (e) {
    return { id: null, historial: [] };
  }
}

async function guardarHistorial(subscriberId, rowId, historial) {
  try {
    const historialRecortado = historial.slice(-50);
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    if (rowId) {
      // UPDATE — fila existente
      await fetch(`${supabaseUrl}/rest/v1/conversaciones?id=eq.${rowId}`, {
        method: 'PATCH',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          historial: historialRecortado,
          actualizado_at: new Date().toISOString()
        })
      });
    } else {
      // INSERT — fila nueva
      await fetch(`${supabaseUrl}/rest/v1/conversaciones`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          subscriber_id: subscriberId,
          historial: historialRecortado,
          actualizado_at: new Date().toISOString()
        })
      });
    }
  } catch (e) {
    // silencioso
  }
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json();
    const mensaje = body.mensaje || body.message || '';
    const nombre = body.nombre || body.name || 'cliente';
    const subscriberId = body.subscriber_id || 'anonimo';

    // Detectar medida
    const deteccion = await detectarMedidaConClaude(mensaje);
    let catalogoTexto = '';

    if (deteccion.encontrada) {
      const cantidad = deteccion.cantidad || 4;
      const productos = await buscarProductos(deteccion, cantidad);
      if (productos && productos.length > 0) {
        catalogoTexto = `\n\n[CATÁLOGO ${deteccion.ancho}/${deteccion.perfil}-${deteccion.llanta}]:\n` +
          productos.map(p => p.oficial
            ? `- [OFICIAL] ${p.nombre} | $${p.precio} | ${p.link}`
            : `- [NO OFICIAL] ${p.nombre} | $${p.precio}`
          ).join('\n');
      } else {
        catalogoTexto = `\n\n[CATÁLOGO ${deteccion.ancho}/${deteccion.perfil}-${deteccion.llanta}]: Sin stock suficiente para ${deteccion.cantidad || 4} unidades. Derivar a asesor.`;
      }
    }

    // Obtener historial con ID de fila
    const { id: rowId, historial: historialPrevio } = await obtenerHistorial(subscriberId);

    // Contenido del mensaje para el historial
    const contenidoUsuario = nombre !== 'cliente'
      ? `[${nombre}]: ${mensaje}${catalogoTexto}`
      : `${mensaje}${catalogoTexto}`;

    const mensajesParaClaude = [
      ...historialPrevio,
      { role: 'user', content: contenidoUsuario }
    ];

    const systemConNombre = nombre !== 'cliente'
      ? `${SYSTEM_PROMPT}\n\nEl cliente se llama ${nombre}.`
      : SYSTEM_PROMPT;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: systemConNombre,
        messages: mensajesParaClaude
      })
    });

    const claudeData = await claudeRes.json();
    const respuesta = claudeData.content?.[0]?.text || 'Disculpá, hubo un problema. Escribinos al 261-563-1663.';

    // Guardar historial actualizado
    const historialActualizado = [
      ...historialPrevio,
      { role: 'user', content: contenidoUsuario },
      { role: 'assistant', content: respuesta }
    ];
    await guardarHistorial(subscriberId, rowId, historialActualizado);

    return new Response(JSON.stringify({ respuesta }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ respuesta: 'Disculpá, hubo un problema técnico. Escribinos al 261-563-1663.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
