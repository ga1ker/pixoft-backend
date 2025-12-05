const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

// Obtener detalles por venta
router.get('/venta/:venta_id', verifyToken, async (req, res) => {
    const venta_id = parseInt(req.params.venta_id);

    if (isNaN(venta_id)) {
        return res.status(400).json({ error: 'ID de venta inválido' });
    }

    try {
        const result = await db.query(
            `SELECT vd.*, p.nombre AS producto_nombre, p.descripcion
             FROM venta_detalles vd
             JOIN productos p ON p.id = vd.producto_id
             WHERE vd.venta_id = $1
             ORDER BY vd.id ASC`,
            [venta_id]
        );

        res.status(200).json({
            venta_id,
            total_detalles: result.rowCount,
            detalles: result.rows
        });

    } catch (err) {
        console.error('Error al obtener venta_detalles:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear registro individual (normalmente no se usa manualmente)
router.post('/', verifyToken, async (req, res) => {
    const {
        venta_id,
        producto_id,
        cantidad,
        precio_unitario,
        descuento_unitario,
        es_arrendamiento,
        periodo_arrendamiento,
        cantidad_periodos,
        fecha_inicio_arrendamiento,
        fecha_fin_arrendamiento
    } = req.body;

    if (!venta_id || !producto_id || !cantidad || !precio_unitario) {
        return res.status(400).json({
            error: 'Campos requeridos faltantes',
            campos: ['venta_id', 'producto_id', 'cantidad', 'precio_unitario']
        });
    }

    try {
        const result = await db.query(
            `INSERT INTO venta_detalles (
                venta_id, producto_id, cantidad, precio_unitario,
                descuento_unitario, es_arrendamiento, periodo_arrendamiento,
                cantidad_periodos, fecha_inicio_arrendamiento, fecha_fin_arrendamiento
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             RETURNING *`,
            [
                venta_id, producto_id, cantidad, precio_unitario,
                descuento_unitario || 0,
                es_arrendamiento || false,
                periodo_arrendamiento || null,
                cantidad_periodos || null,
                fecha_inicio_arrendamiento || null,
                fecha_fin_arrendamiento || null
            ]
        );

        res.status(201).json({
            message: 'Detalle agregado a la venta',
            detalle: result.rows[0]
        });

    } catch (err) {
        console.error('Error creando venta_detalles:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Eliminar un detalle
router.delete('/:id', verifyToken, async (req, res) => {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
        return res.status(400).json({ error: 'ID inválido' });
    }

    try {
        const result = await db.query(
            `DELETE FROM venta_detalles WHERE id = $1 RETURNING id`,
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Detalle no encontrado' });
        }

        res.status(200).json({
            message: 'Detalle eliminado',
            id_eliminado: id
        });
    } catch (err) {
        console.error('Error eliminando detalle:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

module.exports = router;
