const express = require("express");
const router = express.Router();
const db = require("../db");
const { verifyToken, authorizeAdmin } = require('../middleware/auth');

// Importante: Remover imports innecesarios si no se usan aquí
// const usuarioService = require('../services/usuarioService');
// const bcrypt = require("bcrypt");
// const jwt = require("jsonwebtoken");

router.get("/", async (req, res) => {
  const { categoria, marca, tipo, destacado, searchQuery, offer } = req.query;

  try {
    console.log("Query params recibidos: ", req.query);

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 21;
    const offset = (page - 1) * limit;

    const whereClauses = ["p.activo = true and p.stock > 0"];
    const queryParams = [];
    let paramIndex = 1;

    if (categoria) {
      whereClauses.push(`p.categoria_id = $${paramIndex}`);
      queryParams.push(categoria);
      paramIndex++;
    }

    if (tipo) {
      whereClauses.push(`p.tipo = $${paramIndex}`);
      queryParams.push(tipo);
      paramIndex++;
    }

    if (marca) {
      whereClauses.push(`p.marca_id = $${paramIndex}`);
      queryParams.push(marca);
      paramIndex++;
    }

    if (destacado) {
      whereClauses.push(`p.destacado = $${paramIndex}`);
      queryParams.push(destacado == "true");
      paramIndex++;
    }

    if (searchQuery) {
      whereClauses.push(`(p.nombre ILIKE $${paramIndex} OR p.descripcion ILIKE $${paramIndex})`);
      queryParams.push(`%${searchQuery}%`);
      paramIndex++;
    }

    if (offer) {
      whereClauses.push(`p.precio_descuento IS NOT NULL AND p.precio_descuento < p.precio`);
    }

    const whereSQL = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const productosQuery = `
      SELECT 
        p.id,
        p.nombre AS producto_nombre,
        p.url_imagen,
        p.precio,
        c.nombre AS categoria_nombre,
        p.precio_descuento,
        p.destacado,
        p.activo,
        p.stock,
        COALESCE(AVG(o.calificacion), 0) AS promedio_calificacion
      FROM productos p
      LEFT JOIN opiniones o ON o.producto_id = p.id
      LEFT JOIN categorias c ON p.categoria_id = c.id
      LEFT JOIN marcas m ON m.id = p.marca_id
      ${whereSQL}
      GROUP BY p.id, c.id
      ORDER BY p.fecha_creacion DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    queryParams.push(limit, offset);

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM productos p
      LEFT JOIN marcas m ON m.id = p.marca_id
      ${whereSQL}
    `;

    const [productos, total] = await Promise.all([
      db.query(productosQuery, queryParams),
      db.query(countQuery, queryParams.slice(0, paramIndex - 1)),
    ]);

    const totalCount = Number(total.rows[0].total);

    res.json({
      page,
      limit,
      total: totalCount,
      total_pages: Math.ceil(totalCount / limit),
      data: productos.rows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error obteniendo productos" });
  }
});

router.get('/:id_producto', async (req, res) => {
  const id_producto = parseInt(req.params.id_producto);
  if (isNaN(id_producto)) {
    return res.status(400).send('Id de producto invalido');
  }
  
  try {
    const perfumeResult = await db.query(`
      SELECT 
        p.id,
        p.nombre AS producto_nombre,
        p.descripcion,
        p.caracteristicas,
        c.nombre AS categoria_nombre,
        m.nombre AS marca_nombre,
        p.url_imagen,
        p.precio,
        p.precio_descuento,
        p.destacado,
        p.activo,
        p.sku,
        p.stock,
        p.tipo,
        p.es_arrendable,
        p.duracion_minima_arrendamiento,
        p.duracion_maxima_arrendamiento,
        p.peso_kg,
        p.dimensiones_cm,
        p.costo,
        COALESCE(AVG(o.calificacion), 0) AS promedio_calificacion
      FROM productos p
      LEFT JOIN marcas m ON p.marca_id = m.id
      LEFT JOIN opiniones o ON o.producto_id = p.id
      LEFT JOIN categorias c ON p.categoria_id = c.id
      WHERE p.id = $1
      GROUP BY p.id, c.id, m.id;
    `, [id_producto]);

    if (perfumeResult.rows.length === 0) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    res.json({
      data: perfumeResult.rows[0]
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error obteniendo producto" });
  }
});

// Ruta para agregar producto (POST)
router.post("/agregar", async (req, res) => {
  const {
    sku,
    nombre,
    descripcion,
    caracteristicas, // Este campo viene como JSON del frontend
    categoria,
    marca,
    precio,
    precio_descuento,
    costo,
    url_imagen,
    tipo,
    es_arrendable,
    duracion_minima_arrendamiento,
    duracion_maxima_arrendamiento,
    peso_kg,
    dimensiones_cm,
    activo,
    destacado,
    stock
  } = req.body;

  // Validar campos requeridos
  if (!sku || !nombre || !categoria || !marca || precio === undefined || stock === undefined) {
    return res.status(400).json({ error: "Campos requeridos faltantes" });
  }

  let idMarca;
  let idCategoria;

  try {
    // Buscar o crear marca
    const marcaResult = await db.query(`
      SELECT id FROM marcas WHERE nombre = $1
    `, [marca]);

    const categoriaResult = await db.query(`
      SELECT id FROM categorias WHERE nombre = $1  
    `, [categoria]);

    if (marcaResult.rows.length === 0) {
      const insertMarcaResult = await db.query(`
        INSERT INTO marcas (nombre)
        VALUES ($1)
        RETURNING id;
      `, [marca]);
      idMarca = insertMarcaResult.rows[0].id;
    } else {
      idMarca = marcaResult.rows[0].id;
    }

    if (categoriaResult.rows.length === 0) {
      const insertCategoriaResult = await db.query(`
        INSERT INTO categorias (nombre)
        VALUES ($1)
        RETURNING id;
      `, [categoria]);
      idCategoria = insertCategoriaResult.rows[0].id;
    } else {
      idCategoria = categoriaResult.rows[0].id;
    }

    // Preparar características como JSON
    const caracteristicasJSON = caracteristicas ? JSON.stringify(caracteristicas) : null;

    // Corregido: El orden de los valores debe coincidir exactamente con los placeholders
    const query = `
      INSERT INTO productos (
        sku, nombre, descripcion, caracteristicas, categoria_id, marca_id,
        precio, precio_descuento, costo, url_imagen, tipo, es_arrendable,
        duracion_minima_arrendamiento, duracion_maxima_arrendamiento,
        peso_kg, dimensiones_cm, activo, destacado, stock
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18, $19
      )
      RETURNING *;
    `;

    const values = [
      sku,
      nombre,
      descripcion,
      caracteristicasJSON, // $4 - JSON
      idCategoria,         // $5
      idMarca,            // $6
      precio,
      precio_descuento || null,
      costo || 0,
      url_imagen || null,
      tipo || 'fisico',   // $11 - CORREGIDO: tipo debe ir aquí
      es_arrendable || false,
      duracion_minima_arrendamiento || null,
      duracion_maxima_arrendamiento || null,
      peso_kg || null,
      dimensiones_cm || null,
      activo ?? true,
      destacado ?? false,
      stock
    ];

    const result = await db.query(query, values);

    res.status(201).json({
      message: "Producto creado correctamente",
      data: result.rows[0]
    });

  } catch (error) {
    console.error("Error en POST /agregar:", error);
    res.status(500).json({
      error: "El producto no se pudo crear",
      details: error.message
    });
  }
});

// Ruta para actualizar producto (PUT) - NECESARIO para el frontend
router.put("/:id_producto", async (req, res) => {
  const id_producto = parseInt(req.params.id_producto);
  if (isNaN(id_producto)) {
    return res.status(400).json({ error: "Id de producto inválido" });
  }

  const {
    sku,
    nombre,
    descripcion,
    caracteristicas,
    categoria,
    marca,
    precio,
    precio_descuento,
    costo,
    url_imagen,
    tipo,
    es_arrendable,
    duracion_minima_arrendamiento,
    duracion_maxima_arrendamiento,
    peso_kg,
    dimensiones_cm,
    activo,
    destacado,
    stock
  } = req.body;

  try {
    // Verificar si el producto existe
    const productoExistente = await db.query(
      `SELECT id FROM productos WHERE id = $1`,
      [id_producto]
    );

    if (productoExistente.rows.length === 0) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    let idMarca;
    let idCategoria;

    // Buscar o crear marca
    const marcaResult = await db.query(
      `SELECT id FROM marcas WHERE nombre = $1`,
      [marca]
    );

    if (marcaResult.rows.length === 0) {
      const insertMarcaResult = await db.query(
        `INSERT INTO marcas (nombre) VALUES ($1) RETURNING id`,
        [marca]
      );
      idMarca = insertMarcaResult.rows[0].id;
    } else {
      idMarca = marcaResult.rows[0].id;
    }

    // Buscar o crear categoría
    const categoriaResult = await db.query(
      `SELECT id FROM categorias WHERE nombre = $1`,
      [categoria]
    );

    if (categoriaResult.rows.length === 0) {
      const insertCategoriaResult = await db.query(
        `INSERT INTO categorias (nombre) VALUES ($1) RETURNING id`,
        [categoria]
      );
      idCategoria = insertCategoriaResult.rows[0].id;
    } else {
      idCategoria = categoriaResult.rows[0].id;
    }

    // Preparar características como JSON
    const caracteristicasJSON = caracteristicas ? JSON.stringify(caracteristicas) : null;

    // Query de actualización
    const query = `
      UPDATE productos 
      SET 
        sku = $1,
        nombre = $2,
        descripcion = $3,
        caracteristicas = $4,
        categoria_id = $5,
        marca_id = $6,
        precio = $7,
        precio_descuento = $8,
        costo = $9,
        url_imagen = $10,
        tipo = $11,
        es_arrendable = $12,
        duracion_minima_arrendamiento = $13,
        duracion_maxima_arrendamiento = $14,
        peso_kg = $15,
        dimensiones_cm = $16,
        activo = $17,
        destacado = $18,
        stock = $19,
        fecha_actualizacion = NOW()
      WHERE id = $20
      RETURNING *;
    `;

    const values = [
      sku,
      nombre,
      descripcion,
      caracteristicasJSON,
      idCategoria,
      idMarca,
      precio,
      precio_descuento || null,
      costo || 0,
      url_imagen || null,
      tipo || 'fisico',
      es_arrendable || false,
      duracion_minima_arrendamiento || null,
      duracion_maxima_arrendamiento || null,
      peso_kg || null,
      dimensiones_cm || null,
      activo ?? true,
      destacado ?? false,
      stock,
      id_producto
    ];

    const result = await db.query(query, values);

    res.status(200).json({
      message: "Producto actualizado correctamente",
      data: result.rows[0]
    });

  } catch (error) {
    console.error("Error en PUT /:id_producto:", error);
    res.status(500).json({
      error: "El producto no se pudo actualizar",
      details: error.message
    });
  }
});

// Ruta para eliminar producto (DELETE) - Opcional pero útil
router.delete("/:id_producto", async (req, res) => {
  const id_producto = parseInt(req.params.id_producto);
  if (isNaN(id_producto)) {
    return res.status(400).json({ error: "Id de producto inválido" });
  }

  try {
    const result = await db.query(
      `DELETE FROM productos WHERE id = $1 RETURNING *`,
      [id_producto]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    res.status(200).json({
      message: "Producto eliminado correctamente",
      data: result.rows[0]
    });
  } catch (error) {
    console.error("Error en DELETE /:id_producto:", error);
    res.status(500).json({
      error: "El producto no se pudo eliminar",
      details: error.message
    });
  }
});

module.exports = router;