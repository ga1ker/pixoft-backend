const express = require("express");
const router = express.Router();
const db = require("../db")

// Obtener todas las categorías activas
router.get("/", async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM categorias where activa = true");
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error obteniendo categorías" });
    }
})

// Crear una nueva categoría
router.post("/", async (req, res) => {
    try {
        const { nombre, descripcion, imagen_url, activa = true } = req.body;

        // Validar que se proporcione el nombre
        if (!nombre) {
            return res.status(400).json({ error: "El nombre de la categoría es requerido" });
        }

        // Insertar nueva categoría
        const result = await db.query(
            `INSERT INTO categorias (nombre, descripcion, imagen_url, activa) 
             VALUES ($1, $2, $3, $4) 
             RETURNING id, nombre, descripcion, imagen_url, activa`,
            [nombre, descripcion || null, imagen_url || null, activa]
        );

        res.status(201).json({
            message: "Categoría creada exitosamente",
            categoria: result.rows[0]
        });

    } catch (error) {
        console.error("Error al crear categoría:", error);
        res.status(500).json({ error: "Error al crear la categoría" });
    }
})

module.exports = router;