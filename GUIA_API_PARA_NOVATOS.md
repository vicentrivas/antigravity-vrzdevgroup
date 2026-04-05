# Guía de la API (Para Principiantes)

¡Hola! Si estás viendo este proyecto por primera vez y te sientes confundido, ¡no te preocupes! Aquí te explico de manera súper sencilla qué hace este sistema y cómo funciona.

## ¿Qué es esta "API"?
Imagina esta API (servidor) como un **mensajero** inteligente o un **traductor**.

Por un lado tienes tu sistema principal (probablemente un sistema creado en Java o tu base de datos donde guardas el registro de tus ventas diarias).
Por el otro lado, tienes a **Bitnova** y a la **DGII** (la Dirección General de Impuestos Internos), que esperan recibir las facturas electrónicas (e-CF) en un formato muy específico, estricto y ordenado.

Esta API (desarrollada en un lenguaje llamado Node.js) se sienta exactamente en el medio de estos dos mundos. Su trabajo de todos los días es:
1. Escuchar a tu sistema local de ventas.
2. Extraer la información y "traducirla" al formato digital que pide Bitnova/DGII.
3. Enviar la factura a través de internet de forma segura.
4. Recibir la respuesta (saber si fue aceptada o rechazada) y anotarla de vuelta en tu base de datos.

---

## Las funciones de este sistema (Los "Endpoints")

El código tiene varias "puertas" o ventanillas de atención por las que se le puede pedir que haga su trabajo. Estas ventanillas se llaman **Endpoints**. Aquí van las más importantes:

### 1. El pase de seguridad (Registro y Token)
Antes de mandar facturas, la empresa tiene que decirle a Bitnova de forma segura: *"¡Oye, soy yo, aquí está mi certificado!"*.
*   **La ventanilla `/real/registrar-empresa`**: Recibe un archivo de seguridad de tu empresa (un archivo `.p12`) y sus datos, y se los manda a Bitnova para pedirles a cambio una llave maestra digital que se llama **Token**. Esta llave le permitirá a tu empresa enviar facturas de forma automática. El sistema guarda esta llave en la base de datos.
*   **La ventanilla `/real/validar-token`**: Simplemente es para probar si esa "llave maestra" (Token) que guardamos antes todavía sirve o si ya se venció.

### 2. El corazón del programa: Enviar las Facturas
Aquí es donde ocurre la magia. Tu sistema principal de la tienda no tiene que romperse la cabeza armando los complicados documentos para la DGII, esta pequeña API lo hace todo.

*   **La ventanilla `/real/enviar-factura-id` (La forma Mágica/Automática):**
    *   Tu sistema de tienda solo le manda un aviso a esta API: *"Oye, necesito que envíes la factura con el ID 55"*.
    *   La API va solita a tu base de datos (MySQL), busca quién fue el cliente, cuánto pagó, qué fecha es, cuánto es de ITBIS (impuestos), etc.
    *   La API arma el documento digital perfecto que exige la DGII.
    *   Se lo manda por internet a Bitnova usando la "llave maestra" de tu empresa.
    *   Bitnova contesta: *¡Factura Aprobada!* (o si hay errores, dice por qué).
    *   La API va de nuevo a tu base de datos y anota la respuesta (en una tabla llamada `facturacuotaalmenacimientodgii`) para que tú puedas consultarlo en tu sistema cuando quieras.

*   **La ventanilla `/real/enviar-factura` (La forma de cartero/manual):**
    *   A veces tu sistema principal ya armó todo el documento y solo necesita a alguien que se lo lleve a Bitnova. En esta ventanilla, la API recibe el paquete ya listo, hace su trabajo de mensajero entregándolo, y te trae la respuesta para guardarla.

### 3. Consultas y Utilidades rápidas
*   **`/real/empresas`**: Te devuelve una lista de las empresas que tienes anotadas en tu sistema y que están listas para facturar.
*   **`/real/validar-json`**: Es como un revisor de ortografía para las facturas. Si quieres saber si el formato de una factura está bien *antes* de enviarlo y que sea oficial para la DGII, lo mandas por aquí y la API te dice si le falta o le sobra algo.

---

## En resumen: El circuito completo todos los días

Vamos a ver un ejemplo paso a paso:
1. 👨‍💼 Un cliente compra algo en tu negocio.
2. 💻 Tu sistema de ventas anota eso en la Base de Datos.
3. 🔔 Tu sistema le manda un "toque" a esta API: *"Por favor, manda la factura de esta venta (ID 150)"*.
4. 🤖 **Esta API** recoge la información y la convierte al formato de Factura Electrónica (e-CF).
5. 🌐 **Esta API** contacta por internet a Bitnova y le entrega el paquete seguro.
6. 📩 Bitnova revisa que todo cuadre y le da el *"Visto Bueno"*.
7. 💾 **Esta API** guarda ese sello de *"Visto Bueno"* en tu Base de Datos local.
8. ✅ ¡Listo! La factura ya es legal y fue enviada a la DGII de manera exitosa sin que tú te dieras cuenta del proceso complejo.

¡Espero que esta guía te sirva para entender el poder y la importancia de este sistema! Está diseñado para ahorrar muchísimo trabajo manual.
