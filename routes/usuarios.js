const express = require('express');
const router = express.Router();
const usuarioService = require('../services/usuarioService');
const bcrypt = require('bcrypt');
const db = require('../db');
const jwt = require('jsonwebtoken');
const { verifyToken, authorizeAdmin } = require('../middleware/auth');
require('dotenv').config();

router.get('/', async (req, res) => {
  try {
    const result = await usuarioService.getAllUsuarios();
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

router.post('/register', async (req, res) => {
  const { nombre, apellidos, email, password, telefono } = req.body;
  const rol = 'cliente';

  try {
    const contrasena_hash = await bcrypt.hash(password, 12);
    const newUser = await usuarioService.createUsuario({
      nombre,
      apellidos,
      email,
      contrasena_hash,
      telefono,
      rol,
      activo: false
    });

    const verificationCode = usuarioService.generateVerificationCode();
    await usuarioService.saveVerificationCode(newUser.id, verificationCode, 'registro', 15);

    await usuarioService.sendVerificationEmail(email, verificationCode, nombre);

    res.status(201).json({
      message: 'Usuario registrado. Verifica tu correo para activar tu cuenta.',
      userId: newUser.id,
      success: true
    });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') {
      return res.status(409).json({ message: 'El correo ya está registrado' });
    }
    if (err.code === '23502') {
      return res.status(400).json({ message: 'Faltan datos obligatorios' });
    }
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

router.post('/verify-email', async (req, res) => {
  const { userId, code } = req.body;

  if (!userId || !code) {
    return res.status(400).json({ error: 'Faltan ID de usuario o código' });
  }

  try {
    const isValid = await usuarioService.verifyCode(userId, code, 'registro');
    
    if (isValid) {
      await usuarioService.activateUser(userId);
      
      const token = jwt.sign(
        { id: userId, role: 'cliente' },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({ 
        message: 'Cuenta verificada exitosamente', 
        token, 
        success: true 
      });
    } else {
      res.status(400).json({ error: 'Código inválido o expirado' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.post("/login", async (req, res) => {
    const { email, password } = req.body;
    try {
        const usuarioAutenticado = await usuarioService.authenticateUser(email, password);

        const token = jwt.sign(
            { id: usuarioAutenticado.id, role: usuarioAutenticado.role },
            process.env.JWT_SECRET,
            { expiresIn: '168h' } 
        );

        res.status(200).json({ message: "Inicio de sesión exitoso", usuario: usuarioAutenticado, token: token, success: true });

    } catch (err) {
        console.error(err);
        if (err.message === "El usuario no existe" || err.message === "Contraseña incorrecta") {
            return res.status(401).send(err.message);
        }
        if (err.message === "La cuenta no está activa. Por favor, verifica tu correo.") {
            return res.status(403).send(err.message);
        }
        res.status(500).send("Error interno del servidor al iniciar sesión.");
    }
});

router.post("/change-role", verifyToken, authorizeAdmin, async (req, res) => {
    const id_usuario = req.user.id;
    console.log("Usuario que intenta cambiar rol:", id_usuario);
    const { userId, newRole } = req.body;

    if (!userId || !newRole) {
        return res.status(400).json({ error: "Faltan ID de usuario o nuevo rol" });
    }

    try {
        const result = await db.query(`
            UPDATE users 
            SET role = $1 
            WHERE id = $2 
            RETURNING id, first_name, last_name, email, role
        `, [newRole, userId]);

        res.json({ message: "Rol de usuario actualizado exitosamente", result });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error interno del servidor al cambiar el rol" });
    }
})

router.get("/:id_usuario", verifyToken, async (req, res) => {
      // Si viene del token, úsalo directamente
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "Token inválido o usuario no encontrado" });
    }

    const id_usuario = req.params.id_usuario

  try {

    if (isNaN(id_usuario)) {
      return res.status(400).json({ error: "ID de usuario inválido" });
    }

    const usuarioResult = await db.query(
      `SELECT email, first_name, last_name, created_at, updated_at, last_login 
       FROM users 
       WHERE id = $1`,
      [id_usuario]
    );

    const usuario = usuarioResult.rows[0];

    if (!usuario) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    res.json({ data: usuario });

  } catch (err) {
    console.error("Error en GET /usuario:", err);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

module.exports = router;
