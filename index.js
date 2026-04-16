require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const mysql = require('mysql2/promise');
const app = express();
const port = process.env.PORT || 3000;

// Configuración de MySQL (Pool de conexiones) movida a config/db.js
const pool = require('./config/db.js');
const notasController = require('./controllers/notasController.js');

// Configuración de Multer para manejar la subida del archivo .p12
const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.static('public'));


/**
 * @route POST /real/registrar-empresa
 * @desc Envía el certificado y datos a Bitnova para obtener el Bearer Token
 */
app.put('/real/registrar-empresa', upload.single('archivo_p12'), async (req, res) => {
    try {
        const { data } = req.body;
        const file = req.file;
        const parsedData = JSON.parse(data);
        const authCode = req.headers['authorizationcode'] || parsedData.data.authorizationcode || process.env.BITNOVA_AUTH_CODE;
        const bitnovaUrl = "https://api.bitnovaservices.com/api/v1/empresas";




        if (!data) {
            return res.status(400).json({ error: "Faltan datos de la empresa." });
        }

        const form = new FormData();

        // Manejo del archivo .p12: Subida VS Ruta de Servidor
        if (file) {
            form.append('archivo_p12', fs.createReadStream(file.path), file.originalname);
        } else if (parsedData.data.archivo_p12_path) {
            if (fs.existsSync(parsedData.data.archivo_p12_path)) {
                form.append('archivo_p12', fs.createReadStream(parsedData.data.archivo_p12_path));
            } else {
                return res.status(400).json({ error: `Certificado no encontrado en: ${parsedData.data.archivo_p12_path}` });
            }
        }


        const cleanPayload = {
            data: { ...parsedData.data }
        };
        delete cleanPayload.data.archivo_p12_path;
        delete cleanPayload.data.authorizationcode;


        if (parsedData.data.mail && !cleanPayload.data.email) {
            cleanPayload.data.email = parsedData.data.mail;
        }
        form.append('data', JSON.stringify(cleanPayload));

        console.log(` Enviando registro a: ${bitnovaUrl}`);
        console.log(`[PAYLOAD]`, JSON.stringify(cleanPayload, null, 2));

        const response = await axios.put(bitnovaUrl, form, {
            headers: {
                ...form.getHeaders(),
                'AuthorizationCode': authCode
            },
            timeout: 60000
        });

        if (file) fs.unlinkSync(file.path);

        console.log("Respuesta de Bitnova recibida:", JSON.stringify(response.data, null, 2));

        const newToken = response.data.Authorization;
        if (newToken && pool) {
            const rnc = parsedData.data.rnc;
            await pool.query('UPDATE empresas SET authorizationcode = ? WHERE rnc = ?', [newToken, rnc]);
            console.log(`[DB] Token de acceso (Bearer) guardado para RNC: ${rnc}`);
        }
        // ------------------------------

        res.json(response.data);

    } catch (error) {
        console.error("Error en registro:", error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: "Error interno al conectar con Bitnova" });
    }
});

// --- ENDPOINT REAL: VALIDAR TOKEN EN BITNOVA ---

/**
 * @route GET /real/validar-token
 * @desc Valida que el token sea correcto y devuelve info de la empresa
 */
app.get('/real/validar-token', async (req, res) => {
    try {
        const token = req.headers['authorization']?.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: "No se proporcionó un token." });
        }

        const bitnovaUrl = "https://api.bitnovaservices.com/a/api/v1/users";
        const response = await axios.get(bitnovaUrl, {
            headers: {
                'Authorization': `${token}`,
                'Content-Type': 'application/json',
                'token': token // Bitnova pide el token en este header también
            },
            timeout: 10000
        });

        res.json(response.data);

    } catch (error) {
        console.error("Error validando token:", error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: "Error al validar token con Bitnova" });
    }
});

/**
 * @route POST /real/enviar-factura-id
 * @desc Genera el JSON e-CF automáticamente desde el ID de la factura y la envía
 */
app.post('/real/cargar-venta-by-idfacturacuota', async (req, res) => {
    const { idFacturaCuota, token: providedToken } = req.body;
    if (!pool) return res.status(503).json({ error: "DB no disponible" });
    if (!idFacturaCuota) return res.status(400).json({ error: "Falta idFacturaCuota" });

    try {
        // 1. Consultar todos los datos necesarios (Factura + Cuota + Cliente + Empresa)
        const [rows] = await pool.query(`
            SELECT 
                f.idfactura, fc.idfacturacuotas, fc.ncf, fc.montobruto as cuota_bruto, fc.itbis as cuota_itbis, fc.total as cuota_total, fc.referenciafactura,
                DATE_FORMAT(f.fecha,'%d-%m-%Y') fecha, f.idempresas,
                p.nombres, p.apellidos, p.identificacion as cliente_identificacion, p.correoelectronico,
                e.empresa as emisor_nombre, e.rnc as emisor_rnc, e.authorizationcode as emisor_token
            FROM facturacuotas fc
            JOIN factura f ON fc.idfactura = f.idfactura
            LEFT JOIN eskinpersonal p ON f.idcliente = p.idpersonal
            JOIN empresas e ON f.idempresas = e.idempresas
            WHERE fc.idfacturacuotas = ?
        `, [idFacturaCuota]);

        if (rows.length === 0) return res.status(404).json({ error: "No se encontró la cuota de factura" });

        const v = rows[0];
        const token = (providedToken || v.emisor_token || "").trim();

        const isRNC = v.cliente_identificacion.length === 9;

        // Determinación de tipo ECF y prefijo NCF esto mas adelante debe ser dinamico desde la db
        let ncfOriginal = v.ncf || "";
        let tipoEcf = isRNC ? "31" : "32";
        let ncfEcf = (isRNC ? "E31" : "E32") + "0000000001"; // Default si no hay NCF previo

        if (ncfOriginal.startsWith('B')) {
            const sequence = ncfOriginal.substring(3);
            ncfEcf = (isRNC ? "E31" : "E32") + sequence.padStart(10, '0');
        } else if (ncfOriginal.startsWith('E')) {
            ncfEcf = ncfOriginal;
            tipoEcf = ncfOriginal.substring(1, 3);
        }



        // const fechaHoy = new Date().toISOString().split('T')[0];
        // const fechaEmision = v.fecha
        //     ? new Date(v.fecha).toISOString().split('T')[0]
        //     : fechaHoy;


        const eCF = {
            iddoc: {
                tipoecf: tipoEcf,
                encf: ncfEcf,
                tipoingresos: "01",
                tipopago: (v.formapago || 1).toString(),
                indicadormontogravado: v.cuota_itbis > 0 ? "1" : "0"
            },
            datos_adicionales: {
                fechaemision: v.fecha,
                numerofacturainterna: (v.idfacturacuotas || "").toString(),
                numeropedidointerno: (v.referenciafactura || "").toString(),
                zonaventa: "GENERAL",
                codigovendedor: "001"
            },
            comprador: {
                rnccomprador: v.cliente_identificacion,
                razonsocialcomprador: `${v.nombres || ''} ${v.apellidos || ''}`.trim() || "CONSUMIDOR FINAL",
                correocomprador: (v.correoelectronico && v.correoelectronico.includes('@')) ? v.correoelectronico.trim().toUpperCase() : "VICENTRIVASZORRILLA@GMAIL.COM",
                direccioncomprador: (v.direccion || "SANTO DOMINGO, RD").replace(/[\.,]/g, ''),
                municipiocomprador: "010100",
                provinciacomprador: "010000",
                fechaordencompra: "", // Campos adicionales del nuevo formato
                numeroordencompra: "",
                codigointernocomprador: "",
                contactocomprador: `${v.nombres || ''} ${v.apellidos || ''}`.trim(),
                fechaentrega: ""
            },
            totales: {
                montogravadototal: (parseFloat(v.cuota_bruto) || 0).toFixed(2),
                montogravadoi1: (parseFloat(v.cuota_bruto) || 0).toFixed(2),
                totalitbis1: (parseFloat(v.cuota_itbis) || 0).toFixed(2),
                montototal: (parseFloat(v.cuota_total) || 0).toFixed(2),
                itbis1: v.cuota_itbis > 0 ? "18" : "0",
                totalitbis: (parseFloat(v.cuota_itbis) || 0).toFixed(2)
            },
            items: {
                "1": {
                    NombreItem: `SERVICIO / PRODUCTO (${v.referenciafactura || ncfEcf})`,
                    NumeroLinea: "1",
                    IndicadorFacturacion: "1",
                    CantidadItem: "1.00",
                    UnidadMedida: "31", // Ejemplo del usuario usa "31"
                    PrecioUnitarioItem: (parseFloat(v.cuota_bruto) || 0).toFixed(2),
                    MontoItem: (parseFloat(v.cuota_bruto) || 0).toFixed(2),
                    IndicadorBienOServicio: "1"
                }
            }
        };

        // Regla: Si la factura es menor a 250,000, quitar rnccomprador, contactocomprador, correocomprador, direccioncomprador, municipiocomprador, provinciacomprador
        if (parseFloat(eCF.totales.montototal) < 250000) {
            delete eCF.comprador.rnccomprador;
            delete eCF.comprador.contactocomprador;
            delete eCF.comprador.correocomprador;
            delete eCF.comprador.direccioncomprador;
            delete eCF.comprador.municipiocomprador;
            delete eCF.comprador.provinciacomprador;
        }

        // --- IMPRESIÓN SOLICITADA ---
        console.log(" Registro Actividad:");
        console.log(JSON.stringify({
            evento: "Generación de e-NCF",
            ncf: eCF.iddoc.encf,
            receptor: eCF.comprador.razonsocialcomprador,
            monto: eCF.totales.montototal,
            timestamp: new Date()
        }, null, 2));
        console.log("==========================================\n");

        // 3. Enviar a Bitnova
        console.log(` Enviando a Bitnova para ID ${idFacturaCuota}...`);

        const bitnovaUrl = "https://api.bitnovaservices.com/api/v1/dgii";
        let resultData;
        let httpStatus = 200;

        const headers = {
            'Authorization': `${token}`,
            'Content-Type': 'application/json'
        };

        console.log("[HTTP REQUEST] POST", bitnovaUrl);
        console.log("[HTTP REQUEST] Headers:", JSON.stringify(headers, null, 2));


        try {
            const response = await axios.post(bitnovaUrl, eCF, {
                headers: headers,
                timeout: 60000
            });
            resultData = { ...response.data, json_enviado: eCF };
        } catch (axiosError) {
            console.error(" Error enviando a Bitnova:", axiosError.response?.data || axiosError.message);
            httpStatus = axiosError.response?.status || 500;
            resultData = {
                ...(axiosError.response?.data || {}),
                error_local: axiosError.message,
                estado: axiosError.response?.data?.estado || "Rechazado LOCAL MENSAJE",
                json_enviado: eCF
            };
        }


        res.status(httpStatus).json(resultData);

    } catch (error) {
        console.error("Error en envío automático:", error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: "Error en proceso automático" });
    }
});


app.post('/real/enviar-factura-id', async (req, res) => {
    const { idFacturaCuota, token: providedToken } = req.body;
    if (!pool) return res.status(503).json({ error: "DB no disponible" });
    if (!idFacturaCuota) return res.status(400).json({ error: "Falta idFacturaCuota" });

    try {
        const [rows] = await pool.query(`call loadDatosFacturaCuotasDgii(?)`,
            [idFacturaCuota]);
        if (rows.length === 0) return res.status(404).json({ error: "No se encontró la cuota de factura" });
        const v = rows[0][0];
        const token = (providedToken || v.emisor_token || "").trim();
        const isRNC = v.cliente_identificacion && v.cliente_identificacion.length === 9;
        let ncfOriginal = v.ncf || "";
        let tipoEcf = isRNC ? "31" : "32";
        if (ncfOriginal.startsWith('E')) {

            tipoEcf = ncfOriginal.substring(1, 3);
        }

        const fechaEmision = v.fecha;
        const eCF = {
            iddoc: {
                tipoecf: tipoEcf,
                encf: v.ncf,
                fechavencimientosecuencia: "31-12-2028",
                indicadormontogravado: "0",
                tipoingresos: "01",
                tipopago: (v.formapago || 1).toString()
            },

            comprador: {
                rnccomprador: v.cliente_identificacion,
                razonsocialcomprador: v.nombres + " " + v.apellidos,
            },
            totales: {
                montototal: (parseFloat(v.cuota_total) || 0).toFixed(2),

                montogravadototal: (parseFloat(v.cuota_bruto) || 0).toFixed(2),
                montogravadoi1: (parseFloat(v.cuota_bruto) || 0).toFixed(2),
                itbis1: v.cuota_itbis > 0 ? "18" : "0",

                totalitbis1: (parseFloat(v.cuota_itbis) || 0).toFixed(2),
                totalitbis: (parseFloat(v.cuota_itbis) || 0).toFixed(2)
            },
            datos_adicionales: {
                fechaemision: fechaEmision,
                enviaraprobacion: false

            },

            items: {
                "1": {
                    NombreItem: `SERVICIO / PRODUCTO (${v.referenciafactura || ncfOriginal})`,
                    NumeroLinea: "1",
                    IndicadorFacturacion: "1",
                    CantidadItem: "1",
                    PrecioUnitarioItem: (parseFloat(v.cuota_total) || 0).toFixed(2),
                    MontoItem: (parseFloat(v.cuota_bruto) || 0).toFixed(2),
                    IndicadorBienOServicio: "1"
                }
            }
        };
        // Regla: Si la factura es menor a 250,000, quitar rnccomprador, contactocomprador, correocomprador, direccioncomprador, municipiocomprador, provinciacomprador
        if (ncfOriginal.substring(1, 3) == "32") {
            delete eCF.iddoc.fechavencimientosecuencia;

            if (parseFloat(eCF.totales.montototal) < 250000) {
                delete eCF.comprador.rnccomprador;
                delete eCF.comprador.contactocomprador;
                delete eCF.comprador.correocomprador;
                delete eCF.comprador.direccioncomprador;
                delete eCF.comprador.municipiocomprador;
                delete eCF.comprador.provinciacomprador;
            }
            if (eCF.iddoc.indicadormontogravado !== undefined) {
                delete eCF.iddoc.indicadormontogravado;
            }
        }
        // if (ncfOriginal.substring(1, 3) == "31") {
        //     delete eCF.iddoc.indicadormontogravado;
        //     delete eCF.iddoc.tipoingresos;
        //     delete eCF.iddoc.tipopago
        // }



        // 3. Enviar a Bitnova
        console.log(` Enviando a Bitnova para ID ${idFacturaCuota}...`);

        const bitnovaUrl = "https://api.bitnovaservices.com/api/v1/dgii";
        let resultData;
        let NCFF;
        let httpStatus = 200;

        const headers = {
            'Authorization': `${token}`,
            'Content-Type': 'application/json'
        };

        console.log("[HTTP REQUEST] POST", bitnovaUrl);
        console.log("[HTTP REQUEST] Headers:", JSON.stringify(headers, null, 2));


        try {
            const response = await axios.post(bitnovaUrl, eCF, {
                headers: headers,
                timeout: 60000
            });
            resultData = { ...response.data, json_enviado: eCF };
        } catch (axiosError) {
            console.error(" Error enviando a Bitnova:", axiosError.response?.data || axiosError.message);
            httpStatus = axiosError.response?.status || 500;
            resultData = {
                ...(axiosError.response?.data || {}),
                error_local: axiosError.message,
                estado: axiosError.response?.data?.estado || "Rechazado LOCAL MENSAJE",
                json_enviado: eCF
            };
        }


        // --- Inserción en tabla facturacuotaalmenacimientodgii ---
        try {
            const r = resultData.facturaAceptada || resultData.data || resultData; // Soporte por si Bitnova lo anida
            const msgs = typeof r.mensajes === 'object' ? JSON.stringify(r.mensajes) : r.mensajes;
            await pool.query(`
                INSERT INTO movimientofacturacfalmacenamientodgii (
                    idfactura, idfacturacuotas,idnotadebitocredito, AlmacenamientoSesionEnCache, CodigoSeguridad, Customer, 
                    FechaHoraFirma, TIPO_ECF, TotalITBIS, Total_amount, codigo, encf, estado, 
                    fechaRecepcion, mensajes, secuenciaUtilizada, trackId, url, xml, json
                ) VALUES (?, ?,?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? , ?, ?, ?, ?, ?, ?)
            `, [
                v.idfactura, v.idfacturacuotas, null,
                r.AlmacenamientoSesionEnCache ? 1 : 0, r.CodigoSeguridad || null, r.Customer || null,
                r.FechaHoraFirma || null, r.TIPO_ECF || null, r.TotalITBIS || null, r.Total_amount || null, r.codigo || null,
                r.encf || null, r.estado || null, r.fechaRecepcion || null, msgs || "",
                r.secuenciaUtilizada ? 1 : 0, r.trackId || null, r.url || null, r.xml || null,
                JSON.stringify(resultData)
            ]);
            console.log(" Respuesta DGII guardada exitosamente en movimientofacturacfalmenacimientodgii.");
        } catch (dbErr) {
            console.error(" Fallo al guardar respuesta DGII en movimientofacturacfalmenacimientodgii:", dbErr.message);
        }
        // ---------------------------------------------------------

        res.status(httpStatus).json(resultData);

    } catch (error) {
        console.error("Error en envío automático:", error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: "Error en proceso automático" });
    }
});


// app.post('/real/enviar-nota-id', async (req, res) => {
//     const { idNotaDebitoCredito, token: providedToken } = req.body;
//     if (!pool) return res.status(503).json({ error: "DB no disponible" });
//     if (!idNotaDebitoCredito) return res.status(400).json({ error: "Falta idNotaDebitoCredito" });
//     try {
//         const [rows] = await pool.query(`CALL loadDatosNotasDebCredDgii(?)`, [idNotaDebitoCredito]);

//         if (rows.length === 0) {
//             return res.status(404).json({ error: "Nota no encontrada" });
//         }

//         const v = rows[0][0];

//         const token = (providedToken || v.emisor_token || "").trim();

//         const tipoEcf = v.cf.substring(1, 3); // 33 o 34

//         const eCF = {
//             //     iddoc: {
//             //         tipoecf: tipoEcf,
//             //         encf: v.cf,
//             //         tipoingresos: "01",
//             //         tipopago: "1"
//             //     },
//             //     comprador: {
//             //         rnccomprador: "40230670115",
//             //         razonsocialcomprador: v.nombres + " " + v.apellidos
//             //     },
//             //     totales: {
//             //         montototal: (parseFloat(v.valortotal) || 0).toFixed(2),
//             //         montoexento: (parseFloat(v.valortotal) || 0).toFixed(2)
//             //     },
//             //     datos_adicionales: {
//             //         fechaemision: v.fecha,
//             //         enviaraprobacion: false
//             //     },
//             //     items: {
//             //         "1": {
//             //             NombreItem: v.concepto || "NOTA",
//             //             NumeroLinea: "1",
//             //             IndicadorFacturacion: "4",
//             //             CantidadItem: "1",
//             //             PrecioUnitarioItem: (parseFloat(v.valortotal) || 0).toFixed(2),
//             //             MontoItem: (parseFloat(v.valortotal) || 0).toFixed(2),
//             //             IndicadorBienOServicio: "1"
//             //         }
//             //     },
//             //     informacion_referencia: {
//             //         "1": {
//             //             NCFModificado: v.cfmodificado,
//             //             FechaNCFModificado: v.fechacfmodificado,
//             //             CodigoModificacion: "3"
//             //         }
//             //     }
//             // };
//             // if (tipoEcf === "34") {
//             //     // Nota de crédito
//             //     eCF.iddoc.IndicadorNotaCredito = "4";
//             //     eCF.opciones_adicionales = { INCLUIR_EMISOR: true };

//             //     eCF.informacion_referencia["1"].RazonModificacion = "Error en monto";

//             // } else if (tipoEcf === "33") {
//             //     // Nota de débito
//             //     eCF.iddoc.fechavencimientosecuencia = "31-12-2028";
//             // }

//             "iddoc": {
//                 "tipoecf": "34",
//                 "encf": "E340000009003",
//                 "IndicadorNotaCredito": "0",
//                 "indicadormontogravado": "0",
//                 "tipoingresos": "01",
//                 "tipopago": "1"
//             },
//             "comprador": {
//                 "rnccomprador": "131880681",
//                 "razonsocialcomprador": "DOCUMENTOS ELECTRONICOS DE 03",
//                 "contactocomprador": "MARCOS LATIPLOL",
//                 "direccioncomprador": "CALLE JACINTO DE LA CONCHA FELIZ ESQUINA 27 DE FEBRERO,FRENTE A DOMINO",
//                 "municipiocomprador": "010100",
//                 "provinciacomprador": "010000",
//                 "fechaentrega": "10-10-2020",
//                 "fechaordencompra": "10-11-2018",
//                 "numeroordencompra": "4500352238",
//                 "codigointernocomprador": "10633440",
//                 "correocomprador": "MARCOSLATIPLOL@KKKK.COM"
//             },
//             "totales": {
//                 "montogravadototal": "480250.00",
//                 "montogravadoi1": "480250.00",
//                 "itbis1": "18",
//                 "totalitbis": "86445.00",
//                 "totalitbis1": "86445.00",
//                 "montototal": "566695.00"
//             },
//             "datos_adicionales": {
//                 "fechaemision": "02-04-2020",
//                 "municipioemisor": "010100",
//                 "provinciaemisor": "010000",
//                 "INCLUIR_EMISOR": false,
//                 "direccionemisor": "AVE. ISABEL AGUIAR NO. 269, ZONA INDUSTRIAL DE HERRERA",
//                 "numerofacturainterna": "123456789016",
//                 "numeropedidointerno": "123456789016",
//                 "zonaventa": "NORTE",
//                 "codigovendedor": "AA0000000100000000010000000002000000000300000000050000000006"
//             },
//             "opciones_adicionales": {
//                 "INCLUIR_EMISOR": true
//             },
//             "items": {
//                 "1": {
//                     "NombreItem": "BLOCK",
//                     "NumeroLinea": "1",
//                     "IndicadorFacturacion": "1",
//                     "CantidadItem": "100.00",
//                     "UnidadMedida": "23",
//                     "PrecioUnitarioItem": "450.0000",
//                     "DescuentoMonto": "200.00",
//                     "MontoItem": "45150.00",
//                     "IndicadorBienOServicio": "1",
//                     "TablaSubDescuento": [
//                         {
//                             "TipoSubDescuento": "$",
//                             "MontoSubDescuento": "200.00"
//                         }
//                     ],
//                     "RecargoMonto": "350.00",
//                     "SubRecargo": [
//                         {
//                             "TipoSubRecargo": "$",
//                             "MontoSubRecargo": "350.00"
//                         }
//                     ]
//                 }
//             },
//             "informacion_referencia": {
//                 "1": {
//                     "TipoDocumentoReferencia": "01",
//                     "NCFModificado": "E310000007003",
//                     "FechaNCFModificado": "15-04-2026",
//                     "CodigoModificacion": "3",
//                     "RazonModificacion": "Error en monto"
//                 }
//             }
//         }

//         const bitnovaUrl = "https://api.bitnovaservices.com/api/v1/dgii";

//         let resultData;
//         let httpStatus = 200;
//         console.log("JSON ENVIADO:", JSON.stringify(eCF, null, 2));
//         try {
//             const response = await axios.post(bitnovaUrl, eCF, {
//                 headers: {
//                     Authorization: token,
//                     "Content-Type": "application/json"
//                 },
//                 timeout: 60000
//             });

//             resultData = { ...response.data, json_enviado: eCF };

//         } catch (axiosError) {
//             httpStatus = axiosError.response?.status || 500;

//             resultData = {
//                 ...(axiosError.response?.data || {}),
//                 error_local: axiosError.message,
//                 json_enviado: eCF
//             };
//         }

//         try {
//             const r = resultData.facturaAceptada || resultData.data || resultData; // Soporte por si Bitnova lo anida
//             const msgs = typeof r.mensajes === 'object' ? JSON.stringify(r.mensajes) : r.mensajes;
//             await pool.query(`
//                 INSERT INTO movimientofacturacfalmacenamientodgii (
//                     idfactura, idfacturacuotas,idnotadebitocredito, AlmacenamientoSesionEnCache, CodigoSeguridad, Customer, 
//                     FechaHoraFirma, TIPO_ECF, TotalITBIS, Total_amount, codigo, encf, estado, 
//                     fechaRecepcion, mensajes, secuenciaUtilizada, trackId, url, xml, json
//                 ) VALUES (?, ?,?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? , ?, ?, ?, ?, ?, ?)
//             `, [
//                 v.idfactura, v.idfacturacuotas, idNotaDebitoCredito,
//                 r.AlmacenamientoSesionEnCache ? 1 : 0, r.CodigoSeguridad || null, r.Customer || null,
//                 r.FechaHoraFirma || null, r.TIPO_ECF || null, r.TotalITBIS || null, r.Total_amount || null, r.codigo || null,
//                 r.cf || null, r.estado || null, r.fechaRecepcion || null, msgs || "",
//                 r.secuenciaUtilizada ? 1 : 0, r.trackId || null, r.url || null, r.xml || null,
//                 JSON.stringify(resultData)
//             ]);
//             console.log(" Respuesta DGII guardada exitosamente en movimientofacturacfalmenacimientodgii.");
//         } catch (dbErr) {
//             console.error(" Fallo al guardar respuesta DGII en movimientofacturacfalmenacimientodgii:", dbErr.message);
//         }

//         res.status(httpStatus).json(resultData);

//     } catch (error) {
//         console.error("Error:", error.message);
//         res.status(500).json({ error: "Error en proceso" });
//     }
// });


app.post('/real/enviar-nota-id', async (req, res) => {
    const { idNotaDebitoCredito, token: providedToken } = req.body;

    if (!pool) return res.status(503).json({ error: "DB no disponible" });
    if (!idNotaDebitoCredito) return res.status(400).json({ error: "Falta idNotaDebitoCredito" });

    try {
        const [rows] = await pool.query(`CALL loadDatosNotasDebCredDgii(?)`, [idNotaDebitoCredito]);

        if (!rows || !rows[0] || rows[0].length === 0) {
            return res.status(404).json({ error: "Nota no encontrada" });
        }

        const v = rows[0][0];
        const token = (providedToken || v.emisor_token || "").trim();
        const tipoEcf = v.cf.substring(1, 3); // 33 o 34

        // 🔥 Construcción dinámica
        const eCF = {
            iddoc: {
                tipoecf: tipoEcf,
                encf: v.cf,
                tipoingresos: "01",
                tipopago: "1"
            },
            comprador: {
                rnccomprador: v.rnc || "40230670115",
                razonsocialcomprador: `${v.nombres || ""} ${v.apellidos || ""}`.trim()
            },
            totales: {
                montototal: (parseFloat(v.valortotal) || 0).toFixed(2),
                montoexento: (parseFloat(v.valortotal) || 0).toFixed(2)
            },
            datos_adicionales: {
                fechaemision: v.fecha,
                enviaraprobacion: false
            },
            items: {
                "1": {
                    NombreItem: v.concepto || "NOTA",
                    NumeroLinea: "1",
                    IndicadorFacturacion: "4",
                    CantidadItem: "1",
                    PrecioUnitarioItem: (parseFloat(v.valortotal) || 0).toFixed(2),
                    MontoItem: (parseFloat(v.valortotal) || 0).toFixed(2),
                    IndicadorBienOServicio: "1"
                }
            },
            informacion_referencia: {
                "1": {
                    NCFModificado: v.cfmodificado,
                    FechaNCFModificado: v.fechacfmodificado,
                    CodigoModificacion: "3"
                }
            }
        };

        // 🔥 Lógica por tipo
        if (tipoEcf === "34") {
            // Nota de Crédito
            eCF.iddoc.IndicadorNotaCredito = "2"; // Ajuste de monto
            eCF.informacion_referencia["1"].RazonModificacion = "Error en monto";

            eCF.opciones_adicionales = {
                INCLUIR_EMISOR: true
            };

        } else if (tipoEcf === "33") {
            // Nota de Débito
            // eCF.iddoc.fechavencimientosecuencia = "31-12-2028";
        }

        // 🧹 Limpiar nulls
        const limpiar = (obj) => {
            Object.keys(obj).forEach(key => {
                if (obj[key] === null || obj[key] === undefined || obj[key] === "") {
                    delete obj[key];
                } else if (typeof obj[key] === "object" && !Array.isArray(obj[key])) {
                    limpiar(obj[key]);
                }
            });
        };
        limpiar(eCF);

        console.log("======= DEBUG ECF =======");
        console.log("ID:", idNotaDebitoCredito);
        console.log("Tipo:", tipoEcf);
        console.log("eNCF:", eCF.iddoc.encf);
        console.log("Indicador:", eCF.iddoc.IndicadorNotaCredito);
        console.log(JSON.stringify(eCF, null, 2));
        console.log("=========================");

        const bitnovaUrl = "https://api.bitnovaservices.com/api/v1/dgii";

        let resultData;
        let httpStatus = 200;

        try {
            const response = await axios.post(bitnovaUrl, eCF, {
                headers: {
                    Authorization: token,
                    "Content-Type": "application/json"
                },
                timeout: 60000
            });

            resultData = { ...response.data, json_enviado: eCF };

        } catch (axiosError) {
            httpStatus = axiosError.response?.status || 500;

            resultData = {
                ...(axiosError.response?.data || {}),
                error_local: axiosError.message,
                json_enviado: eCF
            };
        }

        // 💾 Guardar respuesta
        try {
            const r = resultData.facturaAceptada || resultData.data || resultData;
            const msgs = typeof r.mensajes === 'object' ? JSON.stringify(r.mensajes) : r.mensajes;

            await pool.query(`
                INSERT INTO movimientofacturacfalmacenamientodgii (
                    idfactura, idfacturacuotas, idnotadebitocredito,
                    AlmacenamientoSesionEnCache, CodigoSeguridad, Customer,
                    FechaHoraFirma, TIPO_ECF, TotalITBIS, Total_amount,
                    codigo, encf, estado, fechaRecepcion, mensajes,
                    secuenciaUtilizada, trackId, url, xml, json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                v.idfactura,
                v.idfacturacuotas,
                idNotaDebitoCredito,
                r.AlmacenamientoSesionEnCache ? 1 : 0,
                r.CodigoSeguridad || null,
                r.Customer || null,
                r.FechaHoraFirma || null,
                r.TIPO_ECF || null,
                r.TotalITBIS || null,
                r.Total_amount || null,
                r.codigo || null,
                r.cf || null,
                r.estado || null,
                r.fechaRecepcion || null,
                msgs || "",
                r.secuenciaUtilizada ? 1 : 0,
                r.trackId || null,
                r.url || null,
                r.xml || null,
                JSON.stringify(resultData)
            ]);

            console.log("✅ Respuesta DGII guardada correctamente");

        } catch (dbErr) {
            console.error("❌ Error guardando en BD:", dbErr.message);
        }

        res.status(httpStatus).json(resultData);

    } catch (error) {
        console.error("❌ Error general:", error.message);
        res.status(500).json({ error: "Error en proceso" });
    }
});

/**
 * @route POST /real/enviar-factura
 * @desc Envía el JSON de la factura a Bitnova usando el Bearer Token
 */
app.post('/real/enviar-factura', async (req, res) => {

    try {
        const { token: rawToken, data } = req.body;
        let token = (rawToken || "").trim();
        if (!token || !data) {
            return res.status(400).json({ error: "Faltan el token o los datos de la factura." });
        }

        const bitnovaUrl = "https://api.bitnovaservices.com/api/v1/dgii";
        let resultData;
        let httpStatus = 200;

        const headers = {
            'Authorization': `${token}`,
            'Content-Type': 'application/json'
        };


        try {
            // El body enviado a Bitnova es directamente el JSON de la factura (datos_factura)
            const response = await axios.post(bitnovaUrl, data, {
                headers: headers,
                timeout: 60000
            });
            resultData = { ...response.data };
        } catch (axiosError) {
            console.error(" Error enviando factura a Bitnova:", axiosError.response?.data || axiosError.message);
            httpStatus = axiosError.response?.status || 500;
            resultData = {
                ...(axiosError.response?.data || {}),
                error_local: axiosError.message,
                estado: axiosError.response?.data?.estado || "Rechazado"
            };
        }
        // --- Inserción en tabla facturacuotaalmenacimientodgii ---
        try {

            const r = resultData.facturaAceptada || resultData.data || resultData;
            const msgs = typeof r.mensajes === 'object' ? JSON.stringify(r.mensajes) : r.mensajes;
            let parsedFechaRecepcion = r.fechaRecepcion;
            if (parsedFechaRecepcion) {
                const jsDate = new Date(parsedFechaRecepcion);
                if (!isNaN(jsDate.getTime())) {
                    parsedFechaRecepcion = jsDate.toISOString().slice(0, 19).replace('T', ' ');
                }
            }

            let parsedFechaFirma = r.FechaHoraFirma;
            if (parsedFechaFirma && parsedFechaFirma.includes('-')) {
                const parts = parsedFechaFirma.split(' ');
                if (parts.length > 1) {
                    const dateParts = parts[0].split('-');
                    if (dateParts.length === 3) {
                        parsedFechaFirma = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]} ${parts[1]}`;
                    }
                }
            }

            await pool.query(`
                INSERT INTO facturacuotaalmenacimientodgii (
                    idfactura, idfacturacuotas, AlmacenamientoSesionEnCache, CodigoSeguridad, Customer, 
                    FechaHoraFirma, TIPO_ECF, TotalITBIS, Total_amount, codigo, encf, estado, 
                    fechaRecepcion, mensajes, secuenciaUtilizada, trackId, url, xml, json
                ) VALUES (?, ?, ?, ?, ?, ATE_FORMAT(STR_TO_DATE(?,'%d-%m-%Y %H:%i:%s'),'%Y-%m-%d %H:%i:%s'), ?, ?, ?, ?, ?, ?, STR_TO_DATE(?, '%Y-%m-%d %H:%i:%s'), ?, ?, ?, ?, ?, ?)
            `, [
                req.body.idfactura || (data?.datos_adicionales?.numerofacturainterna) || 0,
                req.body.idfacturacuotas || 0,
                r.AlmacenamientoSesionEnCache ? 1 : 0, r.CodigoSeguridad || null, r.Customer || null,
                parsedFechaFirma || null, r.TIPO_ECF || null, r.TotalITBIS || null, r.Total_amount || null, r.codigo || null,
                r.encf || null, r.estado || null, parsedFechaRecepcion || null, msgs || null,
                r.secuenciaUtilizada ? 1 : 0, r.trackId || null, r.url || null, r.xml || null,
                JSON.stringify(resultData)
            ]);
            //  LOG DETALLADO
            console.log(" VALORES A INSERTAR:");
            console.log(JSON.stringify(insertValues, null, 2));
            console.log(" Respuesta DGII guardada exitosamente en facturacuotaalmenacimientodgii.");
        } catch (dbErr) {
            console.error(" Fallo al guardar respuesta DGII en facturacuotaalmenacimientodgii:", dbErr.message);
        }
        // ---------------------------------------------------------

        res.status(httpStatus).json(resultData);


    } catch (error) {
        console.error("Error en envío:", error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: "Error al enviar factura a Bitnova" });
    }
});

/**
 * @route GET /real/empresas
 * @desc Obtiene la lista de empresas registradas en la DB
 */
app.get('/real/empresas', async (req, res) => {
    if (!pool) return res.status(503).json({ error: "Base de datos no disponible" });
    try {
        const [rows] = await pool.query(`
            SELECT 
                idempresas, empresa, rnc, p12_pss, entorno, 
                direccion, municipio, provincia, telefono, mail as email, 
                url_dir_service, authorizationcode, archivo_p12
            FROM empresas 
            WHERE habilitado = 1
        `);

        // Limpiar strings de posibles saltos de línea que rompen el JSON en algunos navegadores
        const cleanRows = rows.map(r => ({
            ...r,
            empresa: r.empresa?.replace(/[\r\n]/g, '').trim(),
            rnc: r.rnc?.replace(/[\r\n]/g, '').trim(),
            direccion: r.direccion?.replace(/[\r\n]/g, '').trim(),
            email: r.email?.replace(/[\r\n]/g, '').trim()
        }));

        res.json(cleanRows);
    } catch (error) {
        console.error("Error en /real/empresas:", error.message);
        res.status(500).json({ error: "Error al consultar empresas" });
    }
});







/**
 * @route GET /real/debug-db
 * @desc Lista todas las tablas en la base de datos para verificación
 */
/**
 * @route POST /real/empresas/:id/token
 * @desc Genera o recupera el token de Bitnova para una empresa
 */
app.post('/real/empresas/:id/token', async (req, res) => {
    const { id } = req.params;
    if (!pool) return res.status(503).json({ error: "DB no disponible" });

    try {
        // 1. Ver si ya tiene token
        const [rows] = await pool.query('SELECT authorizationcode FROM empresas WHERE idempresas = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ error: "Empresa no encontrada" });

        let token = rows[0].authorizationcode;

        res.json({ token });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- UTILITARIOS Y DIAGNÓSTICO ---

/**
 * @route GET /real/debug-db
 * @desc Lista todas las tablas en la base de datos para verificación
 */
/**
 * @route GET /real/usuarios
 * @desc Lista los usuarios pertenecientes a una empresa
 */
app.get('/real/usuarios', async (req, res) => {
    const { idEmpresa } = req.query;
    if (!pool) return res.status(503).json({ error: "DB no disponible" });
    try {
        const [rows] = await pool.query('SELECT idusuario, username FROM usuarios WHERE idempresas = ?', [idEmpresa]);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * @route GET /real/listado-facturas
 * @desc Llama al SP loadListadoFacturasDatatable para obtener ventas reales
 */
app.get('/real/listado-facturas', async (req, res) => {
    const { idUsuario, desde, hasta } = req.query;
    if (!pool) return res.status(503).json({ error: "DB no disponible" });

    try {
        if (!idUsuario) return res.status(400).json({ error: "Falta idUsuario" });
        const [results] = await pool.query(
            'CALL loadListadoFacturasDatatable(?, ?, ?, NULL, NULL, NULL)',
            [idUsuario, desde || null, hasta || null]
        );
        res.json(results[0]);
    } catch (error) {
        console.error("Error al llamar SP:", error.message);
        res.status(500).json({ error: error.message });
    }
});

/**
 * @route POST /real/validar-json
 * @desc Valida la estructura de un e-CF sin enviarlo a Bitnova
 */
app.post('/real/validar-json', (req, res) => {
    const eCF = req.body;

    // Validaciones básicas según DOCUMENTACION_API_ECF.md
    if (!eCF.iddoc || !eCF.iddoc.encf) return res.status(400).json({ error: "Falta iddoc.encf (NCF)" });
    if (!eCF.comprador || !eCF.comprador.razonsocialnombrecomprador) return res.status(400).json({ error: "Faltan datos del comprador" });
    if (!eCF.items || !Array.isArray(eCF.items) || eCF.items.length === 0) return res.status(400).json({ error: "Debe incluir al menos un item" });

    res.json({
        mensaje: "Estructura JSON básica validada correctamente",
        tipo: eCF.iddoc.encf.substring(0, 3)
    });
});

/**
 * @route POST /real/validar-json
 * @desc Valida la estructura de un e-CF sin enviarlo a Bitnova
 */
app.post('/real/validar-json', (req, res) => {
    const eCF = req.body;

    // Validaciones básicas según DOCUMENTACION_API_ECF.md
    if (!eCF.iddoc || !eCF.iddoc.encf) return res.status(400).json({ error: "Falta iddoc.encf (NCF)" });
    if (!eCF.comprador || !eCF.comprador.razonsocialnombrecomprador) {
        // Soporte para ambos nombres de campo comunes
        if (!eCF.comprador.razonsocialonombrecomprador) {
            return res.status(400).json({ error: "Faltan datos del comprador (Nombre/Razón Social)" });
        }
    }
    if (!eCF.items || !Array.isArray(eCF.items) || eCF.items.length === 0) return res.status(400).json({ error: "Debe incluir al menos un item" });

    res.json({
        mensaje: "Estructura JSON básica validada correctamente",
        tipo: eCF.iddoc.encf.substring(0, 3)
    });
});

app.get('/real/debug-db', async (req, res) => {
    if (!pool) return res.status(503).json({ error: "Base de datos no conectada" });
    try {
        const [rows] = await pool.query('SHOW TABLES');
        res.json({ tablas: rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Registrar ruta de notas
app.post('/real/notas', notasController.crearNota);

// Inicio del servidor
app.listen(port, () => {
    console.log(`\n Servidor e-CF RD funcionando en http://localhost:${port}`);
    console.log(` Conectado a base de datos: ${process.env.DB_NAME || 'facturacion_db'}`);
});
