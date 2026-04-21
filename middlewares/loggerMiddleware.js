const pool = require('../config/db.js');

const loggerMiddleware = (req, res, next) => {

    const method = req.method;
    const endpoint = req.originalUrl || req.url;
    const ip = req.ip || req.connection.remoteAddress;
    const headers = JSON.stringify(req.headers);

    const requestBody = req.body ? JSON.stringify(req.body) : null;

    // Sobrescribir res.send y res.json temporalmente para capturar el response
    const originalSend = res.send;
    const originalJson = res.json;
    let responseBody = null;

    res.send = function (body) {
        responseBody = typeof body === 'object' ? JSON.stringify(body) : body;
        originalSend.call(this, body);
    };

    res.json = function (body) {
        responseBody = JSON.stringify(body);
        originalJson.call(this, body);
    };

    res.on('finish', async () => {
        const responseStatus = res.statusCode;

        let errorMessage = null;
        if (responseStatus >= 400) {
            try {
                const parsedResponse = JSON.parse(responseBody);
                errorMessage = parsedResponse.error || parsedResponse.message || "Error HTTP " + responseStatus;
            } catch (e) {
                errorMessage = responseBody;
            }
        }

        try {
            if (pool) {
                await pool.query(`
                    INSERT INTO api_logs (
                        metodo, endpoint, ip_origen, headers, request_body, 
                        response_status, response_body, error_message
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    method, endpoint, ip, headers, requestBody,
                    responseStatus, responseBody, errorMessage
                ]);
                console.log(`[LOGGER] Petición registrada: ${method} ${endpoint} (Status: ${responseStatus})`);
            } else {
                console.warn("[LOGGER] DB local no lista, log se omite.");
            }
        } catch (dbErr) {
            console.error("[LOGGER] Error al intentar guardar en api_logs:", dbErr.message);
        }
    });

    next();
};

module.exports = loggerMiddleware;
