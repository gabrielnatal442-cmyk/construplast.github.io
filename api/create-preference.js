export default async function handler(req, res) {
  // Libera o site da Construplast para acessar a API
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

    // Verifica o carrinho
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: "Carrinho vazio"
      });
    }

    // Verifica os dados do cliente
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

    // Produtos
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

    // Confere se o Access Token está configurado
    if (!process.env.MERCADO_PAGO_ACCESS_TOKEN) {
      return res.status(500).json({
        error: "Access Token não configurado"
      });
    }

    // Separa nome e sobrenome
    const nomeCompleto = String(customer.name).trim();
    const partesNome = nomeCompleto.split(/\s+/);

    const firstName = partesNome.shift() || nomeCompleto;
    const lastName = partesNome.join(" ") || "";

    // Telefone somente com números
    const telefone = String(customer.phone).replace(/\D/g, "");

    // CEP somente com números
    const cep = String(customer.zip_code).replace(/\D/g, "");

    // Cria a preferência no Mercado Pago
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
          items: produtos,

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
              street_number: String(customer.street_number)
            }
          },

          shipments: {
            receiver_address: {
              zip_code: cep,
              street_name: String(customer.street_name),
              street_number: String(customer.street_number),

              floor: String(customer.complement || ""),

              apartment:
                String(customer.district || ""),

              city_name:
                String(customer.city),

              state_name:
                String(customer.state)
            }
          },

          metadata: {
            customer_name: nomeCompleto,
            customer_phone: telefone,
            customer_email: String(customer.email),
            delivery_zip_code: cep,
            delivery_street: String(customer.street_name),
            delivery_number: String(customer.street_number),
            delivery_complement: String(customer.complement || ""),
            delivery_district: String(customer.district),
            delivery_city: String(customer.city),
            delivery_state: String(customer.state)
          }
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
