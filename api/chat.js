export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `Sos el asistente virtual de Mantello Neumáticos atendiendo por WhatsApp. Representás una empresa profesional de Mendoza, Argentina. Tu objetivo es vender y resolver consultas. Trato de vos, tono amable y comercial. Sin groserías ni slang. Mensajes cortos como WhatsApp real. Algún emoji ocasional. Jamás usés mexicanismos. Si te preguntan si sos un bot o una IA, respondé honestamente que sí. Nunca uses la palabra "neumatiquería". El negocio se llama Mantello Neumáticos.

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

MARCAS ASIÁTICAS: Mantello también ofrece Compasal, Aplus y Sunful. No las menciones proactivamente ni por nombre. Solo si el cliente pregunta específicamente por cubiertas chinas o económicas, informale que dentro de los neumáticos asiáticos son de la mejor calidad del segmento, con 5 años de garantía con el respaldo de Mantello Neumáticos.

CÓMO OFRECER PRODUCTOS:
- Siempre ofrecé de más caro a más barato.
- Solo ofrecé un producto si hay 4 o más unidades en stock. Un vehículo necesita 4 ruedas — si hay menos de 4 unidades disponibles, no lo ofrezcas online.
- Si hay stock suficiente de marcas oficiales (Bridgestone, Firestone, Dayton): ofrecelas para compra online con el link directo.
- Si el cliente quiere marcas asiáticas o no hay stock suficiente online: informale que a primera hora del próximo día hábil lo va a contactar un asesor para ayudarlo.

SERVICIOS:
- Colocación y balanceo a domicilio: Mantello en Casa — un técnico va a tu domicilio a colocar y balancear las cubiertas.
- Si preguntan por alineación junto con la colocación: se entrega un voucher para que pase por cualquier sucursal cuando pueda.
- Precios de servicios: consultame y te paso el precio actualizado.

MEDIOS DE PAGO:
- Contado, transferencia bancaria o 1 cuota sin interés.
- Para financiación en más cuotas: acercarse a cualquier sucursal.

SI PREGUNTAN POR CUBIERTAS PARA UN MODELO DE AUTO ESPECÍFICO (ej: "tengo un Sandero"):
- No te enredes buscando la medida exacta.
- Decile amablemente que para darte la medida exacta puede mirarla en el lateral de su cubierta actual o en la tapa del baúl, y que con eso lo asesorás enseguida. Si tiene alguna duda, un asesor lo va a ayudar.

CUANDO TE PASO RESULTADOS DEL CATÁLOGO:
- Mostrá solo productos con 4 o más unidades en stock.
- Ordená de más caro a más barato.
- Incluí nombre del producto, precio y link directo de compra.
- Si no hay productos con stock suficiente, ofrecé contacto al día hábil siguiente.

SI NO SABE LA MEDIDA: decile que la puede ver en el lateral de la cubierta actual o en la tapa del baúl.

SIEMPRE cerrá con una acción concreta: que compre online, que vaya al local, o que espere el contacto del asesor. Si no dio su nombre, pedíselo.`;

// Normaliza medidas escritas de distintas formas: 185/65r15, 185 65 15, 185-65-r15, etc.
function extraerMedida(texto) {
  const limpio = texto.toLowerCase().replace(/[^\d\s\/\-r]/g, ' ');
  const match = limpio.match(/(\d{3})[\s\/\-]+(\d{2})[\s\/\-]*r?[\s\/\-]*(\d{2})/);
  if (match) {
    return { ancho: match[1], perfil: match[2], llanta: match[3] };
  }
  return null;
}

// Busca productos en WooCommerce por medida
async function buscarProductos(medida) {
  try {
    const { ancho, perfil, llanta } = medida;
    const termino = `${ancho}/${perfil} R${llanta}`;
    const url = `https://mantelloneumaticos.com/wp-json/wc/v3/products?search=${encodeURIComponent(termino)}&per_page=20&status=publish`;

    const ck = process.env.WC_CONSUMER_KEY;
    const cs = process.env.WC_CONSUMER_SECRET;
    const auth = btoa(`${ck}:${cs}`);

    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` }
    });

    if (!res.ok) return null;

    const productos = await res.json();

    // Filtrar solo los que tienen 4 o más unidades en stock
    const conStock = productos.filter(p =>
      p.stock_status === 'instock' &&
      p.stock_quantity !== null &&
      p.stock_quantity >= 4
    );

    if (conStock.length === 0) return null;

    // Ordenar de más caro a más barato
    conStock.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));

    return conStock.map(p => ({
      nombre: p.name,
      precio: p.price,
      stock: p.stock_quantity,
      link: p.permalink
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

    // Intentar extraer medida del mensaje
    const medida = extraerMedida(mensaje);
    let catalogoTexto = '';

    if (medida) {
      const productos = await buscarProductos(medida);
      if (productos && productos.length > 0) {
        catalogoTexto = `\n\nRESULTADOS DEL CATÁLOGO para ${medida.ancho}/${medida.perfil} R${medida.llanta}:\n` +
          productos.map(p =>
            `- ${p.nombre} | Precio: $${p.precio} | Stock: ${p.stock} unidades | Link: ${p.link}`
          ).join('\n');
      } else {
        catalogoTexto = `\n\nBúsqueda en catálogo para ${medida.ancho}/${medida.perfil} R${medida.llanta}: sin stock suficiente (menos de 4 unidades). Derivar a asesor para próximo día hábil.`;
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
