const express = require("express");
const router = express.Router();
const db = require("../db")

router.get("/", async (req, res) => {
    try {
        const result = await db.query("SELECT id, nombre, descripcion, logo_url FROM marcas where activa = true");
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error obteniendo categorías" });
    }
})

module.exports = router;