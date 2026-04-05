# Guía de Pruebas de la API (Endpoints) - Empresa 9 (VRZ DEV)

Este documento contiene ejemplos reales basados en la **Empresa 9 (VRZ DEVELOPMENT)** y sus facturas registradas en la base de datos local.

⭐ *Todas las pruebas asumen que tu API está corriendo en tu computadora en `http://localhost:3000`.*

---

## 1. 🏢 Registro y Seguridad

### 1.1 Registrar Empresa (Obtener Token de Bitnova)
- **Método**: `PUT`
- **URL**: `http://localhost:3000/real/registrar-empresa`
- **Tipo de Body**: `multipart/form-data` (porque envía un archivo)

**Ejemplo para Postman:**
1. Crear petición **PUT**.
2. Ir a la pestaña **Body**, seleccionar **form-data**.
3. Añadir llave `archivo_p12`, cambiar tipo a *File* y elegir tu certificado local.
4. Añadir llave `data`, tipo *Text*, y pegar este JSON:
```json
{
  "data": {
    "rnc": "133527601",
    "empresa": "VRZ DEVELOPMENT",
    "p12_pss": "TuClaveDelCertificado",
    "entorno": "Test",
    "direccion": "Calle Principal de VRZ",
    "mail": "correo@vrzdevelopment.com",
    "municipio": "Santo Domingo",
    "provincia": "Santo Domingo",
    "telefono": "809-000-0000"
  }
}
```

### 1.2 Validar Token de Empresa 9
- **Método**: `GET`
- **URL**: `http://localhost:3000/real/validar-token`

**Ejemplo para Postman:**
1. Pestaña **Headers**.
2. Añadir: `Authorization` -> `Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdW...` *(Usa el token completo que te dio el sistema)*

---

## 2. 🧾 Envío de Facturas (e-CF)

### 2.1 Enviar Factura Automáticamente por ID (La forma recomendada)
- **Método**: `POST`
- **URL**: `http://localhost:3000/real/enviar-factura-id`
- **Tipo de Body**: `raw` -> `JSON`

Aquí tienes **3 ejemplos de prueba** con facturas reales que tienes en la base de datos de la empresa 9:

**Prueba 1: Factura de $54,000.00 (NCF: B0200000097)**
```json
{
  "idFacturaCuota": 12443,
  "token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdW..."
}
```

**Prueba 2: Factura de $16,200.00 (NCF: B0200000096)**
```json
{
  "idFacturaCuota": 12292,
  "token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdW..."
}
```

**Prueba 3: Factura de $13,250.00 (NCF: B0200000095)**
```json
{
  "idFacturaCuota": 12291,
  "token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdW..."
}
```
*(Nota: Puse la parte inicial del token real de la empresa que está en la BD. Si el token ya está en la BD, la API lo encuentra automáticamente y no es obligatorio enviarlo en el JSON).*

### 2.2 Enviar Factura Manual (Ya armada)
- **Método**: `POST`
- **URL**: `http://localhost:3000/real/enviar-factura`
- **Tipo de Body**: `raw` -> `JSON`

**Ejemplo de Petición JSON:**
```json
{
  "token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdW...",
  "idfactura": 3139,
  "idfacturacuotas": 12443,
  "data": {
    "iddoc": {
      "tipoecf": "32",
      "encf": "E320000000097",
      "tipoingresos": "01",
      "tipopago": "1",
      "indicadormontogravado": "1"
    },
    "...": "(Aquí va todo el resto del documento...)"
  }
}
```

---

## 3. 🛠️ Consultas y Utilidades

### 3.1 Ver Lista de Empresas
- **Método**: `GET`
- **URL**: `http://localhost:3000/real/empresas`

### 3.2 Consultar el Token Guardado de VRZ DEVELOPMENT (Empresa 9)
- **Método**: `POST`
- **URL**: `http://localhost:3000/real/empresas/9/token` 

### 3.3 Listar Usuarios de Empresa 9
- **Método**: `GET`
- **URL**: `http://localhost:3000/real/usuarios?idEmpresa=9`

### 3.4 Validar Estructura JSON (Modo Prueba)
- **Método**: `POST`
- **URL**: `http://localhost:3000/real/validar-json`
- **Tipo de Body**: `raw` -> `JSON`

**Ejemplo de Petición JSON simulando a la Empresa 9:**
```json
{
  "iddoc": { "encf": "E320000000097" },
  "comprador": { "razonsocialonombrecomprador": "ANA MENDEZ LOPEZ" },
  "items": [
    { "NombreItem": "Servicio de Consultoría" }
  ]
}
```

### 3.5 Revisar Conexión Base de Datos
- **Método**: `GET`
- **URL**: `http://localhost:3000/real/debug-db`
