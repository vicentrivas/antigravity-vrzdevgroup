const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'facturacion_db'
};

async function setupDB() {
    try {
        const pool = mysql.createPool(dbConfig);
        console.log("Creando tabla api_logs...");
        await pool.query(`
            CREATE TABLE IF NOT EXISTS api_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
                metodo VARCHAR(10),
                endpoint VARCHAR(255),
                ip_origen VARCHAR(45),
                headers JSON,
                request_body JSON,
                response_status INT,
                response_body JSON,
                error_message TEXT
            );
        `);
        console.log("Tabla api_logs creada o ya existía.");
        process.exit(0);
    } catch (error) {
        console.error("Error creando tabla:", error);
        process.exit(1);
    }
}

setupDB();
