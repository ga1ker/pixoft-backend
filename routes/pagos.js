const express = require('express');
const router = express.Router();
const {verifyToken} = require('../middleware/auth')
const db = require('../db');
const {cotizarEnvio} = require('./envios')

router.post("/checkout/resumen", verifyToken, async (req, res) => {
  try {
    const usuario_id = req.user.id;
    const { direccion_id } = req.body;

    // 1. Obtener carrito
    const carrito = await db.query(
      `SELECT c.cantidad, p.precio
       FROM carrito c
       JOIN productos p ON c.producto_id = p.id
       WHERE c.usuario_id = $1`,
      [usuario_id]
    );

    if (carrito.rows.length === 0) {
      return res.status(400).json({ error: "Carrito vacío" });
    }

    let subtotal = 0;
    carrito.rows.forEach(item => {
      subtotal += item.precio * item.cantidad;
    });

    // 2. Obtener dirección real
    const dirResult = await db.query(
      `SELECT codigo_postal, estado, ciudad, colonia, calle, numero_exterior, alias
       FROM direcciones
       WHERE id = $1 AND usuario_id = $2`,
      [direccion_id, usuario_id]
    );

    if (dirResult.rows.length === 0) {
      return res.status(404).json({ error: "Dirección inválida" });
    }

    const direccion = dirResult.rows[0];

    // 3. Cotizar envío (reutilizar función de cotizar)
    const envio = await cotizarEnvio(usuario_id, direccion_id); // <- Te explico debajo

    // 4. Total final
    const total = subtotal + envio.shipping_cost;

    return res.json({
      subtotal,
      shipping: envio.shipping_cost,
      total,
      direccion,
      carrito: carrito.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar resumen" });
  }
});


module.exports = router;