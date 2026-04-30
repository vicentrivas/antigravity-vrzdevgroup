const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'facturacion_db'
};

const pool = mysql.createPool(dbConfig);

// Verificar la conexión al inicio
pool.getConnection()
    .then(connection => {
        console.log(" Intentando conectar a MySQL...");
        console.log(" Configuración de BD: ", dbConfig);
        console.log(" Conexión a MySQL establecida.");
        connection.release();
    })
    .catch(err => {
        console.error(" Error de conexión a MySQL:", err.message);
    });

module.exports = pool;
