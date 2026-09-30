export default async function handler(req, res) {
  // Libera chamadas do seu site para a API da Vercel
  const allowedOrigins = [
    "https://construplast.com.br",
    "https://www.construplast.com.br"
  ];

  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  // Responde à verificação CORS do navegador
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método não permitido"
    });
  }

  try {
    const { items } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: "Carrinho vazio"
      });
    }

    const produtos = items.map((item) => ({
      title: String(item.title || "Produto"),
      quantity: Math.max(1, Number(item.quantity) || 1),
      unit_price: Number(item.unit_price),
      currency_id: "BRL"
    }));

    if (
      produtos.some(
        (item) =>
          !Number.isFinite(item.unit_price) ||
          item.unit_price <= 0
      )
    ) {
      return res.status(400).json({
        error: "Preço inválido"
      });
    }

    if (!process.env.MERCADO_PAGO_ACCESS_TOKEN) {
      return res.status(500).json({
        error: "Access Token não configurado"
      });
    }

    const response = await fetch(
      "https://api.mercadopago.com/checkout/preferences",
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          items: produtos
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Erro Mercado Pago:", data);

      return res.status(response.status).json({
        error: "Erro ao criar pagamento",
        details: data
      });
    }

    return res.status(200).json({
      id: data.id,
      init_point: data.init_point,
      sandbox_init_point: data.sandbox_init_point
    });

  } catch (error) {
    console.error("Erro interno:", error);

    return res.status(500).json({
      error: "Erro interno ao criar pagamento"
    });
  }
}
