const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

router.get('/producto/:producto_id', async (req, res) => {
    const producto_id = parseInt(req.params.producto_id);
    
    if (isNaN(producto_id)) {
        return res.status(400).json({ error: 'ID de producto inválido' });
    }
    
    try {
        const result = await db.query(
            `SELECT 
                o.id, o.producto_id, o.usuario_id, o.venta_id, o.calificacion, o.comentario, o.fecha_creacion,
                u.nombre as usuario_nombre, u.email as usuario_email,
                p.nombre as producto_nombre
             FROM opiniones o
             JOIN users u ON o.usuario_id = u.id
             JOIN productos p ON o.producto_id = p.id
             WHERE o.producto_id = $1
             ORDER BY o.fecha_creacion DESC`,
            [producto_id]
        );
        
        // Calcular promedio de calificaciones
        const promedioResult = await db.query(
            `SELECT 
                AVG(calificacion) as promedio,
                COUNT(*) as total_opiniones,
                COUNT(CASE WHEN calificacion = 5 THEN 1 END) as cinco_estrellas,
                COUNT(CASE WHEN calificacion = 4 THEN 1 END) as cuatro_estrellas,
                COUNT(CASE WHEN calificacion = 3 THEN 1 END) as tres_estrellas,
                COUNT(CASE WHEN calificacion = 2 THEN 1 END) as dos_estrellas,
                COUNT(CASE WHEN calificacion = 1 THEN 1 END) as una_estrella
             FROM opiniones 
             WHERE producto_id = $1`,
            [producto_id]
        );
        
        res.status(200).json({
            producto_id: producto_id,
            estadisticas: promedioResult.rows[0],
            opiniones: result.rows,
            total: result.rowCount
        });
        
    } catch (err) {
        console.error('Error al obtener opiniones:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

router.post('/', verifyToken, async (req, res) => {
    const usuario_id = req.user.id_usuario || req.user.id;

    const { producto_id, venta_id, calificacion, comentario } = req.body;

    if (!producto_id || !venta_id || !calificacion) {
        return res.status(400).json({
            error: 'Faltan campos requeridos',
            campos_requeridos: ['producto_id', 'venta_id', 'calificacion']
        });
    }

    if (calificacion < 1 || calificacion > 5) {
        return res.status(400).json({
            error: 'La calificación debe estar entre 1 y 5'
        });
    }

    const client = await db.connect();

    try {
        await client.query('BEGIN');

        // Verificar que el usuario compró el producto
        const ventaCheck = await client.query(
            `SELECT 1 
             FROM ventas v
             JOIN venta_detalles vd ON v.id = vd.venta_id
             WHERE v.id = $1
               AND v.cliente_id = $2
               AND vd.producto_id = $3
               AND v.estado_orden = 'entregado'`,
            [venta_id, usuario_id, producto_id]
        );

        if (ventaCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(403).json({
                error: 'No puedes opinar sobre este producto',
                motivo: 'No has comprado este producto o la venta no está entregada'
            });
        }

        // Evitar opinión duplicada
        const existe = await client.query(
            `SELECT 1 FROM opiniones 
             WHERE producto_id = $1 AND usuario_id = $2`,
            [producto_id, usuario_id]
        );

        if (existe.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: 'Ya has opinado sobre este producto'
            });
        }

        // Insertar opinión
        const result = await client.query(
            `INSERT INTO opiniones (
                producto_id, usuario_id, venta_id, 
                calificacion, comentario
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *`,
            [producto_id, usuario_id, venta_id, calificacion, comentario || null]
        );
        

        await client.query('COMMIT');

        res.status(201).json({
            message: 'Opinión creada exitosamente',
            opinion: result.rows[0]
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error al crear opinión:', err);

        res.status(500).json({
            error: 'Error interno del servidor',
            detalle: err.message
        });
    } finally {
        client.release();
    }
});


router.put('/:id', verifyToken, async (req, res) => {
    const opinion_id = parseInt(req.params.id);
    const usuario_id = req.user.id_usuario || req.user.id;
    const { calificacion, comentario } = req.body;
    
    if (isNaN(opinion_id)) {
        return res.status(400).json({ error: 'ID de opinión inválido' });
    }
    
    if (calificacion && (calificacion < 1 || calificacion > 5)) {
        return res.status(400).json({ 
            error: 'La calificación debe estar entre 1 y 5' 
        });
    }
    
    const client = await db.connect();
    
    try {
        await client.query('BEGIN');
        
        // Verificar que la opinión existe y pertenece al usuario
        const checkResult = await client.query(
            `SELECT id, producto_id FROM opiniones 
             WHERE id = $1 AND usuario_id = $2`,
            [opinion_id, usuario_id]
        );
        
        if (checkResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ 
                error: 'Opinión no encontrada o no pertenece a este usuario'
            });
        }
        
        const producto_id = checkResult.rows[0].producto_id;
        
        // Actualizar la opinión
        const result = await client.query(
            `UPDATE opiniones 
             SET calificacion = COALESCE($1, calificacion),
                 comentario = COALESCE($2, comentario)
             WHERE id = $3 AND usuario_id = $4
             RETURNING id, producto_id, usuario_id, venta_id, calificacion, comentario, fecha_creacion`,
            [calificacion || null, comentario || null, opinion_id, usuario_id]
        );
        
        // Actualizar promedio de calificaciones del producto
        await client.query(
            `UPDATE productos 
             SET calificacion_promedio = (
                 SELECT AVG(calificacion) FROM opiniones WHERE producto_id = $1
             )
             WHERE id = $1`,
            [producto_id]
        );
        
        await client.query('COMMIT');
        
        res.status(200).json({
            message: 'Opinión actualizada exitosamente',
            opinion: result.rows[0]
        });
        
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error al actualizar opinión:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
        client.release();
    }
});

router.delete('/:id', verifyToken, async (req, res) => {
    const opinion_id = parseInt(req.params.id);
    const usuario_id = req.user.id_usuario || req.user.id;
    
    if (isNaN(opinion_id)) {
        return res.status(400).json({ error: 'ID de opinión inválido' });
    }
    
    const client = await db.connect();
    
    try {
        await client.query('BEGIN');
        
        // Verificar que la opinión existe y pertenece al usuario
        const checkResult = await client.query(
            `SELECT id, producto_id FROM opiniones 
             WHERE id = $1 AND usuario_id = $2`,
            [opinion_id, usuario_id]
        );
        
        if (checkResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ 
                error: 'Opinión no encontrada o no pertenece a este usuario'
            });
        }
        
        const producto_id = checkResult.rows[0].producto_id;
        
        // Eliminar la opinión
        await client.query(
            `DELETE FROM opiniones WHERE id = $1 AND usuario_id = $2`,
            [opinion_id, usuario_id]
        );
        
        // Actualizar promedio de calificaciones del producto
        await client.query(
            `UPDATE productos 
             SET calificacion_promedio = (
                 SELECT AVG(calificacion) FROM opiniones WHERE producto_id = $1
             ),
             total_calificaciones = (
                 SELECT COUNT(*) FROM opiniones WHERE producto_id = $1
             )
             WHERE id = $1`,
            [producto_id]
        );
        
        await client.query('COMMIT');
        
        res.status(200).json({
            message: 'Opinión eliminada exitosamente',
            id_eliminado: opinion_id
        });
        
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error al eliminar opinión:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
        client.release();
    }
});


module.exports = router;