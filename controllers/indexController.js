const pool = require('../config/db');
const axios = require('axios');

const indexController = {

    enviarFacturaId: async (req, res) => {
        const { idFacturaCuota, token: providedToken } = req.body;

        if (!pool) return res.status(503).json({ error: "DB no disponible" });
        if (!idFacturaCuota) return res.status(400).json({ error: "Falta idFacturaCuota" });

        try {

            const [rows] = await pool.query(`CALL loadDatosFacturaCuotasDgii(?)`, [idFacturaCuota]);

            if (!rows || !rows[0] || rows[0].length === 0) {
                return res.status(404).json({ error: "No se encontró la cuota de factura" });
            }

            const v = rows[0][0];

            const token = (providedToken || v.emisor_token || "").trim();

            const isRNC = v.cliente_identificacion && v.cliente_identificacion.length === 9;
            let ncfOriginal = v.ncf || "";
            let tipoEcf = isRNC ? "31" : "32";

            if (ncfOriginal.startsWith('E')) {
                tipoEcf = ncfOriginal.substring(1, 3);
            }

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
                    razonsocialcomprador: `${v.nombres} ${v.apellidos}`
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
                    fechaemision: v.fecha,
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

            // Reglas DGII
            if (ncfOriginal.substring(1, 3) === "32") {
                delete eCF.iddoc.fechavencimientosecuencia;

                if (parseFloat(eCF.totales.montototal) < 250000) {
                    delete eCF.comprador.rnccomprador;
                    delete eCF.comprador.contactocomprador;
                    delete eCF.comprador.correocomprador;
                    delete eCF.comprador.direccioncomprador;
                    delete eCF.comprador.municipiocomprador;
                    delete eCF.comprador.provinciacomprador;
                }

                delete eCF.iddoc.indicadormontogravado;
            }

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
                    estado: axiosError.response?.data?.estado || "Rechazado LOCAL",
                    json_enviado: eCF
                };
            }

            // Guardado DGII
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
                    null,
                    r.AlmacenamientoSesionEnCache ? 1 : 0,
                    r.CodigoSeguridad || null,
                    r.Customer || null,
                    r.FechaHoraFirma || null,
                    r.TIPO_ECF || null,
                    r.TotalITBIS || null,
                    r.Total_amount || null,
                    r.codigo || null,
                    r.encf || null,
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
            console.error("Error:", error.message);
            return res.status(500).json({ error: "Error interno del servidor" });
        }
    }
};

module.exports = indexController;