export const config = { runtime: 'edge' };

const MARCAS_OFICIALES = ['bridgestone', 'firestone', 'dayton'];

function esMarcaOficial(nombreProducto) {
  const nombre = nombreProducto.toLowerCase();
  return MARCAS_OFICIALES.some(m => nombre.includes(m));
}

const SYSTEM_PROMPT = `Sos el asistente virtual de Mantello Neumáticos atendiendo por WhatsApp. Representás una empresa profesional de Mendoza, Argentina. Tu objetivo es vender y resolver consultas. Trato de vos, tono amable y comercial. Sin groserías ni slang. Mensajes cortos como WhatsApp real. Algún emoji ocasional. Jamás usés mexicanismos. Si te preguntan si sos un bot o una IA, respondé honestamente que sí. Nunca uses la palabra "neumatiquería". El negocio se llama Mantello Neumáticos.
IMPORTANTE: Nunca saludes con "hola", "bienvenido" ni ningún saludo al inicio de tus respuestas. Respondé directo a lo que pregunta el cliente, sin introducción.

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
- Solo ofrecé un producto si hay 4 o más unidades en stock.
- Los productos marcados como [OFICIAL] tienen link de compra online — mostralo.
- Los productos marcados como [NO OFICIAL] NO tienen link — no mostrés ninguna URL. Decí que para esa marca lo atiende un asesor personalmente a primera hora del próximo día hábil.
- No menciones la cantidad de stock disponible.

SERVICIOS:
- Combo Alineación y Balanceo Auto: $45.000
- Combo Alineación y Balanceo Camioneta: $55.000
- Colocación y balanceo a domicilio: Mantello en Casa — un técnico va a tu domicilio a colocar y balancear las cubiertas.
- Si preguntan por alineación junto con la colocación: se entrega un voucher para que pase por cualquier sucursal cuando pueda.
- Precios de servicios: consultame y te paso el precio actualizado.

MEDIOS DE PAGO:
- Contado, transferencia bancaria o 1 cuota sin interés.
- Para financiación en más cuotas: acercarse a cualquier sucursal.

SI PREGUNTAN POR CUBIERTAS PARA UN MODELO DE AUTO ESPECÍFICO (ej: "tengo un Sandero"):
- Decile amablemente que para darte la medida exacta puede mirarla en el lateral de su cubierta actual o en la tapa del baúl.

SI NO SABE LA MEDIDA: decile que la puede ver en el lateral de la cubierta actual o en la tapa del baúl.

SIEMPRE cerrá con una acción concreta: que compre online, que vaya al local, o que espere el contacto del asesor. Si no dio su nombre, pedíselo.`;

function extraerMedida(texto) {
  const limpio = texto.toLowerCase();
  const match = limpio.match(/(\d{3})[\s\/\-]+(\d{2})[\s\/\-]*r?[\s\/\-]*(\d{2})/);
  if (match) {
    return { ancho: match[1], perfil: match[2], llanta: match[3] };
  }
  return null;
}

async function buscarProductos(medida) {
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

    const conStock = productos.filter(p =>
      p.stock_status === 'instock' &&
      p.stock_quantity !== null &&
      p.stock_quantity >= 4
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

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json();
    const mensaje = body.mensaje || body.message || '';
    const nombre = body.nombre || body.name || 'cliente';

    const medida = extraerMedida(mensaje);
    let catalogoTexto = '';

    if (medida) {
      const productos = await buscarProductos(medida);
      if (productos && productos.length > 0) {
        catalogoTexto = `\n\nRESULTADOS DEL CATÁLOGO para ${medida.ancho}/${medida.perfil}-${medida.llanta}:\n` +
          productos.map(p => {
            if (p.oficial) {
              return `- [OFICIAL] ${p.nombre} | Precio: $${p.precio} | Link: ${p.link}`;
            } else {
              return `- [NO OFICIAL] ${p.nombre} | Precio: $${p.precio}`;
            }
          }).join('\n');
      } else {
        catalogoTexto = `\n\nBúsqueda en catálogo para ${medida.ancho}/${medida.perfil}-${medida.llanta}: sin stock suficiente (menos de 4 unidades). Derivar a asesor para próximo día hábil.`;
      }
    }

    const mensajeConCatalogo = mensaje + catalogoTexto;

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
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `El cliente se llama ${nombre}. Mensaje: ${mensajeConCatalogo}`
          }
        ]
      })
    });

    const claudeData = await claudeRes.json();
    const respuesta = claudeData.content?.[0]?.text || 'Disculpá, hubo un problema. Escribinos al 261-563-1663.';

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
