const express = require('express');
const cors = require('cors');
const usuariosRoute = require('./routes/usuarios');
const direccionesRoute = require('./routes/direcciones');

const app = express();

app.use(cors({
  origin: ['http://localhost:3000'],
  credentials: true,
}));

app.use(express.json());
app.use('/api/usuarios', usuariosRoute);
app.use('/api/direcciones', direccionesRoute);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
