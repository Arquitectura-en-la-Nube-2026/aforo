# Guion · Apertura (Luis Esteban)

**Defensa Entrega 4 · minuto 0–1 · slides 1–3** · ~145 palabras ≈ 60 s

> **[clic]** = Julián avanza el deck.

---

## Slide 1 · Portada · ≈ 12 s

Buenos días. Somos el Equipo F y les presentamos **Aforo**.
En esta entrega construimos y desplegamos en Google Cloud el camino de compra
que diseñamos en las entregas anteriores.

**[clic → slide 2]**

---

## Slide 2 · El problema · ≈ 28 s

El problema: una venta masiva es **un pico, no un promedio**.

**[clic]** Tres mil compradores llegan en el primer minuto, después de horas sin tráfico.

**[clic]** Con miles de reservas a la vez, no podemos vender **ni una localidad de más**.

**[clic]** Y en reposo, el sistema debe costar **quince dólares al mes o menos**.

Son los escenarios E-01, E-02 y E-07, y todo lo que vamos a mostrar responde a uno de ellos.

**[clic → slide 3]**

---

## Slide 3 · Lo que construimos · ≈ 20 s

Construimos el **camino de compra completo**: login, catálogo, sala de espera,
reserva, pago simulado y orden pagada. Todo corre sobre Cloud Run, con dos
funciones FaaS, y está declarado en Terraform.

Y para ser claros desde ya: **quedaron fuera** la emisión de entradas, las
notificaciones, la identidad gestionada, el WAF y la verificación del pase.

**Sergio, ¿nos muestras una compra?**

---

## Recordatorios

- **Clics con Julián:** «Aforo» · «un pico, no un promedio» · «primer minuto» ·
  «ni una localidad de más» · «quince dólares». Si se desfasa, sigue hablando.
- **No leer el slide 3 entero:** los servicios ya están en pantalla.
- **«Quedaron fuera» no se recorta nunca.**
- **Pronunciar:** «E cero uno, E cero dos, E cero siete» · FaaS = «fas».
- **Si sobra tiempo** (slide 2): «Estos escenarios vienen de la Entrega 3».
- **Si pasas de 1:05:** quita «después de horas sin tráfico» y «Y para ser claros desde ya».
