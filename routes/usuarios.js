const express = require('express');
const router = express.Router();
const usuarioService = require('../services/usuarioService');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
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
        { id: userId, rol: 'cliente' },
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

module.exports = router;
