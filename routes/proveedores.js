const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

// Crear un proveedor
router.post('/', verifyToken, async (req, res) => {
    const { nombre, telefono, email, direccion_contacto_id, activo = true, notas } = req.body;

    if (!nombre || !direccion_contacto_id) {
        return res.status(400).json({ error: 'Faltan campos obligatorios: nombre o direccion_contacto_id' });
    }

    try {
        const result = await db.query(
            `INSERT INTO proveedores
                (nombre, telefono, email, direccion_contacto_id, activo, notas)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [nombre, telefono || null, email || null, direccion_contacto_id, activo, notas || null]
        );

        res.status(201).json({
            message: 'Proveedor creado exitosamente',
            proveedor: result.rows[0]
        });
    } catch (err) {
        console.error('Error al crear proveedor:', err);
        res.status(500).json({ error: 'Error interno del servidor', detalle: err.message });
    }
});

// Listar todos los proveedores
router.get('/', async (req, res) => {
    try {
        const result = await db.query(`SELECT * FROM proveedores ORDER BY fecha_creacion DESC`);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error al obtener proveedores:', err);
        res.status(500).json({ error: 'Error interno del servidor', detalle: err.message });
    }
});

// Obtener un proveedor por ID
router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id);

    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

    try {
        const result = await db.query(`SELECT * FROM proveedores WHERE id = $1`, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Proveedor no encontrado' });
        }
        res.status(200).json(result.rows[0]);
    } catch (err) {
        console.error('Error al obtener proveedor:', err);
        res.status(500).json({ error: 'Error interno del servidor', detalle: err.message });
    }
});

// Actualizar un proveedor
router.put('/:id', verifyToken, async (req, res) => {
    const id = parseInt(req.params.id);
    const { nombre, telefono, email, direccion_contacto_id, activo, notas } = req.body;

    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

    try {
        const result = await db.query(
            `UPDATE proveedores
             SET nombre = COALESCE($1, nombre),
                 telefono = COALESCE($2, telefono),
                 email = COALESCE($3, email),
                 direccion_contacto_id = COALESCE($4, direccion_contacto_id),
                 activo = COALESCE($5, activo),
                 notas = COALESCE($6, notas),
                 fecha_actualizacion = CURRENT_TIMESTAMP
             WHERE id = $7
             RETURNING *`,
            [nombre, telefono, email, direccion_contacto_id, activo, notas, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Proveedor no encontrado' });
        }

        res.status(200).json({
            message: 'Proveedor actualizado exitosamente',
            proveedor: result.rows[0]
        });
    } catch (err) {
        console.error('Error al actualizar proveedor:', err);
        res.status(500).json({ error: 'Error interno del servidor', detalle: err.message });
    }
});

// Eliminar un proveedor
router.delete('/:id', verifyToken, async (req, res) => {
    const id = parseInt(req.params.id);

    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

    try {
        const result = await db.query(`DELETE FROM proveedores WHERE id = $1 RETURNING *`, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Proveedor no encontrado' });
        }

        res.status(200).json({
            message: 'Proveedor eliminado exitosamente',
            proveedor: result.rows[0]
        });
    } catch (err) {
        console.error('Error al eliminar proveedor:', err);
        res.status(500).json({ error: 'Error interno del servidor', detalle: err.message });
    }
});

module.exports = router;
