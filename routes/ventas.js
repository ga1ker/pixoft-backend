const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');
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

module.exports = router;
