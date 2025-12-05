const express = require('express');
const cors = require('cors');
const usuariosRoute = require('./routes/usuarios');
const productosRoute = require('./routes/productos');
const ventasRoute = require('./routes/ventas');
const categoriasRoute = require('./routes/categorias');
const marcasRoute = require('./routes/marcas');
const direccionesRoute = require('./routes/direcciones');
const carritoRoute = require('./routes/carrito');
const opinionesRoute = require('./routes/opiniones');
const venta_detallesRoute = require('./routes/venta_detalles');
const agenteRoute = require('./routes/agente');

const app = express();

app.use(cors({
  origin: ['http://localhost:3000'],
  credentials: true,
}));

app.use(express.json());
app.use('/api/usuarios', usuariosRoute);
app.use('/api/productos', productosRoute);
app.use('/api/ventas', ventasRoute);
app.use('/api/categorias', categoriasRoute);
app.use('/api/marcas', marcasRoute);
app.use('/api/carrito', carritoRoute);
app.use('/api/opiniones', opinionesRoute);
app.use('/api/direcciones', direccionesRoute);
app.use('/api/venta_detalles', venta_detallesRoute);
app.use('/api/agente', agenteRoute);
app.use('/api/pedidos', pedidosRouter);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
