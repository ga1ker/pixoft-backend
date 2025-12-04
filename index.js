const express = require('express');
const app = express();

const cors = require('cors');
app.use(cors({
  origin: ['http://localhost:3000'],
  credentials: true,
}));

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});