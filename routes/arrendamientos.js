const express = require('express');
const router = express.Router();
const db = require('../db');
const PDFDocument = require('pdfkit');
const { verifyToken, authorizeAdmin } = require('../middleware/auth');
const nodemailer = require('nodemailer');

// Configurar transporter de nodemailer
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Obtener arrendamientos activos - CONSULTA CORREGIDA
router.get('/activos', verifyToken, authorizeAdmin, async (req, res) => {
  try {
    const query = `
      SELECT 
        vd.id as venta_detalle_id,
        v.id as venta_id,
        v.numero_orden,
        v.cliente_id,
        CONCAT(u.first_name, ' ', u.last_name) as cliente_nombre,
        u.email as cliente_email,
        u.phone as cliente_telefono,
        vd.producto_id,
        p.nombre as producto_nombre,
        p.sku as producto_sku,
        vd.cantidad,
        vd.precio_unitario,
        vd.es_arrendamiento,
        vd.periodo_arrendamiento,
        vd.cantidad_periodos,
        vd.fecha_inicio_arrendamiento,
        vd.fecha_fin_arrendamiento,
        -- CORRECCIÓN: Usar DATE_PART en lugar de EXTRACT o hacer cast explícito
        DATE_PART('day', vd.fecha_fin_arrendamiento - CURRENT_DATE)::INTEGER as dias_restantes,
        -- Alternativa si DATE_PART no funciona:
        -- EXTRACT(DAY FROM (vd.fecha_fin_arrendamiento::timestamp - CURRENT_TIMESTAMP))::INTEGER as dias_restantes,
        CASE 
          WHEN vd.fecha_fin_arrendamiento < CURRENT_DATE THEN 'vencido'
          WHEN v.estado_orden = 'cancelado' THEN 'cancelado'
          WHEN vd.fecha_fin_arrendamiento IS NULL THEN 'finalizado'
          ELSE 'activo'
        END as estado,
        -- Calcular próximo pago (simplificado - asumiendo pago al inicio de cada período)
        CASE 
          WHEN vd.periodo_arrendamiento = 'mensual' THEN 
            vd.fecha_inicio_arrendamiento + INTERVAL '1 month' * 
            (EXTRACT(YEAR FROM AGE(CURRENT_DATE, vd.fecha_inicio_arrendamiento)) * 12 + 
             EXTRACT(MONTH FROM AGE(CURRENT_DATE, vd.fecha_inicio_arrendamiento)))
          WHEN vd.periodo_arrendamiento = 'anual' THEN 
            vd.fecha_inicio_arrendamiento + INTERVAL '1 year' * 
            EXTRACT(YEAR FROM AGE(CURRENT_DATE, vd.fecha_inicio_arrendamiento))
          WHEN vd.periodo_arrendamiento = 'semanal' THEN 
            vd.fecha_inicio_arrendamiento + INTERVAL '1 week' * 
            FLOOR(EXTRACT(DAY FROM AGE(CURRENT_DATE, vd.fecha_inicio_arrendamiento)) / 7)
          WHEN vd.periodo_arrendamiento = 'diario' THEN 
            CURRENT_DATE + INTERVAL '1 day'
          ELSE CURRENT_DATE + INTERVAL '1 month'
        END as proximo_pago_fecha,
        -- Calcular monto del próximo pago
        (vd.precio_unitario * vd.cantidad) as proximo_pago_monto,
        -- Calcular totales (simplificado)
        (vd.precio_unitario * vd.cantidad * vd.cantidad_periodos) as total_pagado,
        (vd.precio_unitario * vd.cantidad * 
          GREATEST(0, 
            CASE vd.periodo_arrendamiento
              WHEN 'diario' THEN DATE_PART('day', vd.fecha_fin_arrendamiento - CURRENT_DATE)
              WHEN 'semanal' THEN DATE_PART('day', vd.fecha_fin_arrendamiento - CURRENT_DATE) / 7
              WHEN 'mensual' THEN DATE_PART('month', AGE(vd.fecha_fin_arrendamiento, CURRENT_DATE))
              WHEN 'anual' THEN DATE_PART('year', AGE(vd.fecha_fin_arrendamiento, CURRENT_DATE))
              ELSE 0
            END
          )
        ) as total_pendiente,
        v.fecha_creacion
      FROM venta_detalles vd
      JOIN ventas v ON vd.venta_id = v.id
      JOIN users u ON v.cliente_id = u.id
      JOIN productos p ON vd.producto_id = p.id
      WHERE vd.es_arrendamiento = true
      AND vd.fecha_fin_arrendamiento IS NOT NULL
      AND v.estado_orden != 'cancelado'
      ORDER BY vd.fecha_fin_arrendamiento ASC
    `;

    const result = await db.query(query);
    
    // Procesar resultados para asegurar números válidos
    const processedResults = result.rows.map(row => ({
      ...row,
      dias_restantes: Math.floor(row.dias_restantes) || 0,
      proximo_pago_monto: parseFloat(row.proximo_pago_monto) || 0,
      total_pagado: parseFloat(row.total_pagado) || 0,
      total_pendiente: parseFloat(row.total_pendiente) || 0
    }));
    
    res.json(processedResults);
  } catch (error) {
    console.error('Error fetching arrendamientos:', error);
    res.status(500).json({ error: 'Error al obtener arrendamientos', details: error.message });
  }
});

// Versión simplificada si la consulta compleja sigue dando problemas
router.get('/activos-simple', verifyToken, authorizeAdmin, async (req, res) => {
  try {
    const query = `
      SELECT 
        vd.id as venta_detalle_id,
        v.id as venta_id,
        v.numero_orden,
        v.cliente_id,
        CONCAT(u.first_name, ' ', u.last_name) as cliente_nombre,
        u.email as cliente_email,
        u.phone as cliente_telefono,
        vd.producto_id,
        p.nombre as producto_nombre,
        p.sku as producto_sku,
        vd.cantidad,
        vd.precio_unitario,
        vd.es_arrendamiento,
        vd.periodo_arrendamiento,
        vd.cantidad_periodos,
        vd.fecha_inicio_arrendamiento,
        vd.fecha_fin_arrendamiento,
        v.estado_orden,
        v.estado_arrenda,  
        v.total,
        v.fecha_creacion
      FROM venta_detalles vd
      JOIN ventas v ON vd.venta_id = v.id
      JOIN users u ON v.cliente_id = u.id
      JOIN productos p ON vd.producto_id = p.id
      WHERE vd.es_arrendamiento = true
      AND vd.fecha_fin_arrendamiento IS NOT NULL
      AND v.estado_orden != 'cancelado'
      ORDER BY vd.fecha_fin_arrendamiento ASC
    `;

    const result = await db.query(query);
    
    // Procesar en JavaScript en lugar de SQL complejo
    const processedResults = result.rows.map(row => {
      const fechaFin = new Date(row.fecha_fin_arrendamiento);
      const hoy = new Date();
      const diasRestantes = Math.ceil((fechaFin - hoy) / (1000 * 60 * 60 * 24));
      
      // Determinar estado
      let estado = 'cancelado';
      if (row.estado_orden === 'cancelado') {
        estado = 'cancelado';
      } else if (row.estado_arrenda === 7) {
        estado = 'pendiente de aprobacion';      
      } else if(row.estado_arrenda === 1){
        estado = 'activo'
      }else if (diasRestantes < 0) {
        estado = 'vencido';
      } else if (!row.fecha_fin_arrendamiento) {
        estado = 'finalizado';
      }

      console.log( "estado: " + estado);
      
      // Calcular próximo pago (simplificado)
      let proximoPagoFecha = null;
      let proximoPagoMonto = 0;
      
      if (row.periodo_arrendamiento && row.fecha_inicio_arrendamiento) {
        const fechaInicio = new Date(row.fecha_inicio_arrendamiento);
        proximoPagoMonto = (row.precio_unitario * row.cantidad) || 0;
        
        // Calcular la fecha del próximo pago basado en el período
        if (row.periodo_arrendamiento === 'mensual') {
          const mesesTranscurridos = (hoy.getFullYear() - fechaInicio.getFullYear()) * 12 + 
                                     (hoy.getMonth() - fechaInicio.getMonth());
          proximoPagoFecha = new Date(fechaInicio);
          proximoPagoFecha.setMonth(fechaInicio.getMonth() + mesesTranscurridos + 1);
        } else if (row.periodo_arrendamiento === 'anual') {
          const añosTranscurridos = hoy.getFullYear() - fechaInicio.getFullYear();
          proximoPagoFecha = new Date(fechaInicio);
          proximoPagoFecha.setFullYear(fechaInicio.getFullYear() + añosTranscurridos + 1);
        }
      }
      
      // Calcular totales (simplificado)
      const totalPagado = (row.precio_unitario * row.cantidad * row.cantidad_periodos) || 0;
      
      return {
        ...row,
        dias_restantes: diasRestantes,
        estado: estado,
        proximo_pago_fecha: proximoPagoFecha ? proximoPagoFecha.toISOString().split('T')[0] : null,
        proximo_pago_monto: proximoPagoMonto,
        total_pagado: totalPagado,
        total_pendiente: 0 // Simplificado para empezar
      };
    });
    
    res.json(processedResults);
  } catch (error) {
    console.error('Error fetching arrendamientos:', error);
    res.status(500).json({ error: 'Error al obtener arrendamientos' });
  }
});

// Generar contrato estándar
router.post('/generar-contrato', verifyToken, authorizeAdmin, async (req, res) => {
  try {
    const { venta_detalle_id } = req.body;
    
    if (!venta_detalle_id) {
      return res.status(400).json({ error: 'Se requiere venta_detalle_id' });
    }
    
    // Obtener datos del arrendamiento
    const arrendamientoQuery = `
      SELECT 
        vd.*,
        v.numero_orden,
        v.total,
        CONCAT(u.first_name, ' ', u.last_name) as cliente_nombre,
        u.email as cliente_email,
        u.phone as cliente_telefono,
        p.nombre as producto_nombre,
        p.descripcion as producto_descripcion
      FROM venta_detalles vd
      JOIN ventas v ON vd.venta_id = v.id
      JOIN users u ON v.cliente_id = u.id
      JOIN productos p ON vd.producto_id = p.id
      WHERE vd.id = $1
      AND vd.es_arrendamiento = true
    `;

    const result = await db.query(arrendamientoQuery, [venta_detalle_id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Arrendamiento no encontrado' });
    }

    const arrendamiento = result.rows[0];
    
    // Crear PDF
    const doc = new PDFDocument({ margin: 50 });
    
    // Configurar headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="contrato-arrendamiento-${arrendamiento.numero_orden}.pdf"`);
    
    doc.pipe(res);
    
    // Encabezado del documento
    doc.fontSize(20).text('CONTRATO DE ARRENDAMIENTO DE SOFTWARE', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Número de Contrato: ${arrendamiento.numero_orden}`, { align: 'center' });
    doc.moveDown(2);
    
    // Sección 1: Partes
    doc.fontSize(14).text('1. PARTES CONTRATANTES', { underline: true });
    doc.moveDown();
    doc.fontSize(12).text(`ARRENDADOR: PIXSOFT S.A.`);
    doc.text(`RUC: 12345678901`);
    doc.text(`Dirección: Av. Principal 123, Ciudad`);
    doc.moveDown();
    doc.text(`ARRENDATARIO: ${arrendamiento.cliente_nombre}`);
    doc.text(`Email: ${arrendamiento.cliente_email}`);
    doc.text(`Teléfono: ${arrendamiento.cliente_telefono || 'No especificado'}`);
    doc.moveDown(2);
    
    // Sección 2: Objeto del contrato
    doc.fontSize(14).text('2. OBJETO DEL CONTRATO', { underline: true });
    doc.moveDown();
    doc.fontSize(12).text(`El presente contrato tiene por objeto el arrendamiento del siguiente software:`);
    doc.moveDown();
    doc.text(`• Producto: ${arrendamiento.producto_nombre}`);
    doc.text(`• Descripción: ${arrendamiento.producto_descripcion || 'Software de aplicación'}`);
    doc.text(`• Cantidad: ${arrendamiento.cantidad} licencia(s)`);
    doc.moveDown(2);
    
    // Sección 3: Términos del arrendamiento
    doc.fontSize(14).text('3. TÉRMINOS DEL ARRENDAMIENTO', { underline: true });
    doc.moveDown();
    doc.fontSize(12).text(`• Fecha de inicio: ${new Date(arrendamiento.fecha_inicio_arrendamiento).toLocaleDateString('es-ES')}`);
    if (arrendamiento.fecha_fin_arrendamiento) {
      doc.text(`• Fecha de finalización: ${new Date(arrendamiento.fecha_fin_arrendamiento).toLocaleDateString('es-ES')}`);
    }
    doc.text(`• Período de arrendamiento: ${arrendamiento.cantidad_periodos} ${arrendamiento.periodo_arrendamiento}(es)`);
    const total = parseFloat(arrendamiento.total) || 0;
    doc.text(`• Monto total del contrato: $${total.toFixed(2)}`);
    doc.moveDown(2);
    
    // Sección 4: Condiciones generales
    doc.fontSize(14).text('4. CONDICIONES GENERALES', { underline: true });
    doc.moveDown();
    doc.fontSize(12).text('4.1. El software arrendado es para uso exclusivo del arrendatario.');
    doc.text('4.2. No está permitida la sublicencia, venta o transferencia del software.');
    doc.text('4.3. El arrendatario es responsable del uso adecuado del software.');
    doc.text('4.4. Pixsoft proveerá soporte técnico durante el período del contrato.');
    doc.text('4.5. Cualquier modificación al software requiere autorización por escrito.');
    doc.moveDown(2);
    
    // Sección 5: Propiedad intelectual
    doc.fontSize(14).text('5. PROPIEDAD INTELECTUAL', { underline: true });
    doc.moveDown();
    doc.fontSize(12).text('El arrendatario reconoce que todos los derechos de propiedad intelectual sobre el software arrendado son y permanecerán propiedad exclusiva de Pixsoft S.A.');
    doc.moveDown(2);
    
    // Sección 6: Confidencialidad
    doc.fontSize(14).text('6. CONFIDENCIALIDAD', { underline: true });
    doc.moveDown();
    doc.fontSize(12).text('Las partes se comprometen a mantener la confidencialidad de toda información intercambiada durante la vigencia de este contrato.');
    doc.moveDown(2);
    
    // Firmas
    doc.moveDown(4);
    doc.text('_________________________', 50, doc.y, { align: 'left', width: 200 });
    doc.text('ARRENDADOR: Pixsoft S.A.', 50, doc.y + 20, { align: 'left', width: 200 });
    doc.moveDown();
    
    doc.text('_________________________', 300, doc.y, { align: 'left', width: 200 });
    doc.text(`ARRENDATARIO: ${arrendamiento.cliente_nombre}`, 300, doc.y + 20, { align: 'left', width: 200 });
    
    // Pie de página
    doc.moveDown(4);
    doc.fontSize(10).text('Documento generado automáticamente por el sistema Pixsoft', { align: 'center' });
    doc.text(`Fecha de generación: ${new Date().toLocaleDateString('es-ES')}`, { align: 'center' });
    
    doc.end();
    
  } catch (error) {
    console.error('Error generando contrato:', error);
    res.status(500).json({ error: 'Error al generar el contrato' });
  }
});

// Generar contrato personalizado
router.post('/generar-contrato-personalizado', verifyToken, authorizeAdmin, async (req, res) => {
  try {
    const { venta_detalle_id, terminos_adicionales, condiciones_especiales } = req.body;
    
    if (!venta_detalle_id) {
      return res.status(400).json({ error: 'Se requiere venta_detalle_id' });
    }
    
    // Obtener datos del arrendamiento
    const arrendamientoQuery = `
      SELECT 
        vd.*,
        v.numero_orden,
        v.total,
        CONCAT(u.first_name, ' ', u.last_name) as cliente_nombre,
        u.email as cliente_email,
        u.phone as cliente_telefono,
        p.nombre as producto_nombre,
        p.descripcion as producto_descripcion
      FROM venta_detalles vd
      JOIN ventas v ON vd.venta_id = v.id
      JOIN users u ON v.cliente_id = u.id
      JOIN productos p ON vd.producto_id = p.id
      WHERE vd.id = $1
      AND vd.es_arrendamiento = true
    `;

    const result = await db.query(arrendamientoQuery, [venta_detalle_id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Arrendamiento no encontrado' });
    }

    const arrendamiento = result.rows[0];
    
    // Crear PDF
    const doc = new PDFDocument({ margin: 50 });
    
    // Configurar headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="contrato-personalizado-${arrendamiento.numero_orden}.pdf"`);
    
    doc.pipe(res);
    
    // Encabezado
    doc.fontSize(20).text('CONTRATO DE ARRENDAMIENTO DE SOFTWARE', { align: 'center' });
    doc.fontSize(14).text('(CON TÉRMINOS PERSONALIZADOS)', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Número de Contrato: ${arrendamiento.numero_orden}`, { align: 'center' });
    doc.moveDown(2);
    
    // Sección 1: Partes
    doc.fontSize(14).text('1. PARTES CONTRATANTES', { underline: true });
    doc.moveDown();
    doc.fontSize(12).text(`ARRENDADOR: PIXSOFT S.A.`);
    doc.text(`RUC: 12345678901`);
    doc.text(`Dirección: Av. Principal 123, Ciudad`);
    doc.moveDown();
    doc.text(`ARRENDATARIO: ${arrendamiento.cliente_nombre}`);
    doc.text(`Email: ${arrendamiento.cliente_email}`);
    doc.text(`Teléfono: ${arrendamiento.cliente_telefono || 'No especificado'}`);
    doc.moveDown(2);
    
    // Sección 2: Objeto del contrato
    doc.fontSize(14).text('2. OBJETO DEL CONTRATO', { underline: true });
    doc.moveDown();
    doc.fontSize(12).text(`El presente contrato tiene por objeto el arrendamiento del siguiente software:`);
    doc.moveDown();
    doc.text(`• Producto: ${arrendamiento.producto_nombre}`);
    doc.text(`• Descripción: ${arrendamiento.producto_descripcion || 'Software de aplicación'}`);
    doc.text(`• Cantidad: ${arrendamiento.cantidad} licencia(s)`);
    doc.moveDown(2);
    
    // Sección 3: Términos del arrendamiento
    doc.fontSize(14).text('3. TÉRMINOS DEL ARRENDAMIENTO', { underline: true });
    doc.moveDown();
    doc.fontSize(12).text(`• Fecha de inicio: ${new Date(arrendamiento.fecha_inicio_arrendamiento).toLocaleDateString('es-ES')}`);
    if (arrendamiento.fecha_fin_arrendamiento) {
      doc.text(`• Fecha de finalización: ${new Date(arrendamiento.fecha_fin_arrendamiento).toLocaleDateString('es-ES')}`);
    }
    doc.text(`• Período de arrendamiento: ${arrendamiento.cantidad_periodos} ${arrendamiento.periodo_arrendamiento}(es)`);
    doc.text(`• Monto total del contrato: $${arrendamiento.total.toFixed(2)}`);
    doc.moveDown(2);
    
    // Sección 4: Condiciones generales estándar
    doc.fontSize(14).text('4. CONDICIONES GENERALES', { underline: true });
    doc.moveDown();
    doc.fontSize(12).text('4.1. El software arrendado es para uso exclusivo del arrendatario.');
    doc.text('4.2. No está permitida la sublicencia, venta o transferencia del software.');
    doc.text('4.3. El arrendatario es responsable del uso adecuado del software.');
    doc.text('4.4. Pixsoft proveerá soporte técnico durante el período del contrato.');
    doc.text('4.5. Cualquier modificación al software requiere autorización por escrito.');
    doc.moveDown(2);
    
    // Sección 5: Términos adicionales personalizados
    if (terminos_adicionales) {
      doc.fontSize(14).text('5. TÉRMINOS ADICIONALES', { underline: true });
      doc.moveDown();
      doc.fontSize(12).text(terminos_adicionales);
      doc.moveDown(2);
    }
    
    // Sección 6: Condiciones especiales
    if (condiciones_especiales) {
      doc.fontSize(14).text('6. CONDICIONES ESPECIALES', { underline: true });
      doc.moveDown();
      doc.fontSize(12).text(condiciones_especiales);
      doc.moveDown(2);
    }
    
    // Sección 7: Propiedad intelectual
    doc.fontSize(14).text('7. PROPIEDAD INTELECTUAL', { underline: true });
    doc.moveDown();
    doc.fontSize(12).text('El arrendatario reconoce que todos los derechos de propiedad intelectual sobre el software arrendado son y permanecerán propiedad exclusiva de Pixsoft S.A.');
    doc.moveDown(2);
    
    // Sección 8: Confidencialidad
    doc.fontSize(14).text('8. CONFIDENCIALIDAD', { underline: true });
    doc.moveDown();
    doc.fontSize(12).text('Las partes se comprometen a mantener la confidencialidad de toda información intercambiada durante la vigencia de este contrato.');
    doc.moveDown(2);
    
    // Firmas
    doc.moveDown(4);
    doc.text('_________________________', 50, doc.y, { align: 'left', width: 200 });
    doc.text('ARRENDADOR: Pixsoft S.A.', 50, doc.y + 20, { align: 'left', width: 200 });
    doc.moveDown();
    
    doc.text('_________________________', 300, doc.y, { align: 'left', width: 200 });
    doc.text(`ARRENDATARIO: ${arrendamiento.cliente_nombre}`, 300, doc.y + 20, { align: 'left', width: 200 });
    
    // Pie de página
    doc.moveDown(4);
    doc.fontSize(10).text('Documento generado automáticamente por el sistema Pixsoft', { align: 'center' });
    doc.text(`Fecha de generación: ${new Date().toLocaleDateString('es-ES')}`, { align: 'center' });
    doc.text('CONTRATO PERSONALIZADO - Versión 1.0', { align: 'center' });
    
    doc.end();
    
  } catch (error) {
    console.error('Error generando contrato personalizado:', error);
    res.status(500).json({ error: 'Error al generar el contrato personalizado' });
  }
});

// Enviar recordatorio por email
router.post('/enviar-recordatorio', verifyToken, authorizeAdmin, async (req, res) => {
  try {
    const { venta_detalle_id } = req.body;
    
    if (!venta_detalle_id) {
      return res.status(400).json({ error: 'Se requiere venta_detalle_id' });
    }
    
    // Obtener datos del arrendamiento
    const arrendamientoQuery = `
      SELECT 
        vd.*,
        v.numero_orden,
        CONCAT(u.first_name, ' ', u.last_name) as cliente_nombre,
        u.email as cliente_email,
        p.nombre as producto_nombre
      FROM venta_detalles vd
      JOIN ventas v ON vd.venta_id = v.id
      JOIN users u ON v.cliente_id = u.id
      JOIN productos p ON vd.producto_id = p.id
      WHERE vd.id = $1
      AND vd.es_arrendamiento = true
    `;

    const result = await db.query(arrendamientoQuery, [venta_detalle_id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Arrendamiento no encontrado' });
    }

    const arrendamiento = result.rows[0];
    
    // Calcular días restantes
    let diasRestantes = 0;
    if (arrendamiento.fecha_fin_arrendamiento) {
      const fechaFin = new Date(arrendamiento.fecha_fin_arrendamiento);
      const hoy = new Date();
      diasRestantes = Math.ceil((fechaFin - hoy) / (1000 * 60 * 60 * 24));
    }
    
    // Configurar email
    const mailOptions = {
      from: `"Pixsoft - Arrendamientos" <${process.env.EMAIL_USER}>`,
      to: arrendamiento.cliente_email,
      subject: `Recordatorio: Arrendamiento ${arrendamiento.producto_nombre}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Recordatorio de Arrendamiento</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f8f9fa; }
            .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
            .content { padding: 40px 30px; }
            .alert { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px; }
            .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #6c757d; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0; font-size: 24px;">Recordatorio de Arrendamiento</h1>
            </div>
            <div class="content">
              <h2 style="color: #495057;">Hola ${arrendamiento.cliente_nombre},</h2>
              <p>Este es un recordatorio sobre tu arrendamiento activo:</p>
              
              <div class="alert">
                <strong>Producto:</strong> ${arrendamiento.producto_nombre}<br>
                <strong>Número de orden:</strong> ${arrendamiento.numero_orden}<br>
                ${arrendamiento.fecha_fin_arrendamiento ? `
                  <strong>Fecha de finalización:</strong> ${new Date(arrendamiento.fecha_fin_arrendamiento).toLocaleDateString('es-ES')}<br>
                  <strong>Días restantes:</strong> ${diasRestantes} días
                ` : ''}
              </div>
              
              <p>Por favor, ten en cuenta las siguientes opciones:</p>
              <ul>
                <li>Renovación automática (si está configurada)</li>
                <li>Contactarnos para extender el período</li>
                <li>Exportar tus datos antes de la finalización</li>
              </ul>
              
              <p>Si tienes alguna pregunta, no dudes en contactarnos.</p>
              
              <p>Atentamente,<br>
              <strong>Equipo de Arrendamientos - Pixsoft</strong></p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} Pixsoft. Todos los derechos reservados.</p>
              <p style="font-size: 12px;">Este es un email automático, por favor no responder.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    await transporter.sendMail(mailOptions);
    
    res.json({ success: true, message: 'Recordatorio enviado exitosamente' });
    
  } catch (error) {
    console.error('Error enviando recordatorio:', error);
    res.status(500).json({ error: 'Error al enviar el recordatorio' });
  }
});

module.exports = router;