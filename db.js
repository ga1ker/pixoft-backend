const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  
  // --- CONFIGURACIÓN CLAVE PARA AHORRAR CÓMPUTO ---
  max: 10,                 // Número máximo de clientes en el pool. Mantenlo bajo.
  idleTimeoutMillis: 5000, // 5 segundos de inactividad y la conexión se cierra.
  connectionTimeoutMillis: 10000, // Tiempo para obtener una nueva conexión.
  allowExitOnIdle: true,   // Permite que el proceso de Node.js termine si el pool está inactivo.

  // Recicla la conexión después de 50 usos, Esto evita que una conexión se vuelva "vieja" y consuma cómputo.
  maxUses: 50,
});

// Maneja errores de conexión para evitar que la app se caiga silenciosamente.
pool.on('error', (err, client) => {
  console.error('Error inesperado en el cliente de la base de datos', err);
  process.exit(-1);
});

module.exports = pool;