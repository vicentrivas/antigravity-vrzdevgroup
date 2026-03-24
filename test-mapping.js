const formatDate = (date) => {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
};

function mapToEcf(v) {
    const iden = (v.identificacion || "").replace(/-/g, '').trim();
    const isRNC = iden.length === 9;

    let ncfOriginal = v.ncf || "";
    let tipoEcf = isRNC ? "31" : "32";
    let ncfEcf = (isRNC ? "E31" : "E32") + "0000000001";

    if (ncfOriginal.startsWith('B')) {
        const sequence = ncfOriginal.substring(3);
        ncfEcf = (isRNC ? "E31" : "E32") + sequence.padStart(10, '0');
    } else if (ncfOriginal.startsWith('E')) {
        ncfEcf = ncfOriginal;
        tipoEcf = ncfOriginal.substring(1, 3);
    }

    const fechaHoy = formatDate(new Date());
    const fechaEmision = v.fecha ? formatDate(v.fecha) : fechaHoy;

    return {
        iddoc: {
            tipoecf: tipoEcf,
            encf: ncfEcf,
            fechavencimientosecuencia: "31-12-2028",
            tipoingresos: "01",
            tipopago: (v.formapago || 1).toString(),
            indicadormontogravado: v.cuota_itbis > 0 ? "1" : "0"
        },
        datos_adicionales: {
            fechaemision: fechaEmision,
            numerofacturainterna: (v.idfacturacuotas || "").toString(),
            numeropedidointerno: (v.referenciafactura || "").toString(),
            zonaventa: "GENERAL",
            codigovendedor: "001"
        },
        comprador: {
            rnccomprador: iden,
            razonsocialcomprador: `${v.nombres || ''} ${v.apellidos || ''}`.trim() || "CONSUMIDOR FINAL",
            correocomprador: v.correoelectronico || "cliente@correo.com",
            direccioncomprador: "SANTO DOMINGO, RD",
            municipiocomprador: "010100",
            provinciacomprador: "010000"
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
                UnidadMedida: "1",
                PrecioUnitarioItem: (parseFloat(v.cuota_bruto) || 0).toFixed(2),
                MontoItem: (parseFloat(v.cuota_bruto) || 0).toFixed(2),
                IndicadorBienOServicio: "1"
            }
        }
    };
}

// Datos de prueba (Simulando lo que viene de la DB)
const mockData = {
    idfacturacuotas: 123,
    ncf: 'B0100000045',
    cuota_bruto: 6000.00,
    cuota_itbis: 1080.00,
    cuota_total: 7080.00,
    referenciafactura: '123456789016',
    fecha: '2020-04-01',
    nombres: 'DOCUMENTOS',
    apellidos: 'ELECTRONICOS',
    identificacion: '131880681', // 9 dígitos -> RNC -> E31
    correoelectronico: 'test@correo.com'
};

const result = mapToEcf(mockData);
console.log(JSON.stringify(result, null, 2));
