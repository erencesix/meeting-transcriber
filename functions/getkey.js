exports.handler = async function (event) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "API key not configured. Add OPENAI_API_KEY to Netlify environment variables." })
    };
  }
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key })
  };
};
