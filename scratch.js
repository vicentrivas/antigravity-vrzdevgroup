require('dotenv').config();
const mysql = require('mysql2/promise');
async function run() {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });
    const [rows] = await conn.query('DESCRIBE notadebitocredito');
    console.log(JSON.stringify(rows, null, 2));
    await conn.end();
}
run().catch(console.error);
