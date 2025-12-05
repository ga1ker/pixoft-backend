const express = require("express");
const router = express.Router();
const db = require("../db")

// Obtener todas las marcas activas
router.get("/", async (req, res) => {
    try {
        const result = await db.query("SELECT id, nombre, descripcion, logo_url FROM marcas where activa = true");
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error obteniendo marcas" });
    }
})

// Crear una nueva marca
router.post("/", async (req, res) => {
    try {
        const { nombre, logo_url, descripcion, activa = true } = req.body;

        // Validar que se proporcione el nombre
        if (!nombre) {
            return res.status(400).json({ error: "El nombre de la marca es requerido" });
        }

        // Verificar si la marca ya existe
        const existeMarca = await db.query(
            "SELECT id FROM marcas WHERE nombre = $1",
            [nombre]
        );

        if (existeMarca.rows.length > 0) {
            return res.status(409).json({ error: "Ya existe una marca con este nombre" });
        }

        // Insertar nueva marca
        const result = await db.query(
            `INSERT INTO marcas (nombre, logo_url, descripcion, activa) 
             VALUES ($1, $2, $3, $4) 
             RETURNING id, nombre, logo_url, descripcion, activa`,
            [nombre, logo_url || null, descripcion || null, activa]
        );

        res.status(201).json({
            message: "Marca creada exitosamente",
            marca: result.rows[0]
        });

    } catch (error) {
        console.error("Error al crear marca:", error);
        
        if (error.code === '23505') { // Violación de unicidad
            return res.status(409).json({ error: "Ya existe una marca con este nombre" });
        }
        
        res.status(500).json({ error: "Error al crear la marca" });
    }
})

module.exports = router;