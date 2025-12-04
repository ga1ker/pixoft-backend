const express = require("express");
const router = express.Router();
const db = require("../db")
const usuarioService = require('../services/usuarioService');
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
require('dotenv').config();

router.get("/", async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM usuarios");
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error al obtener los usuarios" });
    }
})

router.post("/register", async (req, res) => {
    const { nombre, apellidos, email, password, telefono } = req.body;
    const rol = 'cliente';

    try {
        const contrasena_hash = await bcrypt.hash(password, 10);
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
        await usuarioService.saveVerificationCode(newUser.id_usuario, verificationCode, 'registro', 15);

        const emailSubject = 'Verifica tu cuenta';
        const emailHtml = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Verificación de cuenta</title>
            <style>
            body {
                margin: 0;
                padding: 0;
                font-family: 'Segoe UI', Roboto, sans-serif;
                background-color: #fff8f1;
            }
            .container {
                max-width: 600px;
                margin: auto;
                background-color: #ffffff;
                border-radius: 10px;
                overflow: hidden;
                box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
            }
            .header {
                background-color: #5e99ffff;
                padding: 20px;
                text-align: center;
            }
            .header img {
                max-width: 150px;
                height: auto;
            }
            .content {
                padding: 30px 20px;
                color: #333333;
            }
            h3 {
                color: #006effff;
                font-size: 28px;
                text-align: center;
                margin: 20px 0;
            }
            .footer {
                background-color: #e3ebffff;
                text-align: center;
                padding: 20px;
                font-size: 14px;
                color: #888888ff;
            }
            @media screen and (max-width: 600px) {
                .content {
                padding: 20px 15px;
                }
                h3 {
                font-size: 24px;
                }
            }
            </style>
        </head>
        <body>
            <div class="container">
            <div class="header">
                <img src="https://www.pixsoft.com.mx/LogoPixsfotBlanco.png" alt="Pixoft Logo" />
            </div>
            <div class="content">
                <p>Hola <strong>${nombre}</strong>,</p>
                <p>
                Gracias por registrarte en <strong>Pixsoft</strong>. Para activar tu cuenta, por favor usa el siguiente código de verificación:
                </p>
                <h3>${verificationCode}</h3>
                <p>Este código expirará en 15 minutos.</p>
                <p>
                Si no te registraste en nuestro sitio, por favor ignora este correo.
                </p>
                <p>Saludos cordiales,<br />El equipo de <strong>Pixsoft</strong></p>
            </div>
            <div class="footer">
                © ${new Date().getFullYear()} Pixsoft. Todos los derechos reservados.
            </div>
            </div>
        </body>
        </html>
        `;
        await usuarioService.sendVerificationEmail(email, verificationCode, emailSubject, emailHtml);

        res.status(200).json({
            message: "Usuario registrado. Por favor, verifica tu correo electrónico para activar tu cuenta.",
            userId: newUser.id_usuario,
            success: true
        });

    } catch (err) {
        console.error(err);
        if (err.code === '23505') {
            return res.status(409).json({ message: "El correo electrónico ya está registrado."});
        }
        if (err.code === "23502") {
            return res.status(400).json({ message: "Faltan datos obligatorios."});
        }
        res.status(500).send("Error interno del servidor al registrar usuario.");
    }
});

router.post("/verify-email", async (req, res) => {
    const { userId, code } = req.body;

    if (!userId || !code) {
        return res.status(400).json({ error: 'Faltan ID de usuario o código de verificación.' });
    }

    try {
        const isCodeValid = await usuarioService.verifyCode(userId, code, 'registro');

        if (isCodeValid) {
            await usuarioService.activateUser(userId);

            const token = jwt.sign(
                { id_usuario: userId, rol: 'cliente' },
                process.env.JWT_SECRET,
                { expiresIn: '168h' }
            );

            res.status(200).json({ message: "Cuenta verificada y activada exitosamente.", "token": token, success: true });
        } else {
            res.status(400).json({ error: "Código de verificación inválido o expirado." });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("Error interno del servidor al verificar el correo.");
    }
});