const express = require("express");
const router = express.Router();
const db = require("../db")
const {verifyToken, authorizeAdmin} = require('../middleware/auth')
const usuarioService = require('../services/usuarioService');
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
require('dotenv').config();

router.get('/', async (req, res) => {
  try {
    console.log("Query params recibidos: ", req.query);

    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 21;
    let offset = (page - 1) * limit;

    let whereClauses = ['p.activo = true'];
    let queryParams = [];
    let paramIndex = 1;

    if (categoria) {
    whereClauses.push(`(p.categoria_id = $${paramIndex++} `);
    queryParams.push(categoria);
  }
  if (marca) {
    whereClauses.push(`m.nombre ILIKE $${paramIndex++}`);
    queryParams.push(`%${marca}%`);
  }
 

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
  GROUP BY p.id, c.id
  ORDER BY p.fecha_creacion DESC
  LIMIT $1 OFFSET $2
`;

    // Conteo total
    const countQuery = `SELECT COUNT(*) FROM productos`;

    const productos = await db.query(productosQuery, [limit, offset]);
    const total = await db.query(countQuery);

    res.json({
      page,
      limit,
      total: parseInt(total.rows[0].count),
      total_pages: Math.ceil(total.rows[0].count / limit),
      data: productos.rows
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error obteniendo productos" });
  }
});

router.get('/:id_producto', async(req, res)=>{
    const id_producto = parseInt(req.params.id_producto);
    if(isNaN(id_producto)){
        return res.status(400).send('Id de producto invalido')
    }
    try{
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
    p.stock,
    COALESCE(AVG(o.calificacion), 0) AS promedio_calificacion
  FROM productos p
  LEFT JOIN marcas m ON p.marca_id = m.id
  LEFT JOIN opiniones o ON o.producto_id = p.id
  LEFT JOIN categorias c ON p.categoria_id = c.id
  WHERE p.id = $1
  GROUP BY p.id, c.id, m.id;
    `, [id_producto])
    const producto = perfumeResult

    res.json({
        data:producto.rows[0]
    })
    }
    catch(error){
        console.error(error)
    }

   

})



router.post("/agregar", async(req, res)=>{
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
    let idMarca;
    let idCategoria;
    try{
        const marcaResult = await db.query(`
            SELECT id FROM marcas WHERE nombre = $1
            `, [marca])

        const categoriaResult = await db.query(`
            SELECT id FROM categorias WHERE nombre = $1  
            `, [categoria])

        if (marcaResult.rows.length === 0){
            const insertMarcaResult = await db.query(`
                INSERT INTO marcas (nombre)
                VALUES ($1)
                RETURNING id;
                `, [marca])
            idMarca = insertMarcaResult.rows[0].id
        }else{
            idMarca = marcaResult.rows[0].id

        }

        if(categoriaResult.rows.length === 0){
            const insertCategoriaResult = await db.query(`
                INSERT INTO categorias (nombre)
                VALUES ($1)
                RETURNING id;
                `, [categoria])
            idCategoria = insertCategoriaResult.rows[0].id
        }else{
            idCategoria = categoriaResult.rows[0].id
        }
    }
    catch (error){
        console.log(error)
    }
    
    console.log(idMarca)
    try{

    const query = `
      INSERT INTO productos (
        sku, nombre, descripcion, caracteristicas, categoria_id, marca_id,
        precio, precio_descuento, costo, tipo, es_arrendable,
        duracion_minima_arrendamiento, duracion_maxima_arrendamiento,
        peso_kg, dimensiones_cm, activo, destacado, stock
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,$11,
        $12,$13,$14,$15,$16,$17,$18
      )
      RETURNING *;
    `;
    const values = [
      sku,
      nombre,
      descripcion,
      caracteristicas,
      idCategoria,
      idMarca,
      precio,
      precio_descuento,
      costo,
      tipo || 'fisico',
      es_arrendable || false,
      duracion_minima_arrendamiento,
      duracion_maxima_arrendamiento,
      peso_kg,
      dimensiones_cm,
      activo ?? true,
      destacado ?? false,
      stock
    ];
    const result = await db.query(query, values);

    res.status(201).json({
        message: "Producto creado correctamente",
        data: result.rows[0]
    })


    }
    catch(error){
        console.error(error);
        res.status(500).json({message:"El producto no se pudo crear"})

    }
})

module.exports = router