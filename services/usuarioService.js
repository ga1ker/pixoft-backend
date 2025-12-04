const db = require('../db');
const nodemailer = require('nodemailer');
require('dotenv').config();
const { DateTime } = require('luxon');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // usa SSL
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});


async function createUsuario(userData) {
    const { nombre, apellidos, email, contrasena_hash, telefono, rol, activo = true } = userData;

    if (!email || !contrasena_hash || !nombre || !rol) {
        throw new Error("Faltan campos obligatorios para crear el usuario.");
    }

    const emailNormalizado = email.toLowerCase();
    const hoyCDMX = DateTime.now().setZone('America/Mexico_City');
    const hoy = hoyCDMX.toISO();
    console.log("hoy: ", hoy)

    const query = `
        INSERT INTO users (first_name, last_name, email, password_hash, phone, role, is_active, last_login, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, first_name, email, role, created_at, is_active
    `;
    const values = [nombre, apellidos, emailNormalizado, contrasena_hash, telefono, rol, activo, hoy, hoy];
    const { rows } = await db.query(query, values);
    return rows[0];
}

function generateVerificationCode(length = 6) {
    let code = '';
    for (let i = 0; i < length; i++) {
        code += Math.floor(Math.random() * 10);
    }
    return code;
}

async function saveVerificationCode(id_usuario, codigo, tipo, minutos_validez = 15) {
    const hoyCDMX = DateTime.now().setZone('America/Mexico_City');
    const hoy = hoyCDMX.toISO();
    const fecha_expiracion = hoyCDMX.plus({ minutes: minutos_validez }).toISO();

    const query = `
        INSERT INTO codigos_verificacion (id_usuario, codigo, tipo, fecha_expiracion, fecha_creacion)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *;
    `;
    const { rows } = await db.query(query, [id_usuario, codigo, tipo, fecha_expiracion, hoy]);
    return rows[0];
}

async function verifyCode(id_usuario, codigo, tipo) {
    const nowCDMX = DateTime.now().setZone('America/Mexico_City').toISO();

    const query = `
        SELECT *
        FROM codigos_verificacion
        WHERE id_usuario = $1
            AND codigo = $2
            AND tipo = $3
            AND fecha_expiracion > $4
            AND usado = FALSE
        ORDER BY fecha_creacion DESC
        LIMIT 1;
    `;
    const { rows } = await db.query(query, [id_usuario, codigo, tipo, nowCDMX]);

    if (rows.length > 0) {
        await db.query('DELETE FROM codigos_verificacion WHERE id_codigo = $1', [rows[0].id_codigo]);
        return true;
    }
    return false;
}

async function activateUser(id_usuario) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const query = 'UPDATE users SET is_active = TRUE WHERE id = $1 RETURNING id, email';
        const { rows } = await client.query(query, [id_usuario]);
        const activatedUser = rows[0];
        
        await client.query('COMMIT');
        return activatedUser;

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al activar usuario y vincular pedidos:', error);
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    createUsuario,
    verifyCode,
    generateVerificationCode,
    saveVerificationCode,
    activateUser
}