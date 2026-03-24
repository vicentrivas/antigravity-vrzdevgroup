const axios = require('axios');

async function testAutoSend() {
    const url = 'http://localhost:3000/real/enviar-factura-id';
    const payload = {
        idFacturaCuota: 1, // Usamos un ID que probablemente exista o forzamos simulación
        token: 'SIMULADO_TEST_TOKEN'
    };

    try {
        console.log("Enviando petición de prueba a:", url);
        const response = await axios.post(url, payload);
        console.log("Respuesta recibida:");
        console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error("Error en la prueba:", error.response?.data || error.message);
    }
}

testAutoSend();
