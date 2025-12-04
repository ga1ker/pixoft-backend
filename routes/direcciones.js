const express = require('express');
const router = express.Router();
const db = require('../db');
//const { verifyToken } = require('../middleware/auth');

router.post('/test-crear', async (req, res) => {
//test de crear rutas:router.post('/test-crear', async (req, res) => {
    console.log('\n🔧 === PRUEBA CREACIÓN DIRECCIÓN ===');
    console.log('📦 Body recibido:', JSON.stringify(req.body, null, 2));

    if (!req.body || typeof req.body !== 'object') {
        console.error('❌ ERROR CRÍTICO: req.body es undefined o no es objeto');
        return res.status(400).json({
            error: 'Cuerpo de la solicitud inválido',
            mensaje: 'El cuerpo debe ser un objeto JSON válido',
            solucion: 'Asegúrate de enviar Content-Type: application/json'
        });
    }
    
    // Para pruebas, usar un usuario_id fijo (ej: 1)
    // En producción, esto vendría del token: req.user.id_usuario
    const usuario_id = 1; 
    
    console.log(`👤 Usuario ID (hardcodeado para prueba): ${usuario_id}`);
    
    const { 
        alias, 
        calle, 
        numero_exterior, 
        numero_interior, 
        colonia, 
        ciudad, 
        estado, 
        codigo_postal, 
        pais = 'México', 
        entre_calles, 
        referencia, 
        es_principal = false, 
        es_facturacion = false 
    } = req.body;

    // Validar campos obligatorios
    console.log('🔍 Validando campos obligatorios...');
    const camposObligatorios = ['calle', 'numero_exterior', 'ciudad', 'estado', 'codigo_postal'];
    const camposFaltantes = camposObligatorios.filter(campo => !req.body[campo]);
    
    if (camposFaltantes.length > 0) {
        console.log('❌ Campos faltantes:', camposFaltantes);
        return res.status(400).json({ 
            error: 'Faltan campos obligatorios',
            campos_faltantes: camposFaltantes,
            mensaje: `Faltan: ${camposFaltantes.join(', ')}`
        });
    }
    
    console.log('✅ Validación de campos exitosa');

    const client = await db.connect();
    console.log('🔌 Conexión a DB establecida');
    
    try {
        await client.query('BEGIN');
        console.log('🔄 Transacción iniciada');

        // Si es principal, quitar el estado de principal de las demás direcciones
        if (es_principal) {
            console.log('⭐ Marcando como PRINCIPAL - actualizando otras...');
            const updateResult = await client.query(
                `UPDATE direcciones
                 SET es_principal = FALSE
                 WHERE usuario_id = $1`,
                [usuario_id]
            );
            console.log(`📊 Direcciones afectadas (no-principal): ${updateResult.rowCount}`);
        }

        // Si es facturación, quitar el estado de facturación de las demás direcciones
        if (es_facturacion) {
            console.log('🧾 Marcando como FACTURACIÓN - actualizando otras...');
            const updateResult = await client.query(
                `UPDATE direcciones
                 SET es_facturacion = FALSE
                 WHERE usuario_id = $1`,
                [usuario_id]
            );
            console.log(`📊 Direcciones afectadas (no-facturación): ${updateResult.rowCount}`);
        }

        console.log('📝 Ejecutando INSERT...');
        const result = await client.query(
            `INSERT INTO direcciones (
                usuario_id, alias, calle, numero_exterior, numero_interior, colonia, ciudad, estado, 
                codigo_postal, pais, entre_calles, referencia, es_principal, es_facturacion
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING id, usuario_id, alias, calle, numero_exterior, numero_interior, colonia, 
                       ciudad, estado, codigo_postal, pais, entre_calles, referencia, es_principal, es_facturacion`,
            [
                usuario_id, 
                alias || null, 
                calle, 
                numero_exterior, 
                numero_interior || null, 
                colonia || null, 
                ciudad, 
                estado, 
                codigo_postal, 
                pais, 
                entre_calles || null, 
                referencia || null, 
                es_principal, 
                es_facturacion
            ]
        );

        console.log(`✅ INSERT exitoso. ID generado: ${result.rows[0].id}`);
        console.log('📄 Datos insertados:', JSON.stringify(result.rows[0], null, 2));

        await client.query('COMMIT');
        console.log('✅ Transacción confirmada (COMMIT)');
        
        res.status(201).json({ 
            success: true,
            message: '✅ Dirección creada exitosamente (PRUEBA)', 
            direccion: result.rows[0],
            debug: {
                usuario_id_utilizado: usuario_id,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ ERROR en transacción:', err.message);
        console.error('🔍 Detalles:', err);
        
        res.status(500).json({ 
            success: false,
            error: 'Error interno del servidor',
            mensaje: err.message,
            codigo: err.code,
            detalle: err.detail || 'Sin detalles adicionales'
        });
    } finally {
        client.release();
        console.log('🔌 Conexión a DB liberada');
        console.log('🎯 === FIN PRUEBA ===\n');
    }
});

// Obtener todas las direcciones del usuario
router.get('/', async (req, res) => {
    const usuario_id = req.user.id_usuario;

    try {
        const result = await db.query(
            `SELECT id, usuario_id, alias, calle, numero_exterior, numero_interior, colonia, ciudad, estado, 
                    codigo_postal, pais, entre_calles, referencia, es_principal, es_facturacion
             FROM direcciones
             WHERE usuario_id = $1
             ORDER BY es_principal DESC, id ASC`,
            [usuario_id]
        );
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error al obtener direcciones:', err);
        res.status(500).send('Error interno del servidor al obtener direcciones.');
    }
});

// Crear una nueva dirección
router.post('/', async (req, res) => {

    req.user = { id_usuario: 1 };
    const usuario_id = req.user.id_usuario;
    const { 
        alias, 
        calle, 
        numero_exterior, 
        numero_interior, 
        colonia, 
        ciudad, 
        estado, 
        codigo_postal, 
        pais = 'México', 
        entre_calles, 
        referencia, 
        es_principal = false, 
        es_facturacion = false 
    } = req.body;

    // Validar campos obligatorios
    if (!calle || !numero_exterior || !ciudad || !estado || !codigo_postal) {
        return res.status(400).send('Faltan campos obligatorios: calle, numero_exterior, ciudad, estado, codigo_postal.');
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Si es principal, quitar el estado de principal de las demás direcciones
        if (es_principal) {
            await client.query(
                `UPDATE direcciones
                 SET es_principal = FALSE
                 WHERE usuario_id = $1`,
                [usuario_id]
            );
        }

        // Si es facturación, quitar el estado de facturación de las demás direcciones
        if (es_facturacion) {
            await client.query(
                `UPDATE direcciones
                 SET es_facturacion = FALSE
                 WHERE usuario_id = $1`,
                [usuario_id]
            );
        }

        const result = await client.query(
            `INSERT INTO direcciones (
                usuario_id, alias, calle, numero_exterior, numero_interior, colonia, ciudad, estado, 
                codigo_postal, pais, entre_calles, referencia, es_principal, es_facturacion
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING id, usuario_id, alias, calle, numero_exterior, numero_interior, colonia, 
                       ciudad, estado, codigo_postal, pais, entre_calles, referencia, es_principal, es_facturacion`,
            [
                usuario_id, 
                alias || null, 
                calle, 
                numero_exterior, 
                numero_interior || null, 
                colonia || null, 
                ciudad, 
                estado, 
                codigo_postal, 
                pais, 
                entre_calles || null, 
                referencia || null, 
                es_principal, 
                es_facturacion
            ]
        );

        await client.query('COMMIT');
        res.status(201).json({ 
            message: 'Dirección agregada exitosamente.', 
            direccion: result.rows[0] 
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error al agregar dirección:', err);
        res.status(500).send('Error interno del servidor al agregar dirección.');
    } finally {
        client.release();
    }
});

// Actualizar una dirección existente
router.put('/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const usuario_id = req.user.id_usuario;
    const { 
        alias, 
        calle, 
        numero_exterior, 
        numero_interior, 
        colonia, 
        ciudad, 
        estado, 
        codigo_postal, 
        pais = 'México', 
        entre_calles, 
        referencia, 
        es_principal = false, 
        es_facturacion = false 
    } = req.body;

    if (isNaN(id)) {
        return res.status(400).send('ID de dirección inválido.');
    }

    // Validar campos obligatorios
    if (!calle || !numero_exterior || !ciudad || !estado || !codigo_postal) {
        return res.status(400).send('Faltan campos obligatorios: calle, numero_exterior, ciudad, estado, codigo_postal.');
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Verificar que la dirección existe y pertenece al usuario
        const checkResult = await client.query(
            `SELECT 1 FROM direcciones WHERE id = $1 AND usuario_id = $2`,
            [id, usuario_id]
        );
        
        if (checkResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).send('Dirección no encontrada o no pertenece a este usuario.');
        }

        // Si se establece como principal, quitar principal de otras direcciones
        if (es_principal) {
            await client.query(
                `UPDATE direcciones
                 SET es_principal = FALSE
                 WHERE usuario_id = $1 AND id != $2`,
                [usuario_id, id]
            );
        }

        // Si se establece como facturación, quitar facturación de otras direcciones
        if (es_facturacion) {
            await client.query(
                `UPDATE direcciones
                 SET es_facturacion = FALSE
                 WHERE usuario_id = $1 AND id != $2`,
                [usuario_id, id]
            );
        }

        // Actualizar la dirección
        const result = await client.query(
            `UPDATE direcciones
             SET alias = $1, calle = $2, numero_exterior = $3, numero_interior = $4,
                 colonia = $5, ciudad = $6, estado = $7, codigo_postal = $8, pais = $9,
                 entre_calles = $10, referencia = $11, es_principal = $12, es_facturacion = $13
             WHERE id = $14 AND usuario_id = $15
             RETURNING id, usuario_id, alias, calle, numero_exterior, numero_interior, colonia, 
                       ciudad, estado, codigo_postal, pais, entre_calles, referencia, es_principal, es_facturacion`,
            [
                alias || null, 
                calle, 
                numero_exterior, 
                numero_interior || null, 
                colonia || null, 
                ciudad, 
                estado, 
                codigo_postal, 
                pais, 
                entre_calles || null, 
                referencia || null, 
                es_principal, 
                es_facturacion, 
                id, 
                usuario_id
            ]
        );

        await client.query('COMMIT');
        res.status(200).json({ 
            message: 'Dirección actualizada exitosamente.', 
            direccion: result.rows[0] 
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error al actualizar dirección:', err);
        res.status(500).send('Error interno del servidor al actualizar dirección.');
    } finally {
        client.release();
    }
});

// Eliminar una dirección
router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const usuario_id = req.user.id_usuario;

    if (isNaN(id)) {
        return res.status(400).send('ID de dirección inválido.');
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Verificar que la dirección existe y obtener sus flags
        const checkResult = await client.query(
            `SELECT es_principal, es_facturacion FROM direcciones WHERE id = $1 AND usuario_id = $2`,
            [id, usuario_id]
        );

        if (checkResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).send('Dirección no encontrada o no pertenece a este usuario.');
        }

        const { es_principal, es_facturacion } = checkResult.rows[0];

        // Verificar si es la única dirección (no permitir eliminar si es la única)
        const countResult = await client.query(
            `SELECT COUNT(*) FROM direcciones WHERE usuario_id = $1`,
            [usuario_id]
        );
        
        const totalDirecciones = parseInt(countResult.rows[0].count);
        
        if (totalDirecciones === 1) {
            await client.query('ROLLBACK');
            return res.status(400).send('No puedes eliminar tu única dirección. Agrega una nueva dirección primero.');
        }

        // Eliminar la dirección
        const result = await client.query(
            `DELETE FROM direcciones
             WHERE id = $1 AND usuario_id = $2
             RETURNING id`,
            [id, usuario_id]
        );

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).send('Dirección no encontrada.');
        }

        // Si la dirección eliminada era principal, establecer otra como principal
        if (es_principal) {
            await client.query(
                `UPDATE direcciones
                 SET es_principal = TRUE
                 WHERE usuario_id = $1
                 LIMIT 1`,
                [usuario_id]
            );
        }

        // Si la dirección eliminada era de facturación, establecer otra como facturación
        if (es_facturacion) {
            await client.query(
                `UPDATE direcciones
                 SET es_facturacion = TRUE
                 WHERE usuario_id = $1
                 LIMIT 1`,
                [usuario_id]
            );
        }

        await client.query('COMMIT');
        res.status(200).json({ 
            message: 'Dirección eliminada exitosamente.', 
            id_eliminado: id 
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error al eliminar dirección:', err);
        
        if (err.code === '23503') { // Foreign key violation
            return res.status(409).send('No se puede eliminar la dirección porque está asociada a pedidos existentes.');
        }
        
        res.status(500).send('Error interno del servidor al eliminar dirección.');
    } finally {
        client.release();
    }
});

// Establecer dirección como principal
router.put('/set-principal/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const usuario_id = req.user.id_usuario;

    if (isNaN(id)) {
        return res.status(400).send('ID de dirección inválido.');
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Verificar que la dirección existe y pertenece al usuario
        const checkResult = await client.query(
            `SELECT 1 FROM direcciones WHERE id = $1 AND usuario_id = $2`,
            [id, usuario_id]
        );
        
        if (checkResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).send('Dirección no encontrada o no pertenece a este usuario.');
        }

        // Quitar principal de todas las direcciones
        await client.query(
            `UPDATE direcciones
             SET es_principal = FALSE
             WHERE usuario_id = $1`,
            [usuario_id]
        );

        // Establecer esta dirección como principal
        const result = await client.query(
            `UPDATE direcciones
             SET es_principal = TRUE
             WHERE id = $1 AND usuario_id = $2
             RETURNING id, alias, calle, numero_exterior, ciudad, estado, es_principal`,
            [id, usuario_id]
        );

        await client.query('COMMIT');
        res.status(200).json({ 
            message: 'Dirección establecida como principal exitosamente.', 
            direccion: result.rows[0] 
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error al establecer dirección principal:', err);
        res.status(500).send('Error interno del servidor al establecer la dirección principal.');
    } finally {
        client.release();
    }
});

// Establecer dirección como facturación
router.put('/set-facturacion/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const usuario_id = req.user.id_usuario;

    if (isNaN(id)) {
        return res.status(400).send('ID de dirección inválido.');
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // Verificar que la dirección existe y pertenece al usuario
        const checkResult = await client.query(
            `SELECT 1 FROM direcciones WHERE id = $1 AND usuario_id = $2`,
            [id, usuario_id]
        );
        
        if (checkResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).send('Dirección no encontrada o no pertenece a este usuario.');
        }

        // Quitar facturación de todas las direcciones
        await client.query(
            `UPDATE direcciones
             SET es_facturacion = FALSE
             WHERE usuario_id = $1`,
            [usuario_id]
        );

        // Establecer esta dirección como facturación
        const result = await client.query(
            `UPDATE direcciones
             SET es_facturacion = TRUE
             WHERE id = $1 AND usuario_id = $2
             RETURNING id, alias, calle, numero_exterior, ciudad, estado, es_facturacion`,
            [id, usuario_id]
        );

        await client.query('COMMIT');
        res.status(200).json({ 
            message: 'Dirección establecida como facturación exitosamente.', 
            direccion: result.rows[0] 
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error al establecer dirección de facturación:', err);
        res.status(500).send('Error interno del servidor al establecer la dirección de facturación.');
    } finally {
        client.release();
    }
});

module.exports = router;