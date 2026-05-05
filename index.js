require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const mysql = require('mysql2/promise');
const app = express();
const port = process.env.PORT || 3000;

const pool = require('./config/db.js');
const notasController = require('./controllers/notasController.js');
const indexController = require('./controllers/indexController.js');

const upload = multer({ dest: 'uploads/' });

const loggerMiddleware = require('./middlewares/loggerMiddleware');
const authMiddleware = require('./middlewares/authMiddleware');

app.use(express.json());
app.use(express.static('public'));

// Global Middlewares para Logs y Seguridad (API Key)
app.use(loggerMiddleware);
app.use(authMiddleware);







// indexController
app.post("/real/enviar-factura-id", indexController.enviarFacturaId);

// notasController
app.post('/real/notas', notasController.crearNota);
app.post('/real/enviar-nota-id', notasController.enviarNotaId);
app.post('/real/create-send-notas', notasController.crearYEnviarNotaUnificado);

// Inicio del servidor
app.listen(port, () => {
    console.log(`\n Servidor e-CF RD funcionando`);

});
