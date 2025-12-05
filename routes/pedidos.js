const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

// Obtener todos los pedidos del usuario con detalles
router.get('/', verifyToken, async (req, res) => {
    const usuario_id = req.user.id;

    try {
        // Obtener pedidos del usuario
        const pedidosResult = await db.query(
            `SELECT 
                v.id,
                v.numero_orden,
                v.cliente_id,
                v.direccion_envio_id,
                v.direccion_facturacion_id,
                v.subtotal,
                v.descuento,
                v.envio,
                v.iva,
                v.total,
                v.metodo_pago,
                v.estado_pago,
                v.estado_orden,
                v.notas,
                v.fecha_creacion,
                v.fecha_actualizacion,
                de.calle as envio_calle,
                de.numero_exterior as envio_numero_exterior,
                de.ciudad as envio_ciudad,
                de.estado as envio_estado,
                df.calle as facturacion_calle,
                df.numero_exterior as facturacion_numero_exterior,
                df.ciudad as facturacion_ciudad,
                df.estado as facturacion_estado
             FROM ventas v
             LEFT JOIN direcciones de ON v.direccion_envio_id = de.id
             LEFT JOIN direcciones df ON v.direccion_facturacion_id = df.id
             WHERE v.cliente_id = $1
             ORDER BY v.fecha_creacion DESC`,
            [usuario_id]
        );

        // Para cada pedido, obtener los detalles
        const pedidosConDetalles = await Promise.all(
            pedidosResult.rows.map(async (pedido) => {
                const detallesResult = await db.query(
                    `SELECT 
                        vd.id,
                        vd.venta_id,
                        vd.producto_id,
                        vd.cantidad,
                        vd.precio_unitario,
                        vd.descuento_unitario,
                        vd.es_arrendamiento,
                        vd.periodo_arrendamiento,
                        vd.cantidad_periodos,
                        vd.fecha_inicio_arrendamiento,
                        vd.fecha_fin_arrendamiento,
                        p.nombre as producto_nombre,
                        p.url_imagen as producto_url_imagen
                     FROM venta_detalles vd
                     JOIN productos p ON vd.producto_id = p.id
                     WHERE vd.venta_id = $1`,
                    [pedido.id]
                );

                return {
                    ...pedido,
                    detalles: detallesResult.rows
                };
            })
        );

        res.status(200).json(pedidosConDetalles);
    } catch (err) {
        console.error('Error al obtener pedidos:', err);
        res.status(500).send('Error interno del servidor al obtener pedidos.');
    }
});

// Obtener un pedido específico por ID
router.get('/:id', verifyToken, async (req, res) => {
    const pedido_id = parseInt(req.params.id);
    const usuario_id = req.user.id;

    if (isNaN(pedido_id)) {
        return res.status(400).send('ID de pedido inválido.');
    }

    try {
        // Obtener pedido
        const pedidoResult = await db.query(
            `SELECT 
                v.id,
                v.numero_orden,
                v.cliente_id,
                v.direccion_envio_id,
                v.direccion_facturacion_id,
                v.subtotal,
                v.descuento,
                v.envio,
                v.iva,
                v.total,
                v.metodo_pago,
                v.estado_pago,
                v.estado_orden,
                v.notas,
                v.fecha_creacion,
                v.fecha_actualizacion,
                de.calle as envio_calle,
                de.numero_exterior as envio_numero_exterior,
                de.numero_interior as envio_numero_interior,
                de.colonia as envio_colonia,
                de.ciudad as envio_ciudad,
                de.estado as envio_estado,
                de.codigo_postal as envio_codigo_postal,
                df.calle as facturacion_calle,
                df.numero_exterior as facturacion_numero_exterior,
                df.numero_interior as facturacion_numero_interior,
                df.colonia as facturacion_colonia,
                df.ciudad as facturacion_ciudad,
                df.estado as facturacion_estado,
                df.codigo_postal as facturacion_codigo_postal
             FROM ventas v
             LEFT JOIN direcciones de ON v.direccion_envio_id = de.id
             LEFT JOIN direcciones df ON v.direccion_facturacion_id = df.id
             WHERE v.id = $1 AND v.cliente_id = $2`,
            [pedido_id, usuario_id]
        );

        if (pedidoResult.rows.length === 0) {
            return res.status(404).send('Pedido no encontrado o no pertenece a este usuario.');
        }

        // Obtener detalles del pedido
        const detallesResult = await db.query(
            `SELECT 
                vd.id,
                vd.venta_id,
                vd.producto_id,
                vd.cantidad,
                vd.precio_unitario,
                vd.descuento_unitario,
                vd.es_arrendamiento,
                vd.periodo_arrendamiento,
                vd.cantidad_periodos,
                vd.fecha_inicio_arrendamiento,
                vd.fecha_fin_arrendamiento,
                p.nombre as producto_nombre,
                p.url_imagen as producto_url_imagen
             FROM venta_detalles vd
             JOIN productos p ON vd.producto_id = p.id
             WHERE vd.venta_id = $1`,
            [pedido_id]
        );

        const pedidoCompleto = {
            ...pedidoResult.rows[0],
            detalles: detallesResult.rows
        };

        res.status(200).json(pedidoCompleto);
    } catch (err) {
        console.error('Error al obtener pedido:', err);
        res.status(500).send('Error interno del servidor al obtener pedido.');
    }
});

// Crear un nuevo pedido (checkout)
router.post('/', verifyToken, async (req, res) => {
    const usuario_id = req.user.id;
    const {
        direccion_envio_id,
        direccion_facturacion_id = null,
        metodo_pago,
        notas = null,
        items // Array de objetos {producto_id, cantidad, es_arrendamiento, ...}
    } = req.body;

    // Validar campos obligatorios
    if (!direccion_envio_id || !metodo_pago || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).send('Faltan campos obligatorios: direccion_envio_id, metodo_pago, items.');
    }

    // Validar método de pago
    const metodosPagoValidos = ['tarjeta_credito', 'tarjeta_debito', 'paypal', 'transferencia', 'efectivo'];
    if (!metodosPagoValidos.includes(metodo_pago)) {
        return res.status(400).send('Método de pago inválido.');
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // 1. Verificar que los productos existen y tienen stock suficiente
        for (const item of items) {
            const productoResult = await client.query(
                'SELECT precio, stock FROM productos WHERE id = $1',
                [item.producto_id]
            );

            if (productoResult.rows.length === 0) {
                throw new Error(`Producto con ID ${item.producto_id} no encontrado.`);
            }

            if (!item.es_arrendamiento && productoResult.rows[0].stock < item.cantidad) {
                throw new Error(`Stock insuficiente para el producto con ID ${item.producto_id}.`);
            }
        }

        // 2. Calcular totales
        let subtotal = 0;
        const detallesConPrecio = [];

        for (const item of items) {
            const productoResult = await client.query(
                'SELECT precio FROM productos WHERE id = $1',
                [item.producto_id]
            );

            const precio_unitario = parseFloat(productoResult.rows[0].precio);
            const itemSubtotal = precio_unitario * item.cantidad;
            subtotal += itemSubtotal;

            detallesConPrecio.push({
                ...item,
                precio_unitario
            });
        }

        // Calcular IVA (16% en México)
        const iva = subtotal * 0.16;
        const envio = subtotal > 999 ? 0 : 50; // Ejemplo: envío gratis > $999
        const total = subtotal + iva + envio;

        // 3. Generar número de orden único
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 1000);
        const numero_orden = `ORD-${timestamp}-${random}`;

        // 4. Crear el pedido
        const pedidoResult = await client.query(
            `INSERT INTO ventas (
                numero_orden, cliente_id, direccion_envio_id, direccion_facturacion_id,
                subtotal, descuento, envio, iva, total, metodo_pago, notas
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING id, numero_orden, total, fecha_creacion`,
            [
                numero_orden,
                usuario_id,
                direccion_envio_id,
                direccion_facturacion_id,
                subtotal,
                0, // descuento
                envio,
                iva,
                total,
                metodo_pago,
                notas
            ]
        );

        const pedidoId = pedidoResult.rows[0].id;

        // 5. Crear detalles del pedido
        for (const detalle of detallesConPrecio) {
            await client.query(
                `INSERT INTO venta_detalles (
                    venta_id, producto_id, cantidad, precio_unitario,
                    es_arrendamiento, periodo_arrendamiento, cantidad_periodos,
                    fecha_inicio_arrendamiento, fecha_fin_arrendamiento
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    pedidoId,
                    detalle.producto_id,
                    detalle.cantidad,
                    detalle.precio_unitario,
                    detalle.es_arrendamiento || false,
                    detalle.periodo_arrendamiento || null,
                    detalle.cantidad_periodos || null,
                    detalle.fecha_inicio_arrendamiento || null,
                    detalle.fecha_fin_arrendamiento || null
                ]
            );

            // 6. Actualizar stock si no es arrendamiento
            if (!detalle.es_arrendamiento) {
                await client.query(
                    'UPDATE productos SET stock = stock - $1 WHERE id = $2',
                    [detalle.cantidad, detalle.producto_id]
                );
            }
        }

        // 7. Vaciar carrito del usuario
        await client.query(
            'DELETE FROM carrito WHERE usuario_id = $1',
            [usuario_id]
        );

        await client.query('COMMIT');

        res.status(201).json({
            success: true,
            message: 'Pedido creado exitosamente',
            pedido: pedidoResult.rows[0],
            total: total
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error al crear pedido:', err);
        
        if (err.message.includes('Stock insuficiente') || err.message.includes('no encontrado')) {
            return res.status(400).send(err.message);
        }
        
        res.status(500).send('Error interno del servidor al crear pedido.');
    } finally {
        client.release();
    }
});

// Cancelar un pedido
router.put('/:id/cancelar', verifyToken, async (req, res) => {
    const pedido_id = parseInt(req.params.id);
    const usuario_id = req.user.id;

    if (isNaN(pedido_id)) {
        return res.status(400).send('ID de pedido inválido.');
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Verificar que el pedido existe y pertenece al usuario
        const pedidoResult = await client.query(
            `SELECT estado_orden, estado_pago FROM ventas 
             WHERE id = $1 AND cliente_id = $2`,
            [pedido_id, usuario_id]
        );

        if (pedidoResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).send('Pedido no encontrado o no pertenece a este usuario.');
        }

        const { estado_orden, estado_pago } = pedidoResult.rows[0];

        // Validar que se puede cancelar
        if (estado_orden === 'cancelado') {
            await client.query('ROLLBACK');
            return res.status(400).send('El pedido ya está cancelado.');
        }

        if (estado_orden === 'entregado') {
            await client.query('ROLLBACK');
            return res.status(400).send('No se puede cancelar un pedido ya entregado.');
        }

        // Actualizar estado del pedido
        await client.query(
            `UPDATE ventas 
             SET estado_orden = 'cancelado', fecha_actualizacion = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [pedido_id]
        );

        // Si ya estaba pagado, cambiar estado de pago a reembolsado
        if (estado_pago === 'pagado') {
            await client.query(
                `UPDATE ventas 
                 SET estado_pago = 'reembolsado', fecha_actualizacion = CURRENT_TIMESTAMP
                 WHERE id = $1`,
                [pedido_id]
            );
        }

        // Restaurar stock si no es arrendamiento
        const detallesResult = await client.query(
            `SELECT producto_id, cantidad, es_arrendamiento 
             FROM venta_detalles 
             WHERE venta_id = $1`,
            [pedido_id]
        );

        for (const detalle of detallesResult.rows) {
            if (!detalle.es_arrendamiento) {
                await client.query(
                    'UPDATE productos SET stock = stock + $1 WHERE id = $2',
                    [detalle.cantidad, detalle.producto_id]
                );
            }
        }

        await client.query('COMMIT');

        res.status(200).json({
            success: true,
            message: 'Pedido cancelado exitosamente'
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error al cancelar pedido:', err);
        res.status(500).send('Error interno del servidor al cancelar pedido.');
    } finally {
        client.release();
    }
});

// Actualizar método de pago
router.put('/:id/metodo-pago', verifyToken, async (req, res) => {
    const pedido_id = parseInt(req.params.id);
    const usuario_id = req.user.id;
    const { metodo_pago } = req.body;

    if (isNaN(pedido_id)) {
        return res.status(400).send('ID de pedido inválido.');
    }

    const metodosPagoValidos = ['tarjeta_credito', 'tarjeta_debito', 'paypal', 'transferencia', 'efectivo'];
    if (!metodo_pago || !metodosPagoValidos.includes(metodo_pago)) {
        return res.status(400).send('Método de pago inválido.');
    }

    try {
        // Verificar que el pedido existe y pertenece al usuario
        const checkResult = await db.query(
            `SELECT estado_pago FROM ventas 
             WHERE id = $1 AND cliente_id = $2`,
            [pedido_id, usuario_id]
        );

        if (checkResult.rows.length === 0) {
            return res.status(404).send('Pedido no encontrado o no pertenece a este usuario.');
        }

        // Solo permitir cambiar método de pago si el pago está pendiente
        if (checkResult.rows[0].estado_pago !== 'pendiente') {
            return res.status(400).send('No se puede cambiar el método de pago después de realizar el pago.');
        }

        const result = await db.query(
            `UPDATE ventas 
             SET metodo_pago = $1, fecha_actualizacion = CURRENT_TIMESTAMP
             WHERE id = $2
             RETURNING id, numero_orden, metodo_pago`,
            [metodo_pago, pedido_id]
        );

        res.status(200).json({
            success: true,
            message: 'Método de pago actualizado exitosamente',
            pedido: result.rows[0]
        });

    } catch (err) {
        console.error('Error al actualizar método de pago:', err);
        res.status(500).send('Error interno del servidor al actualizar método de pago.');
    }
});

module.exports = router;