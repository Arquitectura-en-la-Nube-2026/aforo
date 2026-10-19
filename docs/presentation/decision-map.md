# Mapa de decisiones · Aforo

> Para preparar la sustentación y las preguntas. Cada fila: qué elegimos, por qué, qué descartamos
> y por qué no. Entre paréntesis, dónde está registrada la decisión (E2/E3 = Entregas 2 y 3;
> D-xx = `docs/plan/decisions.md`; ADR-xxxx = `docs/adr/`).

**Las tres fuerzas que explican casi todo:**

1. **Picos de venta** (E-01): miles de compradores en el primer minuto, tras horas sin tráfico.
2. **Cero sobreventa** (E-02): la integridad del inventario no se negocia.
3. **Costo que sigue a las ventas** (E-07, RN-01): ≤ 15 USD/mes en reposo, ≤ 50 USD/mes en total.

Cuando dos decisiones chocan, casi siempre es una de estas contra otra.

---

## 1. Estilos arquitectónicos

| Elegimos | Por qué | Descartamos | Por qué no |
| -------- | ------- | ----------- | ---------- |
| **Microservicios** como estilo principal: un desplegable por capacidad, dueño de sus datos (E2) | El pico de admisión (sala de espera) y el de reserva (inventario) tienen cargas distintas: deben escalar y fallar por separado | **Monolito modular** | Pondría ambos picos sobre un solo proceso y una sola base de datos |
| | | **Un servicio por requisito** | Fragmenta el dominio sin ganancia: más red, más contratos, más despliegues |
| **Orientado a eventos** como estilo complementario (E2) | Quien publica un hecho no conoce a sus consumidores: Catalog no sabe que Queue, Inventory y el prewarmer dependen de `EventPublished` | Todo síncrono | Acoplaría la disponibilidad de cada servicio a la de los demás |
| **Regla de conectores:** síncrono cuando el actor espera la respuesta o la corrección la exige ya (reservar, consultar disponibilidad); asíncrono cuando el consumidor puede ponerse al día | Es la regla que decide cada flecha del diagrama | Event sourcing, streaming | No hay requisito de reconstruir historia ni de procesar flujos continuos; agregan complejidad sin escenario que los pida |
| | | Space-based | La memoria compartida solo se justifica dentro de la sala de espera, no en todo el sistema |
| | | Micro-frontends | Un solo frontend de siete pantallas; un equipo |

> "Ejecución administrada sin estado" es una decisión de **despliegue**, no un estilo adicional (E2).

---

## 2. Proveedor, región y cómputo

| Elegimos | Por qué | Descartamos | Por qué no |
| -------- | ------- | ----------- | ---------- |
| **Google Cloud, southamerica-east1 (São Paulo)** (E3 §5.9) | Región con tres zonas; créditos disponibles y curva de aprendizaje del equipo | AWS, Azure | Perdían en créditos y curva de aprendizaje |
| | | Oracle | Región de una sola zona: no sirve para E-03 |
| **Cloud Run (contenedores serverless)** para web, Gateway y los cuatro servicios | Escala a cero (E-07), autoescala por concurrencia (E-01), sin estado local, timeout largo para SSE | **FaaS para los servicios** (E3 §5.2) | El SSE de la fila dura hasta 15 min (límite de ejecución) y los pools de conexiones a la base son inestables en funciones (E-02) |
| **Queue con CPU siempre asignada** (ADR-0002) | Ya la necesita para mantener las conexiones SSE; así su tick de admisión puede vivir en el proceso | CPU siempre asignada en todo | Cuesta en reposo (E-07) y esconde el problema en vez de resolverlo |
| **Dos FaaS: `prewarmer` (E-01) y `dlq-monitor` (E-05)** (D-21) | Trabajo raro, corto y sin estado; ambos realizan tácticas del diseño, no se agregaron solo para cumplir | Convertir un servicio en función | Contradice E3 §5.2 por las mismas razones de arriba |
| | | Emisión de entradas como función | Sería alcance funcional nuevo (RF-15), que la guía prohíbe |
| | | Contar el mock de pagos como FaaS (D-16) | Es una función, pero es un doble de prueba de un sistema externo, no una táctica del diseño |
| **Funciones sin NestJS, empaquetadas con esbuild** | Cold start pequeño (543 ms y 1 077 ms medidos) | NestJS en funciones | Arranque más lento para una función que trabaja milisegundos |

---

## 3. Persistencia: un almacén por patrón de acceso

| Elegimos | Por qué | Descartamos | Por qué no |
| -------- | ------- | ----------- | ---------- |
| **PostgreSQL (Cloud SQL)** para Catalog, Orders e Inventory (E2) | Transacciones ACID locales: en Inventory, el descuento de cupos, la reserva, el total del comprador y el outbox van en una sola transacción. Restricciones y triggers protegen los estados | Base documental o clave-valor para inventario | Sin transacción multi-fila ni actualización condicional confiable, no hay garantía de cero sobreventa |
| **Una instancia con una base y un usuario por servicio** (D-05) | Mantiene "base de datos por servicio" (nadie lee la base de otro) al costo de una sola instancia `db-f1-micro` | Una instancia por servicio | Triplica el costo fijo (E-07) |
| **Redis (Memorystore) para la sala de espera** (E2) | `ZSET` para el orden, TTL para los pases de 10 min, scripts Lua atómicos, lock por tick. Estado efímero y reconstruible | PostgreSQL para la fila | Cada consulta de posición y cada tick de admisión irían contra la misma base que protege el inventario, justo en el pico |
| **Memorystore creado solo para pruebas y ventanas** (ADR-0001, reemplaza D-15) | Cuesta ≈ US$1–2 por día encendido y US$0 apagado | Memorystore 24/7 | ≈ US$35–50/mes en reposo: rompe E-07 |
| | | Redis en Cloud Run (D-15) | Imposible: Cloud Run no acepta TCP crudo (puerto 6379) |
| | | Redis como sidecar de Queue | Ata la fila a una instancia: no escala y deja de ser sin estado |
| | | Redis en una VM | Infraestructura no administrada que operar |
| **Firestore (documental)** para los pagos del mock | Sin servidor, cobro por operación (≈ 0 en reposo) | — | En el diseño este paradigma era para Notificaciones, que no se construyó; lo decimos así |

---

## 4. Patrones

| Patrón | Por qué | Alternativa descartada | Por qué no |
| ------ | ------- | ---------------------- | ---------- |
| **API Gateway** | Una sola entrada pública: sesión, cuota por IP, correlationId; los servicios solo aceptan llamadas con identidad IAM | Exponer cada servicio | Más superficie de ataque (E-08) y cada servicio repetiría autenticación |
| **Base de datos por servicio** | Cada servicio cambia su esquema sin coordinar con los demás | Base compartida | Acopla esquemas y despliegues |
| **Saga orquestada** en Orders (E2 DA-04) | El proceso tiene orden, estados intermedios, vencimiento y compensaciones: se entiende y se depura en un solo lugar | Coreografía | Con este flujo, el estado de la compra quedaría repartido entre servicios. En el diseño la coreografía sí se usa después del pago (Emisión reacciona a `OrderPaid`) |
| | | 2PC / transacción distribuida | No existe entre servicios con bases separadas y bloquearía recursos en el pico |
| **Transactional Outbox** | El hecho se guarda en la misma transacción que el cambio de estado: no se pierde ni se publica uno que no ocurrió | Escribir en la base y luego publicar (dual write) | Si el proceso cae entre las dos escrituras, el sistema queda inconsistente |
| **Inbox / consumidor idempotente** | Pub/Sub entrega al menos una vez: el consumidor descarta duplicados por `messageId` | Confiar en "exactly once" | El transporte no lo garantiza |
| **Idempotency-Key** guardada en PostgreSQL (RD-02) | El reintento del cliente devuelve la misma respuesta, aunque llegue a otra instancia | Guardarla en memoria | Con varias instancias, el reintento podría crear una segunda orden |
| **Anti-Corruption Layer** hacia la pasarela | El dominio no conoce el formato del proveedor: cambiar el mock por Wompi toca solo el adaptador | Llamar al proveedor desde el dominio | El formato externo se filtraría a todo Orders |
| **Circuit breaker + timeout + reintento** (D-18) | Ante una pasarela caída, fallar en ≈ 10 ms en vez de colgar conexiones | Solo timeout (el plan original) | Cada compra seguiría esperando el timeout; el breaker del diseño necesita timeouts para contar fallas (debilidad D-04 de E3) |
| **Consumidores competidores + DLQ** | Un mensaje que no se puede procesar no bloquea la cola: tras 5 intentos va a su DLQ y genera alerta | Reintentar para siempre | Un mensaje envenenado consumiría recursos sin fin y nadie se enteraría |
| **Transferencia de estado por eventos** | Queue e Inventory tienen su propia copia del evento: reservar no depende de que Catalog responda | Consultar a Catalog en cada reserva | Catalog pasaría a ser punto único de falla en el pico |
| **Nivelación por cola (sala de espera)** | Convierte la ráfaga de llegadas en un flujo dosificado. Medido: p95 de Inventory 808 ms en ráfaga contra 75 ms dosificado | Dejar que todos reserven a la vez | La base hace cola por conexiones y la latencia se dispara |
| **Entrega diferida + barrido** (ADR-0003) | Cloud Tasks vence cada reserva al segundo exacto; el barrido por minuto atrapa la tarea que se pierda | Solo la tarea | Si encolarla falla después del commit, los cupos quedan bloqueados para siempre |
| | | Solo un sondeo periódico | Vencimientos imprecisos y trabajo constante aunque no haya reservas |
| **Bulkhead** (topes de instancias × pool, colas separadas) (ADR-0005) | Una ráfaga en un servicio no agota las 25 conexiones de la base para los demás | Autoescalado sin topes | Más instancias abrirían más conexiones de las que la base admite |

---

## 5. Tácticas por escenario de calidad

| Escenario | Tácticas que construimos | Por qué estas | Lo que quedó fuera y por qué |
| --------- | ------------------------ | ------------- | ---------------------------- |
| **E-01 Elasticidad** | Precalentar antes de abrir (`prewarmer`), autoescalado, escala a cero, sala de espera, cuota por IP | La hora de apertura se conoce de antemano: es más barato preparar la capacidad que reaccionar en frío | Mínimo 2–3 instancias (usamos 1, por tamaño de dev); rate limiting en el borde (no hay Edge); prueba de carga de 3.000 |
| **E-02 Integridad** | `UPDATE … WHERE available >= q`, índice único parcial, límite de concurrencia agregado, admisión dosificada | La garantía vive en la base de datos y resiste cualquier concurrencia; la latencia la protege la sala de espera | Perfil de base de 100 conexiones (cuesta) |
| **E-03 Disponibilidad** | Health checks; Cloud Run reparte instancias entre zonas | Detección sin costo | Réplica de Cloud SQL y de Redis: costo fijo que rompe E-07 |
| **E-05 Observabilidad** | Logs JSON con correlationId en HTTP, Pub/Sub y Cloud Tasks; alerta de DLQ (`dlq-monitor`) | Se sigue una compra completa sin instrumentar tracing | Tracing distribuido y alerta de tasa de error de pagos |
| **E-06 Resiliencia de pagos** | Timeout 0,5 s / 2 s, 3 reintentos con backoff y jitter, breaker (5 fallas, 30 s), `503 PAYMENT_UNAVAILABLE`, **no extender la reserva** (E3-ADR-03) | Falla rápida sin cobros dobles; extender la reserva contradecía RF-09 | — |
| **E-07 Costo** | Escala a cero, `make down` (detiene Cloud SQL, destruye Redis), Memorystore por ventana | El costo sigue al uso | Crear el Edge por ventana (no hay Edge); purga por TTL de outbox e inbox |
| **E-08 Seguridad** | Gateway valida la sesión, servicios privados con IAM, webhook con HMAC, validación de entrada | Lo que se puede tener sin Edge ni proveedor de identidad | WAF, Identity Platform, ingreso interno, VPC Service Controls |
| **E-04 Aislamiento entre organizadores** | — | — | Se excluyó en la Entrega 3: no hay línea base y el corte tiene un solo organizador |

---

## 6. Decisiones de construcción (lo que el diseño no podía prever)

| Decisión | Qué la forzó | Alternativa descartada |
| -------- | ------------ | ---------------------- |
| **Todo el trabajo ocurre dentro de una solicitud** (ADR-0002): outbox publicado tras el commit, housekeeping cada minuto con Cloud Scheduler, webhook procesado antes de responder | Cloud Run estrangula la CPU entre solicitudes: pollers y "responder y procesar después" se pierden | CPU siempre asignada en todos los servicios: costo en reposo |
| **Terraform es dueño de la configuración; CI del código y del tráfico; el prewarmer de los mínimos** (ADR-0004) | Terraform y CI pisaban los mismos servicios: un `apply` revertía la imagen desplegada | Que ambos cambien todo: cada uno deshace al otro |
| **Interruptores solo por `make`** (`up`, `down`, `redis-up`, `fault`) (ADR-0004) | Nada fuera de la infraestructura como código | Cambiar recursos con `gcloud` a mano |
| **Topes de instancias y pools; Orders con 1 instancia** (ADR-0005) | 25 conexiones en `db-f1-micro`; el breaker vive en memoria y el demo debe ser determinista | Breaker compartido en Redis: una llamada más en cada pago |
| **Sin sharding; `event_id` como clave de partición si hiciera falta** (ADR-0006) | Ninguna regla cruza eventos: la reserva sigue siendo una transacción local | `buyer_id` (parte el contador), `reservation_id` (consultas dispersas), `created_at` (punto caliente temporal) |
| **Next.js en vez de Angular** (ADR-0007, reemplaza D-02) | El equipo del frontend trabaja en React; la carpeta estaba vacía | Angular: nada lo exigía |
| **Artefacto inmutable y blue/green** (D-19) | Lo pide la guía: imagen por commit, despliegue por digest, revisión sin tráfico, smoke test, promoción; rollback en 8,3 s | Desplegar sobre la revisión activa: sin prueba previa ni vuelta atrás inmediata |
| **Migraciones como job antes del tráfico, expand/contract** (D-19) | La versión anterior sigue atendiendo mientras corre la migración | Migrar al arrancar el servicio: varias instancias migrando a la vez |
| **Contratos primero, con mocks de Prism** | Seis frentes trabajando en paralelo sin esperarse | Integrar sobre la marcha |
| **Node 24 en todo** (D-01) | La versión actual de Prism lo exige | Node 22: atarse a herramientas viejas |

---

## 7. Desviaciones deliberadas del diseño

Las decimos antes de que las pregunten.

| Decisión | Por qué | Costo que aceptamos |
| -------- | ------- | ------------------- |
| **El pase de la fila no se verifica al reservar** (D-07) | Tiempo: era la verificación con firma ES256 y claves en Secret Manager | Se puede reservar sin pasar por la fila; hoy la impone la interfaz. Es la desviación más grande |
| **Login simulado con JWT HS256** (D-06) | Tiempo; el token tiene forma de OIDC para cambiar a Identity Platform solo por configuración | RF-18 parcial |
| **Sin Edge, CAPTCHA, emisión ni notificaciones** | Alcance del corte: el camino de compra hasta la orden pagada | E-08 sin evaluar; `OrderPaid` sin consumidor |
| **Base zonal y Redis sin réplica** | Costo (E-07) | E-03 no demostrado |
| **Todo vive en la nube; no se corre el sistema completo en local** (D-10) | Un solo ambiente fiel a producción | Ciclo de integración más lento |

---

## 8. Puntos de sensibilidad y trade-off (para la pregunta "¿qué sacrificaron?")

| Punto | Atributos en tensión | Cómo lo resolvimos |
| ----- | -------------------- | ------------------ |
| Almacén en memoria solo por ventana | Costo (E-07) vs. elasticidad y disponibilidad (E-01, E-03) | ADR-0001: Memorystore bajo demanda; tarda ≈ 10 min en crearse |
| Una instancia de base para todos | Costo vs. aislamiento | D-05 + ADR-0005: topes y pools que suman 19 de 22 conexiones |
| Tope de instancias × pool de Inventory | Integridad vs. latencia (**sensibilidad medida**) | Cero sobreventa siempre; p95 808 ms en ráfaga, 75 ms dosificado: por eso existe la sala de espera |
| Contador de cupos serializado | Integridad vs. escalabilidad | ADR-0006: partir por `event_id` cuando haga falta |
| Breaker en memoria | Determinismo vs. escalar Orders | ADR-0005: una instancia en dev |
| Trabajo solo dentro de solicitudes | Costo de CPU vs. latencia de lo asíncrono | ADR-0002: outbox tras el commit + housekeeping cada minuto |
