const mercadopago = require('mercadopago');

// Configurar MercadoPago
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN,
  sandbox: process.env.NODE_ENV !== 'production' // true para testing
});

module.exports = { mercadopago };