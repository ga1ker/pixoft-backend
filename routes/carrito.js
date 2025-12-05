
const express = require("express")
const { verifyToken } = require("../middleware/auth");
const router = express.Router()
const db = require("../db")

router.get('/', verifyToken, async (req, res) => {
    const id_usuario = req.user.id;

    try {
        // Obtener todos los productos del carrito del usuario
        const carritoResult = await db.query(`
            SELECT
                c.id AS id_carrito,
                c.producto_id,
                c.cantidad,
                p.nombre,
                p.precio,
                p.precio_descuento,
                p.url_imagen,
                m.nombre AS marca,
                cat.nombre AS categoria
            FROM carrito c
            JOIN productos p ON p.id = c.producto_id
            JOIN marcas m ON m.id = p.marca_id
            JOIN categorias cat ON cat.id = p.categoria_id
            WHERE c.usuario_id = $1
            ORDER BY c.id ASC;
        `, [id_usuario]);

        // Si no hay productos, devolver carrito vacío
        if (carritoResult.rows.length === 0) {
            return res.status(200).json({
                items: [],
                total_carrito: "0.00",
                message: "El usuario no tiene productos en su carrito."
            });
        }

        let totalCarrito = 0;

        const itemsProcesados = carritoResult.rows.map(item => {
            const precioBase = parseFloat(item.precio);
            const precioDescuento = parseFloat(item.precio_descuento || 0);

            let precioFinal = precioBase;

            if (precioDescuento > 0) {
                precioFinal = precioDescuento;
            }

            const subtotal = precioFinal * item.cantidad;
            totalCarrito += subtotal;

            return {
                id_carrito: item.id_carrito,
                producto_id: item.producto_id,
                nombre: item.nombre,
                marca: item.marca,
                categoria: item.categoria,
                imagen: item.url_imagen,
                cantidad: item.cantidad,
                precio_unitario: precioFinal.toFixed(2),
                subtotal: subtotal.toFixed(2)
            };
        });

        // Respuesta final
        res.status(200).json({
            items: itemsProcesados,
            total_carrito: totalCarrito.toFixed(2),
            success: true
        });

    } catch (err) {
        console.error("Error al obtener carrito:", err);
        res.status(500).json({ error: "Error interno del servidor." });
    }
});

router.post('/agregar', verifyToken, async (req, res) => {
  const usuario_id = req.user.id;
  const { producto_id, cantidad } = req.body;

  if (!usuario_id || !producto_id || !cantidad) {
    return res.status(400).json({
      error: "Faltan campos obligatorios (usuario_id, producto_id, cantidad)"
    });
  }

  try {
    // 1. Verificar si el producto ya está en el carrito del usuario
    const existeQuery = `
      SELECT id, cantidad 
      FROM carrito
      WHERE usuario_id = $1 AND producto_id = $2
      LIMIT 1
    `;
    const existe = await db.query(existeQuery, [usuario_id, producto_id]);

    if (existe.rows.length > 0) {
      // 2. Si existe → sumar la cantidad
      const nuevaCantidad = existe.rows[0].cantidad + cantidad;

      const updateQuery = `
        UPDATE carrito
        SET cantidad = $1
        WHERE id = $2
        RETURNING *
      `;
      const updated = await db.query(updateQuery, [
        nuevaCantidad,
        existe.rows[0].id
      ]);

      return res.json({
        mensaje: "Cantidad actualizada en el carrito",
        item: updated.rows[0],
        success: true
      });
    }

    // 3. Si NO existe → crear una fila nueva
    const insertQuery = `
      INSERT INTO carrito (usuario_id, producto_id, cantidad)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const inserted = await db.query(insertQuery, [
      usuario_id,
      producto_id,
      cantidad
    ]);

    return res.json({
      mensaje: "Producto agregado al carrito",
      item: inserted.rows[0],
      success: true
    });

  } catch (error) {
    console.error("Error al agregar al carrito:", error);
    return res.status(500).json({
      error: "Error interno al agregar producto al carrito"
    });
  }
});

module.exports = router
