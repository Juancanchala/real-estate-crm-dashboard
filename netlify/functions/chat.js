exports.handler = async function(event) {
  // Solo POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  try {
    const { messages, max_tokens } = JSON.parse(event.body);

    if (!messages || !Array.isArray(messages)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Formato inválido" }) };
    }

    // El frontend pide menos tokens para preguntas puntuales y más para reportes generales.
    // Se limita entre 100 y 700 para evitar respuestas vacías o excesivamente largas/costosas.
    const tokensPermitidos = Math.min(Math.max(Number(max_tokens) || 220, 100), 1000);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: messages,
        max_tokens: tokensPermitidos,
        temperature: 0.4
      })
    });

    const data = await response.json();

    if (data.error) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: data.error.message }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply: data.choices[0].message.content })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
