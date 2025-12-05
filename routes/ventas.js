const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken, authorizeAdmin } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

router.post('/', verifyToken, async (req, res) => {
    const usuario_id = req.user.id;
    const {
        direccion_envio_id,
        direccion_facturacion_id,
        subtotal,
        descuento = 0,
        envio = 0,
        iva,
        total,
        metodo_pago,
        notas
    } = req.body;

    console.log("id usuario:" + usuario_id);
    console.log("direccion id :" + direccion_envio_id);
    console.log("direccion facturacion id :" + direccion_facturacion_id);
    

    
    if (!direccion_envio_id || !subtotal || !iva || !total || !metodo_pago) {
        return res.status(400).send('Faltan campos obligatorios.');
    }

    const numero_orden = uuidv4().split('-')[0]; 

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const checkOne = await client.query(
            `SELECT id FROM direcciones WHERE usuario_id = $1 AND id = $2`,
            [usuario_id, direccion_envio_id]
        );

        if (checkOne.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).send('La dirección no pertenece al usuario.');
        }
        let result;
        if (direccion_facturacion_id == null) {
            result = await client.query(
                `INSERT INTO ventas (
                    numero_orden, cliente_id, direccion_envio_id,
                    subtotal, descuento, envio, iva, total, metodo_pago, notas
                ) VALUES (
                    $1, $2, $3, $4,
                    $5, $6, $7, $8, $9, $10
                )
                RETURNING *`,
                [
                    numero_orden, usuario_id, direccion_envio_id,
                    subtotal, descuento, envio, iva, total, metodo_pago, notas || null
                ]
            );
        } else {
            result = await client.query(
                `INSERT INTO ventas (
                    numero_orden, cliente_id, direccion_envio_id, direccion_facturacion_id,
                    subtotal, descuento, envio, iva, total, metodo_pago, notas
                ) VALUES (
                    $1, $2, $3, $4,
                    $5, $6, $7, $8, $9, $10, $11
                )
                RETURNING *`,
                [
                    numero_orden, usuario_id, direccion_envio_id, direccion_facturacion_id,
                    subtotal, descuento, envio, iva, total, metodo_pago, notas || null
                ]
            );
            
        }

        await client.query('COMMIT');
        return res.status(201).json({
            message: "Venta creada exitosamente.",
            venta: result.rows[0]
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Error al crear venta:", err);
        return res.status(500).send("Error interno del servidor al crear venta.");
    } finally {
        client.release();
    }
});

router.get('/:id', verifyToken, async (req, res) => {
    const usuario_id = req.user.id;
    const id = parseInt(req.params.id);

    const result = await db.query(
        `SELECT * FROM ventas WHERE id = $1 AND cliente_id = $2`,
        [id, usuario_id]
    );

    if (result.rows.length === 0) {
        return res.status(404).send("Venta no encontrada.");
    }

    res.json(result.rows[0]);
});

router.get('/', verifyToken, async (req, res) => {
    const usuario_id = req.user.id;
    const role = req.user.role;
    let query; 
    let params = [];
    
    if (role === "admin") {
        query = `SELECT * FROM ventas ORDER BY fecha_creacion DESC`;
    }else{
        query = `SELECT * FROM ventas WHERE cliente_id = $1 ORDER BY fecha_creacion DESC`;
        params = [usuario_id]
    }
    const result = await db.query(query,params);

    res.json(result.rows);
});

router.put('/:id/estado', verifyToken, async (req, res) => {
    const usuario_id = req.user.id;
    const id = parseInt(req.params.id);
    const { estado_orden } = req.body;

    const estadosValidos = ["pendiente","procesando","enviado","entregado","cancelado"];

    if (!estadosValidos.includes(estado_orden)) {
        return res.status(400).send("Estado inválido.");
    }

    const result = await db.query(
        `UPDATE ventas
         SET estado_orden = $1, fecha_actualizacion = CURRENT_TIMESTAMP
         WHERE id = $2 AND cliente_id = $3
         RETURNING *`,
        [estado_orden, id, usuario_id]
    );

    if (result.rows.length === 0) {
        return res.status(404).send("Venta no encontrada.");
    }

    res.json({
        message: "Estado actualizado.",
        venta: result.rows[0]
    });
});

router.delete('/:id', verifyToken, async (req, res) => {
    const usuario_id = req.user.id;
    const id = parseInt(req.params.id);

    const check = await db.query(
        `SELECT estado_orden FROM ventas 
         WHERE id = $1 AND cliente_id = $2`,
        [id, usuario_id]
    );

    if (check.rows.length === 0) {
        return res.status(404).send("Venta no encontrada.");
    }

    if (check.rows[0].estado_orden !== "pendiente") {
        return res.status(400).send("Solo puedes eliminar ventas pendientes.");
    }

    await db.query(
        `DELETE FROM ventas WHERE id = $1 AND cliente_id = $2`,
        [id, usuario_id]
    );

    res.json({ message: "Venta eliminada correctamente." });
});

router.get('/admin', verifyToken, authorizeAdmin, async (req, res) => {
    const { 
        estado_orden, 
        estado_pago, 
        metodo_pago,
        fecha_inicio,
        fecha_fin,
        limit = '50', // Valor por defecto como string
        offset = '0'   // Valor por defecto como string
    } = req.query;
    
    let query = `
        SELECT v.*, 
               u.first_name as cliente_nombre,
               u.last_name as cliente_apellido,
               u.email as cliente_email
        FROM ventas v
        LEFT JOIN users u ON v.cliente_id = u.id
        WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 1;
    
    if (estado_orden) {
        query += ` AND v.estado_orden = $${paramCount}`;
        params.push(estado_orden);
        paramCount++;
    }
    
    if (estado_pago) {
        query += ` AND v.estado_pago = $${paramCount}`;
        params.push(estado_pago);
        paramCount++;
    }
    
    if (metodo_pago) {
        query += ` AND v.metodo_pago = $${paramCount}`;
        params.push(metodo_pago);
        paramCount++;
    }
    
    if (fecha_inicio) {
        query += ` AND DATE(v.fecha_creacion) >= $${paramCount}`;
        params.push(fecha_inicio);
        paramCount++;
    }
    
    if (fecha_fin) {
        query += ` AND DATE(v.fecha_creacion) <= $${paramCount}`;
        params.push(fecha_fin);
        paramCount++;
    }
    
    query += ` ORDER BY v.fecha_creacion DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    
    // Convertir a enteros con valores por defecto
    const limitNum = parseInt(limit) || 50;
    const offsetNum = parseInt(offset) || 0;
    
    params.push(limitNum, offsetNum);
    
    try {
        const result = await db.query(query, params);
        
        // Para el conteo total
        let countQuery = `SELECT COUNT(*) FROM ventas v WHERE 1=1`;
        const countParams = [];
        let countParamCount = 1;
        
        if (estado_orden) {
            countQuery += ` AND v.estado_orden = $${countParamCount}`;
            countParams.push(estado_orden);
            countParamCount++;
        }
        
        if (estado_pago) {
            countQuery += ` AND v.estado_pago = $${countParamCount}`;
            countParams.push(estado_pago);
            countParamCount++;
        }
        
        if (metodo_pago) {
            countQuery += ` AND v.metodo_pago = $${countParamCount}`;
            countParams.push(metodo_pago);
            countParamCount++;
        }
        
        if (fecha_inicio) {
            countQuery += ` AND DATE(v.fecha_creacion) >= $${countParamCount}`;
            countParams.push(fecha_inicio);
            countParamCount++;
        }
        
        if (fecha_fin) {
            countQuery += ` AND DATE(v.fecha_creacion) <= $${countParamCount}`;
            countParams.push(fecha_fin);
            countParamCount++;
        }
        
        const countResult = await db.query(countQuery, countParams);
        
        res.json({
            success: true,
            ventas: result.rows,
            total: parseInt(countResult.rows[0].count),
            limit: limitNum,
            offset: offsetNum
        });
    } catch (error) {
        console.error("Error fetching ventas:", error);
        res.status(500).json({ 
            success: false,
            error: 'Error al obtener ventas'
        });
    }
});

// Obtener detalles de una venta específica
router.get('/:id/detalles', verifyToken, async (req, res) => {
    const id = parseInt(req.params.id);
    const usuario_id = req.user.id;
    const role = req.user.role;
    
    try {
        // Primero verificar si el usuario tiene acceso a esta venta
        const ventaCheck = await db.query(
            `SELECT id FROM ventas WHERE id = $1 ${role !== 'admin' ? 'AND cliente_id = $2' : ''}`,
            role !== 'admin' ? [id, usuario_id] : [id]
        );
        
        if (ventaCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }
        
        const detalles = await db.query(`
            SELECT vd.*, 
                   p.nombre as producto_nombre,
                   p.sku as producto_sku,
                   p.imagen_url as producto_imagen
            FROM venta_detalles vd
            LEFT JOIN productos p ON vd.producto_id = p.id
            WHERE vd.venta_id = $1
            ORDER BY vd.id
        `, [id]);
        
        res.json({
            success: true,
            detalles: detalles.rows
        });
    } catch (error) {
        console.error("Error fetching venta detalles:", error);
        res.status(500).json({ error: 'Error al obtener detalles de la venta' });
    }
});

// Obtener estadísticas de ventas
router.get('/estadisticas/resumen', verifyToken, authorizeAdmin, async (req, res) => {
    try {
        const { rows: ventasTotales } = await db.query(`
            SELECT 
                COUNT(*) as total_ventas,
                SUM(total) as ingresos_totales,
                AVG(total) as ticket_promedio,
                COUNT(DISTINCT cliente_id) as clientes_unicos
            FROM ventas
            WHERE estado_orden != 'cancelado'
        `);
        
        const { rows: ventasPorEstado } = await db.query(`
            SELECT 
                estado_orden,
                COUNT(*) as cantidad,
                SUM(total) as total
            FROM ventas
            GROUP BY estado_orden
            ORDER BY cantidad DESC
        `);
        
        const { rows: ventasPorMes } = await db.query(`
            SELECT 
                DATE_TRUNC('month', fecha_creacion) as mes,
                COUNT(*) as cantidad,
                SUM(total) as total
            FROM ventas
            WHERE fecha_creacion >= CURRENT_DATE - INTERVAL '6 months'
            GROUP BY DATE_TRUNC('month', fecha_creacion)
            ORDER BY mes DESC
        `);
        
        res.json({
            success: true,
            resumen: ventasTotales[0],
            porEstado: ventasPorEstado,
            porMes: ventasPorMes
        });
    } catch (error) {
        console.error("Error fetching estadísticas:", error);
        res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
});

// Actualizar estado de venta (admin puede cambiar cualquier venta)
router.put('/:id/estado/admin', verifyToken, authorizeAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const { estado_orden, estado_pago } = req.body;
    
    const estadosOrdenValidos = ["pendiente","procesando","enviado","entregado","cancelado"];
    const estadosPagoValidos = ["pendiente","pagado","rechazado","reembolsado"];
    
    if (estado_orden && !estadosOrdenValidos.includes(estado_orden)) {
        return res.status(400).send("Estado de orden inválido.");
    }
    
    if (estado_pago && !estadosPagoValidos.includes(estado_pago)) {
        return res.status(400).send("Estado de pago inválido.");
    }
    
    try {
        const updates = [];
        const params = [];
        let paramCount = 1;
        
        if (estado_orden) {
            updates.push(`estado_orden = $${paramCount}`);
            params.push(estado_orden);
            paramCount++;
        }
        
        if (estado_pago) {
            updates.push(`estado_pago = $${paramCount}`);
            params.push(estado_pago);
            paramCount++;
        }
        
        if (updates.length === 0) {
            return res.status(400).send("No se proporcionaron cambios.");
        }
        
        updates.push(`fecha_actualizacion = CURRENT_TIMESTAMP`);
        
        params.push(id);
        
        const result = await db.query(
            `UPDATE ventas
             SET ${updates.join(', ')}
             WHERE id = $${paramCount}
             RETURNING *`,
            params
        );
        
        if (result.rows.length === 0) {
            return res.status(404).send("Venta no encontrada.");
        }
        
        res.json({
            success: true,
            message: "Venta actualizada exitosamente.",
            venta: result.rows[0]
        });
    } catch (error) {
        console.error("Error updating venta:", error);
        res.status(500).json({ error: 'Error al actualizar la venta' });
    }
});

module.exports = router;
