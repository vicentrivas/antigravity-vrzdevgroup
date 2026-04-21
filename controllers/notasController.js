const pool = require('../config/db');
const axios = require('axios');


const generarReferencia = ({ tipo, idFactura, idUsuario }) => {
    const timestamp = Date.now().toString(); // últimos 5 dígitos
    return `${tipo}${idFactura}${idUsuario}${timestamp}`;
};

const notasController = {
    crearNota: async (req, res) => {
        try {
            const {
                idfacturacuotas,
                fecha,
                tipo, // 33 = debito, 34 = credito
                valorneto,
                concepto,
                cf,
                vencimientocf,

                idcreo
            } = req.body;

            if (!idfacturacuotas || isNaN(idfacturacuotas)) {
                return res.status(400).json({ error: "idfacturacuotas inválido" });
            }

            if (![33, 34].includes(parseInt(tipo))) {
                return res.status(400).json({ error: "tipo inválido (33=debito, 34=credito)" });
            }

            if ([valorneto].some(v => v === undefined || isNaN(v))) {
                return res.status(400).json({ error: "valores numéricos inválidos" });
            }


            if (!idcreo || isNaN(idcreo)) {
                return res.status(400).json({ error: "idcreo inválido" });
            }


            const [factura] = await pool.query(
                "SELECT total FROM facturacuotas WHERE idfacturacuotas = ?",
                [idfacturacuotas]
            );

            if (!factura.length) {
                return res.status(404).json({ error: "Factura no encontrada" });
            }


            if (tipo == 34 && valorneto > factura[0].total) {
                return res.status(400).json({ error: "El crédito no puede ser mayor al total de la factura" });
            }


            const fechaValida = fecha || new Date();

            const referenciaGenerada = generarReferencia({
                tipo,
                idFactura: idfacturacuotas,
                idUsuario: idcreo
            });

            // 💾 Insert
            const query = `
                INSERT INTO notadebitocredito 
                (idfacturacuotas, referencia, fecha, tipo, valorneto, concepto, cf, vencimientocf, idcreo) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const values = [
                idfacturacuotas,
                referenciaGenerada,
                fechaValida,
                tipo,
                valorneto,
                concepto || null,
                cf || null,
                vencimientocf || null,
                idcreo
            ];
            const [result] = await pool.query(query, values);
            const idfacturancfprefijo = tipo == 33 ? 2 : 3;
            const idnotadebitocredito = result.insertId
            await pool.query(
                "CALL pa_AsignarEcfNotasDebCredDgii(?, ?)",
                [idfacturancfprefijo, idnotadebitocredito]);
            return res.status(201).json({
                mensaje: "Nota creada correctamente",
                id: result.insertId,
                referencia: referenciaGenerada,
                valorneto
            });

        } catch (error) {
            console.error("Error:", error.message);
            return res.status(500).json({ error: "Error interno del servidor" });
        }
    },
    enviarNotaId: async (req, res) => {
        const { idNotaDebitoCredito, token: providedToken } = req.body;

        if (!pool) return res.status(503).json({ error: "DB no disponible" });
        if (!idNotaDebitoCredito) return res.status(400).json({ error: "Falta idNotaDebitoCredito" });

        try {

            const [rows] = await pool.query(
                `CALL loadDatosNotasDebCredDgii(?)`,
                [idNotaDebitoCredito]
            );

            if (!rows || !rows[0] || rows[0].length === 0) {
                return res.status(404).json({ error: "Nota no encontrada" });
            }

            const v = rows[0][0];
            const token = (providedToken || v.emisor_token || "").trim();
            const tipoEcf = v.cf.substring(1, 3); // 33 o 34

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

            // Reglas DGII
            if (tipoEcf === "34") {
                eCF.iddoc.indicadormontogravado = "0";
                eCF.iddoc.indicadornotacredito = "0";
                eCF.informacion_referencia["1"].RazonModificacion = "Error en monto";

                eCF.opciones_adicionales = {
                    INCLUIR_EMISOR: true
                };

            } else if (tipoEcf === "33") {
                eCF.iddoc.fechavencimientosecuencia = "31-12-2028";
            }

            // Limpiar nulls
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

            // Guardar respuesta DGII
            try {
                const r = resultData.facturaAceptada || resultData.data || resultData;

                const msgs = typeof r.mensajes === 'object'
                    ? JSON.stringify(r.mensajes)
                    : (r.mensajes || "");

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
                    msgs,
                    r.secuenciaUtilizada ? 1 : 0,
                    r.trackId || null,
                    r.url || null,
                    r.xml || null,
                    JSON.stringify(resultData)
                ]);

            } catch (dbErr) {
                console.error("Error guardando DGII:", dbErr.message);
            }

            return res.status(httpStatus).json(resultData);

        } catch (error) {
            console.error("Error general:", error.message);
            return res.status(500).json({ error: "Error en proceso" });
        }
    },
    crearYEnviarNotaUnificado: async (req, res) => {

        let idNota;
        let referenciaGenerada;

        try {

            const {
                idfacturacuotas,
                fecha,
                tipo,
                valorneto,
                concepto,
                cf,
                vencimientocf,
                idcreo,
                token
            } = req.body;
            if (!idfacturacuotas || isNaN(idfacturacuotas)) {
                return res.status(400).json({ error: "idfacturacuotas inválido" });
            }

            if (![33, 34].includes(parseInt(tipo))) {
                return res.status(400).json({ error: "tipo inválido (33=debito, 34=credito)" });
            }

            if (!valorneto || isNaN(valorneto)) {
                return res.status(400).json({ error: "valorneto inválido" });
            }

            if (!idcreo || isNaN(idcreo)) {
                return res.status(400).json({ error: "idcreo inválido" });
            }
            const conn1 = await pool.getConnection();
            await conn1.beginTransaction();

            const [factura] = await conn1.query(
                "SELECT total FROM facturacuotas WHERE idfacturacuotas = ?",
                [idfacturacuotas]
            );

            if (!factura.length) {
                await conn1.rollback();
                conn1.release();
                return res.status(404).json({ error: "Factura no encontrada" });
            }

            if (tipo == 34 && valorneto > factura[0].total) {
                await conn1.rollback();
                conn1.release();
                return res.status(400).json({ error: "El crédito no puede ser mayor al total de la factura" });
            }

            const fechaValida = fecha || new Date();

            referenciaGenerada = generarReferencia({
                tipo,
                idFactura: idfacturacuotas,
                idUsuario: idcreo
            });
            const [result] = await conn1.query(`
            INSERT INTO notadebitocredito 
            (idfacturacuotas, referencia, fecha, tipo, valorneto, concepto, cf, vencimientocf, idcreo) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
                idfacturacuotas,
                referenciaGenerada,
                fechaValida,
                tipo,
                valorneto,
                concepto || null,
                cf || null,
                vencimientocf || null,
                idcreo
            ]);

            idNota = result.insertId;
            const prefijo = tipo == 33 ? 2 : 3;

            await conn1.query(
                "CALL pa_AsignarEcfNotasDebCredDgii(?, ?)",
                [prefijo, idNota]
            );

            await conn1.commit();
            conn1.release();
            const conn2 = await pool.getConnection();

            const [rows] = await conn2.query(
                `CALL loadDatosNotasDebCredDgii(?)`,
                [idNota]
            );

            conn2.release();

            if (!rows || !rows[0] || rows[0].length === 0) {
                return res.status(404).json({ error: "No se encontraron datos para DGII" });
            }

            const v = rows[0][0];
            const token2 = (token || v.emisor_token || "").trim();
            if (!v.cf) {
                return res.status(400).json({
                    error: "No se generó el NCF (encf). No se puede enviar a DGII"
                });
            }
            const tipoEcf = v.cf.substring(1, 3);

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

            if (tipoEcf === "34") {
                eCF.iddoc.indicadormontogravado = "0";
                eCF.iddoc.indicadornotacredito = "0";
                eCF.informacion_referencia["1"].RazonModificacion = "Error en monto";
                eCF.opciones_adicionales = { INCLUIR_EMISOR: true };
            } else if (tipoEcf === "33") {
                eCF.iddoc.fechavencimientosecuencia = "31-12-2028";
            }
            let resultData;
            try {
                const response = await axios.post(
                    "https://api.bitnovaservices.com/api/v1/dgii",
                    eCF,
                    {
                        headers: {
                            Authorization: token2,
                            "Content-Type": "application/json"
                        },
                        timeout: 60000
                    }
                );
                resultData = response.data;
            } catch (axiosError) {
                resultData = {
                    error: axiosError.message,
                    response: axiosError.response?.data
                };
            }
            try {
                const r = resultData.facturaAceptada || resultData.data || resultData;
                const msgs = typeof r.mensajes === 'object' ? JSON.stringify(r.mensajes) : r.mensajes;
                const conn3 = await pool.getConnection();

                await conn3.query(`
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
                    idNota,

                    r.AlmacenamientoSesionEnCache ? 1 : 0,
                    r.CodigoSeguridad || null,
                    r.Customer || null,
                    r.FechaHoraFirma || null,
                    r.TIPO_ECF || null,
                    r.TotalITBIS || null,
                    v.valorneto || null,

                    r.codigo || null,
                    v.cf || null,
                    r.estado || null,
                    r.fechaRecepcion || null,
                    msgs,

                    r.secuenciaUtilizada ? 1 : 0,
                    r.trackId || null,
                    r.url || null,
                    r.xml || null,

                    JSON.stringify(resultData)
                ]);

                conn3.release();

            } catch (dbErr) {
                console.error("Error guardando DGII:", dbErr.message);
            }
            return res.status(201).json({
                mensaje: "Nota creada y procesada correctamente",
                idNota,
                referencia: referenciaGenerada,
                dgii: resultData
            });

        } catch (error) {

            console.error(" Error:", error.message);

            return res.status(500).json({
                error: "Error en proceso completo",
                detalle: error.message
            });
        }
    }


};

module.exports = notasController;