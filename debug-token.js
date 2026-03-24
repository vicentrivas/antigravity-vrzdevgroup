const axios = require('axios');

async function testToken() {
    const baseUrl = 'http://localhost:3000/real/validar-token';

    console.log("--- PRUEBA 1: Sin Header Authorization ---");
    try {
        const res = await axios.get(baseUrl);
        console.log("Respuesta:", res.data);
    } catch (err) {
        console.log("Error esperado:", err.response?.status, err.response?.data);
    }

    console.log("\n--- PRUEBA 2: Con Header vacío o mal formado ---");
    try {
        const res = await axios.get(baseUrl, {
            headers: { 'Authorization': 'Bearer ' }
        });
        console.log("Respuesta:", res.data);
    } catch (err) {
        console.log("Error esperado:", err.response?.status, err.response?.data);
    }

    console.log("\n--- PRUEBA 3: Con Token Simulado (Correcto) ---");
    try {
        const res = await axios.get(baseUrl, {
            headers: { 'Authorization': 'Bearer TOKEN_SIMULADO_PROEBA' }
        });
        console.log("Respuesta Exitosa:", JSON.stringify(res.data, null, 2));
    } catch (err) {
        console.log("Error inesperado:", err.response?.status, err.response?.data);
    }
}

testToken();
