const axios = require("axios");
const db = require('../db');

const CLIENT_ID = "7_fwnRnGB3k7ZPxrRTs-JXfociaMvDOrjpgakZAa-9o";
const CLIENT_SECRET = "bAnquJnMpLPH7md-3pocYXS94DnrYGW1D71z_e0rj9s";

async function cotizarEnvio(usuario_id, direccion_id) {
  try {
    // 1. Obtener dirección
    const dirResult = await db.query(
      `SELECT alias, calle, numero_exterior, colonia, ciudad, estado, codigo_postal, numero_telefono
       FROM direcciones
       WHERE id = $1 AND usuario_id = $2
       LIMIT 1`,
      [direccion_id, usuario_id]
    );

    if (dirResult.rows.length === 0) {
      throw new Error("Dirección no encontrada.");
    }

    const selectedAddr = dirResult.rows[0];

    // 2. Generar token Skydropx
    const tokenResponse = await axios.post(
      "https://api-pro.skydropx.com/api/v1/oauth/token",
      {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "client_credentials",
        redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
      }
    );

    const token_skydropx = tokenResponse.data.access_token;

    // 3. Crear cotización
    const createRes = await axios.post(
      "https://api-pro.skydropx.com/api/v1/quotations",
      {
        quotation: {
          order_id: `order-${Date.now()}`,
          address_from: {
            country_code: "MX",
            postal_code: "90580",
            area_level1: "Tlaxcala",
            area_level2: "Huamantla",
            area_level3: "Xalpatlahuayatl",
            street1: "8 Sur",
            name: "Universidad",
            phone: "8132204224",
            email: "zenget008@gmail.com",
          },
          address_to: {
            country_code: "MX",
            postal_code: selectedAddr.codigo_postal,
            area_level1: selectedAddr.estado,
            area_level2: selectedAddr.ciudad,
            area_level3: selectedAddr.colonia || "",
            street1: `${selectedAddr.calle} ${selectedAddr.numero_exterior}`,
            name: selectedAddr.alias,
            phone: selectedAddr.numero_telefono || "0000000000",
            email: "cliente@ejemplo.com"
          },
          parcels: [{ length: 13, width: 8, height: 2, weight: 1 }],
          requested_carriers: ["fedex", "dhl", "estafeta"],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token_skydropx}`,
          "Content-Type": "application/json",
        },
      }
    );

    let { id: quotationId, is_completed: completed, rates } = createRes.data;

    // 4. Esperar a que se complete
    while (!completed) {
      await new Promise(r => setTimeout(r, 1500));

      const checkRes = await axios.get(
        `https://api-pro.skydropx.com/api/v1/quotations/${quotationId}`,
        { headers: { Authorization: `Bearer ${token_skydropx}` } }
      );

      completed = checkRes.data.is_completed;
      rates = checkRes.data.rates || [];
    }

    rates.sort((a, b) => Number(a.total_pricing) - Number(b.total_pricing));

    return {
      shipping_cost: rates.length ? Number(rates[0].total_pricing) : 150
    };

  } catch (err) {
    console.error("Error en cotizarEnvio:", err);
    return { shipping_cost: 150 };
  }
}

module.exports = cotizarEnvio;
