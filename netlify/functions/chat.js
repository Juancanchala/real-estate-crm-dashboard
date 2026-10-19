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
    const tokensPermitidos = Math.min(Math.max(Number(max_tokens) || 220, 100), 1600);

    const llamarOpenAI = (body) => fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(body)
    }).then(r => r.json());

    // gpt-6-luna: modelo económico que OpenAI recomienda como reemplazo de gpt-4o-mini
    // (gpt-4o-mini sale del API el 14/01/2027). reasoning_effort "none" lo mantiene
    // rápido y evita que el razonamiento consuma los tokens de la respuesta.
    let data = await llamarOpenAI({
      model: "gpt-6-luna",
      messages: messages,
      max_completion_tokens: tokensPermitidos,
      reasoning_effort: "none"
    });

    // Respaldo mientras gpt-4o-mini siga disponible
    if (data.error && data.error.code !== "insufficient_quota" && data.error.code !== "invalid_api_key") {
      console.error("gpt-6-luna falló, usando gpt-4o-mini:", data.error.message);
      data = await llamarOpenAI({
        model: "gpt-4o-mini",
        messages: messages,
        max_tokens: tokensPermitidos,
        temperature: 0.4
      });
    }

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
