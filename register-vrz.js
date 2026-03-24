const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

// El código se pasa por argumento: node register-vrz.js <CODIGO>
const authCode = process.argv[2];
if (!authCode) {
    console.error("Error: Debes proporcionar el código de autorización.");
    process.exit(1);
}

// Estructura EXACTA según DOCUMENTACION_API_ECF.md
const data_empresa = {
    "data": {
        "rnc": "133527601",
        "razon_social": "VRZ DEVELOPMENT",
        "nombre_comercial": "VRZ DEVELOPMENT",
        "direccion": "C/Teniente Amado Garcia #158",
        "municipio": "010101",
        "provincia": "010000",
        "telefono": "849-220-0666",
        "email": "contacto@vrzdevgroup.com",
        "p12_pss": "ARD0562216",
        "entorno": "prueba"
    }
};

async function register() {
    console.log(`[BITNOVA-REG] Iniciando registro para VRZ DEVELOPMENT...`);
    console.log(`[AUTH-CODE] ${authCode}`);

    const url = "https://api.bitnovaservices.com/api/v1/empresas";
    const form = new FormData();
    const p12Path = "/Users/vicentrivas/antigravity-vrzdevgroup/13045402_identity.p12";

    if (fs.existsSync(p12Path)) {
        // archivo_p12 es el nombre del campo que espera la API
        form.append('archivo_p12', fs.createReadStream(p12Path), {
            filename: '13045402_identity.p12',
            contentType: 'application/x-pkcs12'
        });
    } else {
        console.error(`Error: Certificado no encontrado en ${p12Path}`);
        process.exit(1);
    }

    // La documentación dice que el JSON debe ir en una sola línea
    form.append('data', JSON.stringify(data_empresa));

    const headers = {
        ...form.getHeaders(),
        "AuthorizationCode": authCode
    };

    try {
        console.log("Enviando a Bitnova...");
        // Intentamos directamente a Bitnova para evitar cualquier delay del bridge local si la prioridad es el tiempo
        const res = await axios.put(url, form, {
            headers: headers,
            timeout: 60000
        });

        console.log("\nREGISTRO EXITOSO:");
        console.log(JSON.stringify(res.data, null, 2));
    } catch (err) {
        console.error("\nERROR EN EL REGISTRO:");
        if (err.response) {
            console.error(JSON.stringify(err.response.data, null, 2));
        } else {
            console.error(err.message);
        }
    }
}

register();
