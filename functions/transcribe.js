exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const OPENAI_KEY = process.env.OPENAI_API_KEY;

  try {
    const { audio, filename, mimeType } = JSON.parse(event.body);
    const audioBuffer = Buffer.from(audio, "base64");

    const form = new FormData();
    const blob = new Blob([audioBuffer], { type: mimeType || "audio/mpeg" });
    form.append("file", blob, filename || "audio.mp3");
    form.append("model", "whisper-1");
    form.append("language", "ja");
    form.append("response_format", "verbose_json");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: form,
    });

    const data = await response.json();

    if (data.error) {
      return { statusCode: 500, body: JSON.stringify({ error: data.error.message }) };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript: data.text,
        segments: data.segments || [],
      }),
    };
  } catch (err) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: "Transcription failed: " + err.message }),
    };
  }
};
