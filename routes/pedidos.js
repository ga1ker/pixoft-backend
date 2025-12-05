const express = require('express');
const router = express.Router();
const db = require('../db');
const { mercadopago } = require('../config/mercadopago');
const { verifyToken } = require('../middleware/auth');

// Crear preferencia de pago con MercadoPago
router.post("/crear-preferencia", verifyToken, async (req, res) => {
  console.log("📦 Recibiendo solicitud para pago online");

  const {
    total,
    subtotal,
    envio = 0,
    iva = 0,
    descuento = 0,
    productos,
    direccion_envio_id,
    direccion_facturacion_id,
    metodo_pago = 'mercadopago', // Cambiado a mercadopago
    notas = '',
    cliente_id
  } = req.body;

  // Validaciones
  if (!total || !productos || productos.length === 0 || !cliente_id) {
    return res.status(400).json({ 
      error: true, 
      message: "Datos incompletos para el pedido." 
    });
  }

  // Verificar si el cliente existe
  const clienteCheck = await db.query(
    'SELECT id, email, first_name, last_name FROM users WHERE id = $1',
    [cliente_id]
  );

  if (clienteCheck.rows.length === 0) {
    return res.status(404).json({ 
      error: true, 
      message: "Cliente no encontrado." 
    });
  }

  const cliente = clienteCheck.rows[0];
  const emailComprador = cliente.email;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Generar número de orden único
    const timestamp = Date.now();
    const randomNum = Math.floor(Math.random() * 1000);
    const numero_orden = `ORD-${timestamp}-${randomNum}`;

    // 1. Crear registro en ventas
    const insertVenta = await client.query(`
      INSERT INTO ventas (
        numero_orden,
        cliente_id,
        direccion_envio_id,
        direccion_facturacion_id,
        subtotal,
        descuento,
        envio,
        iva,
        total,
        metodo_pago,
        estado_pago,
        estado_orden,
        notas
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id, numero_orden;
    `, [
      numero_orden,
      cliente_id,
      direccion_envio_id,
      direccion_facturacion_id,
      parseFloat(subtotal),
      parseFloat(descuento),
      parseFloat(envio),
      parseFloat(iva),
      parseFloat(total),
      'tarjeta_debito',
      'pendiente',
      'pendiente',
      notas
    ]);

    const venta = insertVenta.rows[0];
    const venta_id = venta.id;

    // 2. Crear items para MercadoPago y registrar detalles de venta
    const items = [];
    
    for (const producto of productos) {
      const unit_price = parseFloat(producto.precio_unitario);
      const quantity = parseInt(producto.cantidad);
      
      if (unit_price <= 0 || quantity <= 0) {
        throw new Error(`Producto con precio o cantidad inválida: ${producto.nombre}`);
      }

      // Registrar en venta_detalles
      await client.query(`
        INSERT INTO venta_detalles (
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
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        venta_id,
        producto.id,
        quantity,
        unit_price,
        producto.descuento_unitario || 0,
        producto.es_arrendamiento || false,
        producto.periodo_arrendamiento || null,
        producto.cantidad_periodos || null,
        producto.fecha_inicio_arrendamiento || null,
        producto.fecha_fin_arrendamiento || null
      ]);

      // Actualizar stock del producto
      await client.query(
        `UPDATE productos 
         SET stock = stock - $1,
             fecha_actualizacion = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [quantity, producto.id]
      );

      // Agregar item a MercadoPago
      items.push({
        id: `prod_${producto.id}`,
        title: producto.nombre.substring(0, 200),
        description: producto.descripcion ? producto.descripcion.substring(0, 100) : '',
        quantity: quantity,
        unit_price: unit_price,
        currency_id: "MXN",
        category_id: "software",
        picture_url: producto.imagen_url || ''
      });
    }

    // 3. Agregar costo de envío como item adicional si aplica
    if (envio > 0) {
      items.push({
        title: "Costo de envío",
        description: "Gastos de envío",
        quantity: 1,
        unit_price: parseFloat(envio),
        currency_id: "MXN"
      });
    }

    // 4. Crear preferencia en MercadoPago
    const formatDateForMercadoPago = (date) => {
  // Crear fecha en zona horaria local
  const localDate = new Date(date);
  
  // Obtener offset en formato HH:MM
  const offset = -localDate.getTimezoneOffset();
  const offsetHours = Math.floor(Math.abs(offset) / 60).toString().padStart(2, '0');
  const offsetMinutes = (Math.abs(offset) % 60).toString().padStart(2, '0');
  const offsetSign = offset >= 0 ? '+' : '-';
  
  // Formatear fecha YYYY-MM-DDTHH:MM:SS.mmm±HH:MM
  const year = localDate.getFullYear();
  const month = (localDate.getMonth() + 1).toString().padStart(2, '0');
  const day = localDate.getDate().toString().padStart(2, '0');
  const hours = localDate.getHours().toString().padStart(2, '0');
  const minutes = localDate.getMinutes().toString().padStart(2, '0');
  const seconds = localDate.getSeconds().toString().padStart(2, '0');
  const milliseconds = localDate.getMilliseconds().toString().padStart(3, '0');
  
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${offsetSign}${offsetHours}:${offsetMinutes}`;
};

    // Calcular fechas de expiración
    const expirationDateFrom = new Date();
    const expirationDateTo = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

    const preference = {
    items: items,
    external_reference: venta_id.toString(),
    notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/pagos/webhook`,
    payer: {
        email: emailComprador,
        name: cliente.first_name,
        surname: cliente.last_name
    },
    statement_descriptor: "PIXSOFT",
    back_urls: {
        success: "https://webhook.site/your-unique-url",
        failure: "https://webhook.site/your-unique-url",
        pending: "https:s//webhook.site/your-unique-url"
    },
    auto_return: "approved",
    expires: true,
    expiration_date_from: formatDateForMercadoPago(expirationDateFrom),
    expiration_date_to: formatDateForMercadoPago(expirationDateTo)
    };

    console.log("🎯 Creando preferencia en MercadoPago...");
    const response = await mercadopago.preferences.create(preference);

    await client.query('COMMIT');

    res.json({
      success: true,
      id: response.body.id,
      venta_id: venta_id,
      numero_orden: numero_orden,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("❌ Error creando preferencia:", error);
    res.status(500).json({ 
      error: true, 
      message: "Error al procesar el pago: " + error.message 
    });
  } finally {
    client.release();
  }
});

// Webhook de MercadoPago
router.post("/webhook", async (req, res) => {
  try {
    console.log("📩 Webhook recibido de MercadoPago");
    
    // Log completo del webhook para debug
    console.log("Body recibido:", JSON.stringify(req.body, null, 2));
    console.log("Query params:", req.query);
    console.log("Headers:", req.headers);

    const { type, data } = req.body;

    // Verificar que sea un evento de pago
    if (type !== "payment") {
      console.log("⚠️ Tipo de evento no es 'payment':", type);
      return res.sendStatus(200);
    }

    if (!data || !data.id) {
      console.error("❌ No hay data.id en el webhook");
      return res.sendStatus(200);
    }

    const paymentId = data.id;
    console.log(`💰 Procesando pago ID: ${paymentId}`);

    // Obtener detalles del pago desde MercadoPago
    const payment = await mercadopago.payment.findById(paymentId);
    const paymentData = payment.body;
    
    console.log("📊 Datos del pago recibidos:", {
      id: paymentData.id,
      status: paymentData.status,
      external_reference: paymentData.external_reference,
      transaction_amount: paymentData.transaction_amount
    });

    const venta_id = paymentData.external_reference;
    
    if (!venta_id) {
      console.error("❌ No se encontró external_reference en el pago");
      return res.sendStatus(200);
    }

    console.log(`🔍 Buscando venta ID: ${venta_id}`);

    // Determinar estados según el pago
    let estado_pago = 'pendiente';
    let estado_orden = 'pendiente';
    let mp_status = paymentData.status;
    let mp_status_detail = paymentData.status_detail || '';
    
    switch (paymentData.status) {
      case 'approved':
        estado_pago = 'pagado';
        estado_orden = 'procesando';
        console.log(`✅ Pago aprobado para venta ${venta_id}`);
        break;
      case 'rejected':
        estado_pago = 'rechazado';
        estado_orden = 'cancelado';
        console.log(`❌ Pago rechazado para venta ${venta_id}`);
        break;
      case 'in_process':
      case 'pending':
        estado_pago = 'pendiente';
        estado_orden = 'pendiente';
        console.log(`⏳ Pago pendiente para venta ${venta_id}`);
        break;
      case 'cancelled':
        estado_pago = 'cancelado';
        estado_orden = 'cancelado';
        console.log(`❌ Pago cancelado para venta ${venta_id}`);
        break;
      case 'refunded':
        estado_pago = 'reembolsado';
        estado_orden = 'cancelado';
        console.log(`↩️ Pago reembolsado para venta ${venta_id}`);
        break;
      case 'charged_back':
        estado_pago = 'contracargado';
        estado_orden = 'cancelado';
        console.log(`⚠️ Pago con contracargo para venta ${venta_id}`);
        break;
      default:
        console.log(`❓ Estado desconocido: ${paymentData.status} para venta ${venta_id}`);
    }

    // Actualizar la venta en la base de datos
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Verificar que la venta existe
      const ventaCheck = await client.query(
        'SELECT id FROM ventas WHERE id = $1',
        [venta_id]
      );

      if (ventaCheck.rows.length === 0) {
        console.error(`❌ Venta ${venta_id} no encontrada`);
        await client.query('ROLLBACK');
        return res.sendStatus(200);
      }

      // Actualizar venta con los datos de MercadoPago
      await client.query(`
        UPDATE ventas 
        SET estado_pago = $1,
            estado_orden = $2,
            payment_id = $3,
            mp_status = $4,
            mp_status_detail = $5,
            mp_payer_email = $6,
            mp_payment_method = $7,
            fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE id = $8
      `, [
        estado_pago,
        estado_orden,
        paymentData.id.toString(),
        mp_status,
        mp_status_detail,
        paymentData.payer ? paymentData.payer.email : null,
        paymentData.payment_method_id,
        venta_id
      ]);

      // Si el pago fue aprobado, manejar stock y enviar notificaciones
      if (paymentData.status === 'approved') {
        console.log(`🎉 Pago aprobado, procesando venta ${venta_id}`);
        
        // Aquí podrías agregar:
        // 1. Enviar email de confirmación
        // 2. Generar factura
        // 3. Actualizar métricas
        // 4. Notificar al admin
        
        // Ejemplo: Obtener datos para email
        const ventaInfo = await client.query(`
          SELECT v.numero_orden, v.total, u.email, u.first_name
          FROM ventas v
          JOIN users u ON v.cliente_id = u.id
          WHERE v.id = $1
        `, [venta_id]);

        if (ventaInfo.rows.length > 0) {
          const info = ventaInfo.rows[0];
          console.log(`📧 Pago exitoso para cliente: ${info.email}, Orden: ${info.numero_orden}`);
          
          // Aquí puedes enviar email usando tu servicio de email
          // await emailService.sendPaymentConfirmation(info.email, info.numero_orden, info.total);
        }
      }

      await client.query('COMMIT');
      console.log(`✅ Venta ${venta_id} actualizada exitosamente`);

    } catch (dbError) {
      await client.query('ROLLBACK');
      console.error("❌ Error actualizando base de datos:", dbError);
      // No enviamos error 500 para que MercadoPago no reintente constantemente
      console.log("⚠️ Enviando 200 a MercadoPago (no reintentar)");
    } finally {
      client.release();
    }

    // IMPORTANTE: Siempre devolver 200 a MercadoPago
    res.sendStatus(200);
    
  } catch (error) {
    console.error("❌ Error en webhook:", error);
    // IMPORTANTE: Siempre devolver 200 a MercadoPago
    res.sendStatus(200);
  }
});

// Obtener estado de pago por ID de venta
router.get("/estado/:venta_id", verifyToken, async (req, res) => {
  try {
    const { venta_id } = req.params;
    const cliente_id = req.user.id;

    const venta = await db.query(`
      SELECT 
        id,
        numero_orden,
        subtotal,
        descuento,
        envio,
        iva,
        total,
        metodo_pago,
        estado_pago,
        estado_orden,
        payment_id,
        mp_status,
        mp_status_detail,
        mp_payer_email,
        mp_payment_method,
        fecha_creacion,
        fecha_actualizacion
      FROM ventas 
      WHERE id = $1 AND cliente_id = $2
    `, [venta_id, cliente_id]);

    if (venta.rows.length === 0) {
      return res.status(404).json({ 
        error: true, 
        message: "Venta no encontrada" 
      });
    }

    res.json({
      success: true,
      venta: venta.rows[0]
    });
  } catch (error) {
    console.error("Error obteniendo estado de pago:", error);
    res.status(500).json({ error: true, message: error.message });
  }
});

// Obtener estado de pago por número de orden
router.get("/estado-orden/:numero_orden", async (req, res) => {
  try {
    const { numero_orden } = req.params;

    const venta = await db.query(`
      SELECT 
        id,
        numero_orden,
        estado_pago,
        estado_orden,
        mp_status,
        mp_status_detail,
        total,
        fecha_creacion
      FROM ventas 
      WHERE numero_orden = $1
    `, [numero_orden]);

    if (venta.rows.length === 0) {
      return res.status(404).json({ 
        error: true, 
        message: "Orden no encontrada" 
      });
    }

    res.json({
      success: true,
      venta: venta.rows[0]
    });
  } catch (error) {
    console.error("Error obteniendo estado de orden:", error);
    res.status(500).json({ error: true, message: error.message });
  }
});

// Endpoint para verificar webhook (debug)
router.get("/webhook-debug", async (req, res) => {
  try {
    const ventas = await db.query(`
      SELECT 
        id,
        numero_orden,
        estado_pago,
        estado_orden,
        mp_status,
        payment_id,
        fecha_creacion,
        fecha_actualizacion
      FROM ventas 
      WHERE metodo_pago = 'mercadopago'
      ORDER BY fecha_creacion DESC 
      LIMIT 10
    `);

    res.json({
      success: true,
      total: ventas.rows.length,
      ventas: ventas.rows
    });
  } catch (error) {
    console.error("Error en debug:", error);
    res.status(500).json({ error: true, message: error.message });
  }
});

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