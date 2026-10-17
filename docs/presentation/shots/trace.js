// Written by capture/capture.cjs on 2026-10-17T03:46:55.733Z.
window.AFORO_RUN = {
  "admittedMs": 6652,
  "orderId": "82721866-e5b6-458c-b836-75c3874dc8e7",
  "correlationId": "53fa8392-1657-4174-8084-e0a165421502",
  "availability": [
    194,
    192
  ],
  "paidMs": 4524,
  "trace": {
    "cid": "53fa8392-1657-4174-8084-e0a165421502",
    "hops": [
      {
        "t": "03:46:19.192",
        "svc": "orders",
        "what": "queue_pass_received (se registra, no se verifica)",
        "st": ""
      },
      {
        "t": "03:46:19.765",
        "svc": "inventory",
        "what": "/internal/v1/reservations",
        "st": "201"
      },
      {
        "t": "03:46:19.791",
        "svc": "orders",
        "what": "/api/v1/orders",
        "st": "201"
      },
      {
        "t": "03:46:19.796",
        "svc": "gateway",
        "what": "/api/v1/orders",
        "st": "201"
      },
      {
        "t": "03:46:25.475",
        "svc": "orders",
        "what": "OrderPaid publicado por el outbox",
        "st": "1",
        "async": true
      }
    ]
  },
  "capturedAt": "2026-10-17T03:46:55.733Z"
};
