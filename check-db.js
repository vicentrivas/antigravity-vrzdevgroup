require('dotenv').config();
const mysql = require('mysql2/promise');

async function findColumn() {
    const dbConfig = {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'etrack'
    };
    const pool = mysql.createPool(dbConfig);
    try {
        const [rows] = await pool.query(`
            SELECT TABLE_NAME, COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = 'etrack' 
            AND (COLUMN_NAME LIKE '%rnc%' OR COLUMN_NAME LIKE '%cedula%' OR COLUMN_NAME LIKE '%identificacion%')
        `);
        console.log("MATCHES:", rows);
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
findColumn();
