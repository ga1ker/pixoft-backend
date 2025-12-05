const db = require('../db');
const nodemailer = require('nodemailer');
require('dotenv').config();
const bcrypt = require('bcrypt');

const { DateTime } = require('luxon');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function getUsuarioByEmail(email) {
    const query = 'SELECT id, first_name, last_name, email, password_hash, phone, created_at, role, is_active, last_login FROM users WHERE email = $1';
    const { rows } = await db.query(query, [email]);
    return rows[0] || null;
}

async function getAllUsuarios() {
  const { rows } = await db.query(
    'SELECT id, first_name, last_name, email, phone, role, is_active, created_at FROM users ORDER BY created_at DESC'
  );
  return rows;
}

async function createUsuario(userData) {
  const { nombre, apellidos, email, contrasena_hash, telefono, rol, activo = true } = userData;

  if (!email || !contrasena_hash || !nombre || !rol) {
    throw new Error('Faltan campos obligatorios');
  }

  const emailNormalizado = email.toLowerCase().trim();
  const nowCDMX = DateTime.now().setZone('America/Mexico_City').toISO();

  const query = `
    INSERT INTO users (first_name, last_name, email, password_hash, phone, role, is_active, created_at, last_login)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
    RETURNING id, first_name, email, role, created_at, is_active
  `;
  
  const values = [nombre, apellidos, emailNormalizado, contrasena_hash, telefono || null, rol, activo, nowCDMX];
  const { rows } = await db.query(query, values);
  
  return rows[0];
}

function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function saveVerificationCode(userId, codigo, tipo, minutosValidez = 15) {
  const nowCDMX = DateTime.now().setZone('America/Mexico_City');
  const fechaExpiracion = nowCDMX.plus({ minutes: minutosValidez }).toISO();

  const query = `
    INSERT INTO codigos_verificacion (id_usuario, codigo, tipo, fecha_expiracion, usado)
    VALUES ($1, $2, $3, $4, false)
    RETURNING *
  `;
  
  const values = [userId, codigo, tipo, fechaExpiracion];
  const { rows } = await db.query(query, values);
  return rows[0];
}

async function verifyCode(userId, codigo, tipo) {
  const nowCDMX = DateTime.now().setZone('America/Mexico_City').toISO();

  const query = `
    SELECT id_codigo
    FROM codigos_verificacion 
    WHERE id_usuario = $1 AND codigo = $2 AND tipo = $3 
    AND fecha_expiracion > $4 AND usado = false
    ORDER BY fecha_creacion DESC LIMIT 1
  `;
  
  const { rows } = await db.query(query, [userId, codigo, tipo, nowCDMX]);
  
  if (rows.length > 0) {
    await db.query('UPDATE codigos_verificacion SET usado = true WHERE id_codigo = $1', [rows[0].id_codigo]);
    return true;
  }
  return false;
}

async function activateUser(userId) {
  const query = 'UPDATE users SET is_active = true WHERE id = $1 RETURNING id, email, is_active';
  const { rows } = await db.query(query, [userId]);
  return rows[0];
}

async function sendVerificationEmail(email, codigo, nombre) {
  const mailOptions = {
    from: `"Pixsoft" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Verifica tu cuenta - Pixsoft',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verificación Pixsoft</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #f8f9fa; }
          .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
          .content { padding: 40px 30px; text-align: center; }
          .code { background: #f8f9fa; font-size: 36px; font-weight: bold; color: #333; padding: 20px; border-radius: 8px; letter-spacing: 8px; margin: 30px 0; font-family: monospace; }
          .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #6c757d; font-size: 14px; }
          @media (max-width: 600px) { .content { padding: 30px 20px; } .code { font-size: 28px; } }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 28px;">Bienvenido a Pixsoft</h1>
          </div>
          <div class="content">
            <h2 style="color: #495057;">Hola ${nombre},</h2>
            <p style="font-size: 18px; color: #6c757d; margin: 20px 0;">Tu código de verificación es:</p>
            <div class="code">${codigo}</div>
            <p style="color: #6c757d;">Válido por 15 minutos</p>
          </div>
          <div class="footer">
            © ${new Date().getFullYear()} Pixsoft. Todos los derechos reservados.
          </div>
        </div>
      </body>
      </html>
    `
  };

  await transporter.sendMail(mailOptions);
}

async function sendAdminEmail(email, nombre, subject, content) {
  const mailOptions = {
    from: `"Pixsoft - Administración" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: subject,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #f8f9fa; }
          .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
          .content { padding: 40px 30px; }
          .message { font-size: 16px; line-height: 1.6; color: #495057; }
          .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #6c757d; font-size: 14px; }
          .content-box { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
          @media (max-width: 600px) { 
            .content { padding: 30px 20px; } 
            .container { margin: 20px auto; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 24px;">Pixsoft - Mensaje Importante</h1>
          </div>
          <div class="content">
            <h2 style="color: #495057; margin-bottom: 20px;">Hola ${nombre},</h2>
            <div class="content-box">
              ${content.replace(/\n/g, '<br>')}
            </div>
            <p class="message">
              Este es un mensaje enviado desde el sistema de administración de Pixsoft.
            </p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Pixsoft. Todos los derechos reservados.</p>
            <p style="font-size: 12px; margin-top: 5px;">
              Este email fue enviado a través del panel de administración
            </p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  await transporter.sendMail(mailOptions);
}

async function authenticateUser(email, password) {
    const usuario = await getUsuarioByEmail(email);

    if (!usuario) {
        throw new Error("El usuario no existe");
    }

    if (!usuario.is_active) {
        throw new Error("La cuenta no está activa. Por favor, verifica tu correo.");
    }

    const contrasena_valida = await bcrypt.compare(password, usuario.password_hash);

    if (!contrasena_valida) {
        throw new Error("Contraseña incorrecta");
    }

    await updateLastLogin(usuario.id_usuario);

    const { contrasena_hash, ...usuarioSinHash } = usuario;
    return usuarioSinHash;
}

async function updateLastLogin(id_usuario) {
    const hoyCDMX = DateTime.now().setZone('America/Mexico_City');
    const hoy = hoyCDMX.toISO();
    const query = `UPDATE users SET last_login = $1 WHERE id = $2`;
    await db.query(query, [hoy, id_usuario]);
}

module.exports = {
  getAllUsuarios,
  createUsuario,
  generateVerificationCode,
  saveVerificationCode,
  verifyCode,
  activateUser,
  sendVerificationEmail,
  sendAdminEmail,
  authenticateUser,
  updateLastLogin
};
