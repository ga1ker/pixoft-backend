




const express = require("express");
const axios = require("axios");
const router = express.Router();

const db = require('../db');
const {verifyToken} = require('../middleware/auth')
const CLIENT_ID = "7_fwnRnGB3k7ZPxrRTs-JXfociaMvDOrjpgakZAa-9o";
const CLIENT_SECRET = "bAnquJnMpLPH7md-3pocYXS94DnrYGW1D71z_e0rj9s";

router.post("/cotizar", verifyToken, async (req, res) => {
  try {
    const usuario_id = req.user.id;
    const { direccion_id } = req.body;

    if (!direccion_id) {
      return res.status(400).json({ error: "Se requiere un ID de dirección." });
    }

    // 1. Obtener dirección real del usuario
    const dirResult = await db.query(
      `SELECT alias, calle, numero_exterior, colonia, ciudad, estado, codigo_postal
       FROM direcciones
       WHERE id = $1 AND usuario_id = $2
       LIMIT 1`,
      [direccion_id, usuario_id]
    );

    if (dirResult.rows.length === 0) {
      return res.status(404).json({ error: "Dirección no encontrada." });
    }

    const selectedAddr = dirResult.rows[0];

    // 2. Obtener token Skydropx
    const tokenResponse = await axios.post(
      "https://api-pro.skydropx.com/api/v1/oauth/token",
      {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "client_credentials",
        redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
      },
      { headers: { "Content-Type": "application/json" } }
    );

    const token_skydropx = tokenResponse.data.access_token;

    // 3. Crear cotización (address_from es tu bodega/oficina)
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
            email: "cliente@ejemplo.com"
          },
          parcels: [
            { length: 13, width: 8, height: 2, weight: 1 }
          ],
          requested_carriers: ["fedex", "dhl", "estafeta"],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token_skydropx}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    let { id: quotationId, is_completed: completed, rates } = createRes.data;

    // 4. Esperar a que Skydropx procese la cotización
    while (!completed) {
      await new Promise((r) => setTimeout(r, 2000));

      const checkRes = await axios.get(
        `https://api-pro.skydropx.com/api/v1/quotations/${quotationId}`,
        {
          headers: { Authorization: `Bearer ${token_skydropx}`, Accept: "application/json" },
        }
      );

      completed = checkRes.data.is_completed;
      rates = checkRes.data.rates || [];
    }

    // 5. Responder cotización ordenada
    if (rates.length > 0) {
      rates.sort((a, b) => Number(a.total_pricing) - Number(b.total_pricing));
      return res.json({
        shipping_cost: Number(rates[0].total_pricing),
        rates
      });
    } else {
      return res.json({ shipping_cost: 150, error: "No hay opciones de envío disponibles" });
    }

  } catch (error) {
    console.error(error.response?.data || error.message);
    return res.status(500).json({ error: "Error al cotizar envío" });
  }
});


module.exports =router
 