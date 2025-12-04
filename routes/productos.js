const express = require("express");
const router = express.Router();
const db = require("../db")
const {verifyToken, authorizeAdmin} = require('../middleware/auth')
const usuarioService = require('../services/usuarioService');
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
require('dotenv').config();

router.get('/', async(req, res) =>{
    const {
      page,
    } = req.query;
    try{
        
    console.log("Query params recibidos: ", req.query)
    let limit = parseInt(req.query.limit) || 21;
    const currentPage = parseInt(page);
    let offset = (currentPage - 1) * limit;

                   // desplazamiento SQL
    const productosQuery = `
      SELECT * FROM productos 
      ORDER BY fecha_creacion DESC
      LIMIT $1 OFFSET $2
    `;

    const countQuery = `
      SELECT COUNT(*) FROM productos
    `;

    const productos = await db.query(productosQuery, [limit, offset]);
    const total = await db.query(countQuery);
    if (categoria_id) {
    whereClauses.push(`m.nombre_marca ILIKE $${paramIndex++}`);
    queryParams.push(`%${categoria_id}%`);
  }
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