const jwt = require('jsonwebtoken');
require('dotenv').config();

function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).send('Acceso denegado. No se proporcionó token.');
    }

    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.user = verified;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).send('Token expirado, necesitas iniciar sesión.');
        }
        res.status(400).send('Token inválido.');
    }
}

function authorizeAdmin(req, res, next) {
    if (!req.user || req.user.rol !== 'admin') {
        return res.status(403).send('Acceso denegado. Se requiere rol de administrador.');
    }
    next();
}

function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.rol)) {
      return res.status(403).send('Acceso denegado. No tienes los permisos necesarios.');
    }
    next();
  };
}

module.exports = {
    verifyToken,
    authorizeAdmin,
    authorizeRoles
};