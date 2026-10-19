# Guion · Julián · Componentes y conectores

> Diapositivas 7–10 · 6:00–8:30 (≈ 2,5 min, ≈ 280 palabras). También eres el operador: las
> acciones entre corchetes las marca la consola del presentador.

## Diapositiva 7 · «b · Componentes y conectores»

*[Antes de hablar: `make poison` → pega el correlationId → «Hecho».]*

> Pasamos a la arquitectura. Primero, la vista de componentes y conectores: lo que existe en el
> repositorio y corre en dev.

## Diapositiva 8 · Vista C&C

> Son cinco servicios en Cloud Run —Gateway, Catalog, Queue, Orders e Inventory— más el frontend
> Web. Cada servicio es dueño de su almacén: nadie lee la base de otro; los datos cruzan por REST o
> por eventos.
>
> Arriba está la entrada, en el centro la lógica y abajo la mensajería, Pub/Sub y Cloud Tasks,
> junto con las dos funciones. Las bandas de color son los tres paradigmas de persistencia:
> relacional, clave-valor y documental.

## Diapositiva 9 · La compra sobre la vista

Una frase por clic.

1. **Login:** El Gateway emite la sesión y crea el correlationId que acabamos de ver en los logs.
2. **Catálogo:** Catalog es el único que decide si la venta está abierta.
3. **Sala de espera:** Queue ordena a los compradores en Redis y les envía la posición por SSE.
4. **Reserva:** Orders inicia la saga; Inventory descuenta los cupos en una sola transacción y
   programa el vencimiento en Cloud Tasks.
5. **Pago:** Orders llama a la pasarela a través de un adaptador con timeout, reintentos y circuit
   breaker.
6. **Webhook:** La confirmación vuelve como un webhook firmado; Orders verifica la firma y descarta
   duplicados.
7. **Orden pagada:** Orders confirma la reserva y publica OrderPaid por el outbox, en la misma
   transacción.
8. **Trazabilidad:** Y cada salto queda en Cloud Logging con el mismo correlationId.

## Diapositiva 10 · Estilos

*[La consola dirá «Prepárate · E-01»: abre la segunda terminal.]*

1. El estilo principal es **microservicios**: un desplegable por capacidad, con su propia base, su
   imagen y su escalado.
2. El complementario es **orientado a eventos**: síncrono cuando el comprador espera la respuesta,
   asíncrono cuando el consumidor puede ponerse al día. Quien publica un hecho no conoce a sus
   consumidores.

## Entrega a Daniel Felipe

> Daniel nos muestra ahora dónde vive cada patrón en esta vista.

*[Cuando Daniel esté en «Dónde vive cada patrón»: lanza E-01 → «Hecho».]*
