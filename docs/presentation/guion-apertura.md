# Guion · Apertura (Luis Esteban)

**Defensa Entrega 4 · minuto 0–1 · slides 1–3** · ~160 palabras ≈ 1 min (a buen ritmo)

> **[clic]** = Julián avanza el deck.

---

## Slide 1 · Portada · ≈ 22 s

Buenos días. Somos el Equipo F y les presentamos **Aforo**, una plataforma de
**venta de entradas para eventos masivos**: conciertos, festivales, partidos.

El comprador elige un evento, espera su turno en una **sala de espera virtual**,
reserva sus localidades y paga en línea.

En esta entrega construimos y desplegamos ese camino de compra en Google Cloud.

**[clic → slide 2]**

---

## Slide 2 · El problema · ≈ 25 s

El problema: una venta masiva es **un pico, no un promedio**.

**[clic]** Tres mil compradores llegan en el primer minuto, después de horas sin tráfico.

**[clic]** Con miles de reservas a la vez, no podemos vender **ni una localidad de más**.

**[clic]** Y en reposo, el sistema debe costar **quince dólares al mes o menos**.

Todo lo que sigue responde a uno de estos tres.

**[clic → slide 3]**

---

## Slide 3 · Lo que construimos · ≈ 15 s

Lo que construimos es **ese camino completo**, sobre Cloud Run, con dos funciones
FaaS y todo declarado en Terraform.

Para ser claros: **quedaron fuera** la emisión de entradas, las notificaciones,
la identidad gestionada, el WAF y la verificación del pase.

**Sergio, ¿nos muestras una compra?**

---

## Recordatorios

- **Clics con Julián:** «en Google Cloud» · «un pico, no un promedio» · «primer minuto» ·
  «ni una localidad de más» · «quince dólares». Si se desfasa, sigue hablando.
- **No leer el slide 3 entero:** los pasos y los servicios ya están en pantalla.
- **«Quedaron fuera» no se recorta nunca.**
- **Pronunciar:** FaaS = «fas».
- **Si sobra tiempo** (slide 2): «Son los escenarios E-01, E-02 y E-07 de la Entrega 3».
- **Si pasas de 1:05:** quita «conciertos, festivales, partidos» y «después de horas sin tráfico».
