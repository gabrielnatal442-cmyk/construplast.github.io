export default async function handler(req, res) {
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

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método não permitido"
    });
  }

  try {
    const { items, customer } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: "Carrinho vazio"
      });
    }

    if (
      !customer ||
      !customer.name ||
      !customer.email ||
      !customer.phone ||
      !customer.zip_code ||
      !customer.street_name ||
      !customer.street_number ||
      !customer.district ||
      !customer.city ||
      !customer.state
    ) {
      return res.status(400).json({
        error: "Preencha todos os dados de entrega"
      });
    }

    if (
      !process.env.MERCADO_PAGO_ACCESS_TOKEN ||
      !process.env.SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      return res.status(500).json({
        error: "Variáveis do servidor não configuradas"
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
        item =>
          !Number.isFinite(item.unit_price) ||
          item.unit_price <= 0
      )
    ) {
      return res.status(400).json({
        error: "Preço inválido"
      });
    }

    const valorTotal = produtos.reduce(
      (total, item) =>
        total + item.unit_price * item.quantity,
      0
    );

    const nomeCompleto = String(customer.name).trim();
    const partesNome = nomeCompleto.split(/\s+/);

    const firstName = partesNome.shift() || nomeCompleto;
    const lastName = partesNome.join(" ");

    const telefone = String(customer.phone).replace(/\D/g, "");
    const cep = String(customer.zip_code).replace(/\D/g, "");

    // Cria primeiro o pedido no Supabase
    const pedidoResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/pedidos`,
      {
        method: "POST",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization:
            `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          status: "aguardando_pagamento",
          nome_cliente: nomeCompleto,
          telefone: telefone,
          email: String(customer.email).trim(),
          cep: cep,
          rua: String(customer.street_name),
          numero: String(customer.street_number),
          complemento: String(customer.complement || ""),
          bairro: String(customer.district),
          cidade: String(customer.city),
          estado: String(customer.state).toUpperCase(),
          produtos: produtos,
          valor_total: Number(valorTotal.toFixed(2))
        })
      }
    );

    const pedidoData = await pedidoResponse.json();

    if (!pedidoResponse.ok || !pedidoData?.[0]?.id) {
      console.error("Erro Supabase:", pedidoData);

      return res.status(500).json({
        error: "Não foi possível registrar o pedido"
      });
    }

    const pedidoId = String(pedidoData[0].id);

    // Cria a preferência no Mercado Pago
    const mpResponse = await fetch(
      "https://api.mercadopago.com/checkout/preferences",
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          items: produtos,

          external_reference: pedidoId,

          payer: {
            name: firstName,
            surname: lastName,
            email: String(customer.email).trim(),
            phone: {
              number: telefone
            },
            address: {
              zip_code: cep,
              street_name: String(customer.street_name),
              street_number: Number(customer.street_number) || 0
            }
          },

          shipments: {
            receiver_address: {
              zip_code: cep,
              street_name: String(customer.street_name),
              street_number: Number(customer.street_number) || 0,
              city_name: String(customer.city),
              state_name: String(customer.state).toUpperCase(),
              country_name: "Brasil"
            }
          },

          metadata: {
            pedido_id: pedidoId
          }
        })
      }
    );

    const mpData = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error("Erro Mercado Pago:", mpData);

      // Marca o pedido como erro
      await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedidoId}`,
        {
          method: "PATCH",
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization:
              `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            status: "erro_pagamento"
          })
        }
      );

      return res.status(mpResponse.status).json({
        error: "Erro ao criar pagamento",
        details: mpData
      });
    }

    // Salva o ID da preferência no pedido
    await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedidoId}`,
      {
        method: "PATCH",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization:
            `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          preference_id: mpData.id
        })
      }
    );

    return res.status(200).json({
      pedido_id: pedidoId,
      id: mpData.id,
      init_point: mpData.init_point,
      sandbox_init_point: mpData.sandbox_init_point
    });

  } catch (error) {
    console.error("Erro interno:", error);

    return res.status(500).json({
      error: "Erro interno ao criar pagamento"
    });
  }
}
