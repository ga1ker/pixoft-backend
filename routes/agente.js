const express = require("express");
const router = express.Router();
const db = require("../db")
const Perplexity = require("@perplexity-ai/perplexity_ai");
const { verifyToken } = require('../middleware/auth');
require('dotenv').config();

const client = new Perplexity(); 

router.get("/history", verifyToken, async (req, res) => {
  const id_usuario = req.user.id_usuario;

  try {
    const result = await db.query(
      `SELECT id_message, message, role, created_at 
       FROM chat_messages 
       WHERE id_usuario = $1
       ORDER BY created_at ASC`,
      [id_usuario]
    );

    res.status(200).json({ messages: result.rows });
  } catch (err) {
    console.error("Error al obtener historial:", err);
    res.status(500).json({ error: "Error al obtener el historial" });
  }
});

router.post("/message", verifyToken, async (req, res) => {
  const { message, history } = req.body;
  const id_usuario = req.user.id_usuario;

  if (!message) {
    return res.status(400).json({ error: "El mensaje es requerido." });
  }

  try {
    // Guarda mensaje del usuario
    await db.query(
      "INSERT INTO chat_messages (id_usuario, message, role) VALUES ($1, $2, 'user')",
      [id_usuario, message]
    );

    // Consulta productos disponibles
    const productosResult = await db.query(
      "SELECT p.id, p.nombre, m.nombre as nombre_marca, c.nombre as categoria FROM productos p JOIN marcas m ON p.marca_id = m.id JOIN categorias c ON p.categoria_id = c.id WHERE p.activo = true"
    );
    const productosDisponibles = productosResult.rows
      .map(p => `${p.nombre} de ${p.nombre_marca} (${p.genero}) - ID: ${p.id_perfume}`)
      .join(", ");

    const systemPrompt = `
    Eres Pixie, el asistente virtual de Pixsoft. Solo puedes ayudar con productos de hardware y computación disponibles en la tienda, si el usuario pide recomendaciones o ayuda de cualquier otro tema que no sea hardware mencionale que solo puedes ayudarle con productos de hardware de la tienda y recomendaciones y así. Tu estilo es breve, cálido, vendedor profesional y cercano; puedes usar expresiones como "bro", "amigo", "amiga" cuando el usuario te habla así, nunca uses tono formal innecesario ni listes productos que no tenemos. Recomienda máximo 2 o 3 opciones disponibles sin enseñar el ID del producto (productos: ${productosDisponibles}) y responde como experto en ventas. Nunca hables de gestionar agendas, correos, citas, o temas fuera de hardware. Nunca uses más de 3 oraciones por respuesta, sé realmente muuy breve.
    `;

    const response = await client.chat.completions.create({
      model: "sonar",
      messages: [
        { role: "system", content: systemPrompt },
        ...(history || []),
        { role: "user", content: message }
      ],
    });

    const botMessage =
      response?.choices?.[0]?.message?.content ||
      response.result ||
      "No se obtuvo respuesta";

    // Guarda mensaje del bot
    await db.query(
      "INSERT INTO chat_messages (id_usuario, message, role) VALUES ($1, $2, 'bot')",
      [id_usuario, botMessage]
    );

    res.status(200).json({
      result: response,
      status: "success"
    });

  } catch (err) {
    console.error("Error en Asistente:", err?.response?.data || err.message);
    res.status(500).json({ error: "Error al obtener respuesta del asistente." });
  }
});

module.exports = router;

