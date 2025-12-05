
const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

// Obtener todas las direcciones del usuario
router.get('/', verifyToken, async (req, res) => {
    const usuario_id = req.user.id;

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

// Obtener UNA sola dirección del usuario por ID
router.get('/direccion/:id', verifyToken, async (req, res) => {
    const usuario_id = req.user.id;
    const direccion_id = req.params.id;

    try {
        const result = await db.query(
            `SELECT id, usuario_id, alias, calle, numero_exterior, numero_interior, colonia, ciudad, estado,
                    codigo_postal, pais, entre_calles, referencia, es_principal, es_facturacion
             FROM direcciones
             WHERE id = $1 AND usuario_id = $2
             LIMIT 1`,
            [direccion_id, usuario_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Dirección no encontrada o no pertenece al usuario" });
        }

        res.status(200).json(result.rows[0]);

    } catch (err) {
        console.error('Error al obtener dirección:', err);
        res.status(500).send('Error interno del servidor al obtener dirección.');
    }
});

// Crear una nueva dirección
router.post('/', verifyToken, async (req, res) => {
    const id = req.user.id;
    console.log("id del usuario" + req.user.id);
    
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
                [id]
            );
        }

        // Si es facturación, quitar el estado de facturación de las demás direcciones
        if (es_facturacion) {
            await client.query(
                `UPDATE direcciones
                 SET es_facturacion = FALSE
                 WHERE usuario_id = $1`,
                [id]
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
                id, 
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
router.put('/:id', verifyToken, async (req, res) => {
    const id = parseInt(req.params.id);
    const usuario_id = req.user.id;
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
router.delete('/:id', verifyToken, async (req, res) => {
    const id = parseInt(req.params.id);
    const usuario_id = req.user.id;

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
                WHERE id = (
                    SELECT id FROM direcciones
                    WHERE usuario_id = $1
                    ORDER BY id ASC
                    LIMIT 1
                )`,
                [usuario_id]
            );
        }

        // Si la dirección eliminada era de facturación, establecer otra como facturación
        if (es_facturacion) {
            await client.query(
                `UPDATE direcciones
                SET es_facturacion = TRUE
                WHERE id = (
                    SELECT id FROM direcciones
                    WHERE usuario_id = $1
                    ORDER BY id ASC
                    LIMIT 1
                )`,
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
router.put('/set-principal/:id', verifyToken, async (req, res) => {
    const id = parseInt(req.params.id);
    const usuario_id = req.user.id;

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
router.put('/set-facturacion/:id', verifyToken, async (req, res) => {
    const id = parseInt(req.params.id);
    const usuario_id = req.user.id;

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

// Obtener UNA sola dirección del usuario por ID
router.get('/direccion/:id', verifyToken, async (req, res) => {
  const usuario_id = req.user.id;
  const direccion_id = req.params.id;

  try {
    const result = await db.query(
      `SELECT id, usuario_id, alias, calle, numero_exterior, numero_interior, colonia, ciudad, estado,
              codigo_postal, pais, entre_calles, referencia, es_principal, es_facturacion
       FROM direcciones
       WHERE id = $1 AND usuario_id = $2
       LIMIT 1`,
      [direccion_id, usuario_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Dirección no encontrada o no pertenece al usuario" });
    }

    res.status(200).json(result.rows[0]);

  } catch (err) {
    console.error('Error al obtener dirección:', err);
    res.status(500).send('Error interno del servidor al obtener dirección.');
  }
});

module.exports = router;