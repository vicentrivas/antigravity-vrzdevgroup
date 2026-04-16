const pool = require('../config/db');


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
                itbis,
                descuento,
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

            if ([valorneto, itbis, descuento].some(v => v === undefined || isNaN(v))) {
                return res.status(400).json({ error: "valores numéricos inválidos" });
            }


            if (!idcreo || isNaN(idcreo)) {
                return res.status(400).json({ error: "idcreo inválido" });
            }


            const total = parseFloat(valorneto) + parseFloat(itbis) - parseFloat(descuento);

            const [factura] = await pool.query(
                "SELECT total FROM facturacuotas WHERE idfacturacuotas = ?",
                [idfacturacuotas]
            );

            if (!factura.length) {
                return res.status(404).json({ error: "Factura no encontrada" });
            }


            if (tipo == 34 && total > factura[0].total) {
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
                (idfacturacuotas, referencia, fecha, tipo, valorneto, itbis, descuento, valortotal, concepto, cf, vencimientocf, idcreo) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const values = [
                idfacturacuotas,
                referenciaGenerada,
                fechaValida,
                tipo,
                valorneto,
                itbis,
                descuento,
                total,
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
                total
            });

        } catch (error) {
            console.error("Error:", error.message);
            return res.status(500).json({ error: "Error interno del servidor" });
        }
    }
};

module.exports = notasController;