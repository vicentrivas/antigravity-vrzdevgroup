require('dotenv').config();

const authMiddleware = (req, res, next) => {
    // Excluir la validación en rutas particulares si es necesario en el futuro
    // if (req.path === '/alguna-ruta-publica') return next();

    const apiKey = req.headers['x-api-key'];
    const validApiKey = process.env.API_KEY_SECRET;

    if (!validApiKey) {
        console.error("CRITICAL: API_KEY_SECRET no está definida en el archivo .env");
        return res.status(500).json({ error: "Error de configuración de seguridad." });
    }

    if (!apiKey || apiKey !== validApiKey) {
        return res.status(401).json({ error: "No autorizado. Token de API faltante o inválido." });
    }

    next();
};

module.exports = authMiddleware;
