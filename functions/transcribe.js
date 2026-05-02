const FormData = require("form-data");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const OPENAI_KEY = process.env.OPENAI_API_KEY;

  try {
    // Parse base64 audio from body
    const { audio, filename, mimeType } = JSON.parse(event.body);
    const audioBuffer = Buffer.from(audio, "base64");

    const form = new FormData();
    form.append("file", audioBuffer, {
      filename: filename || "audio.mp3",
      contentType: mimeType || "audio/mpeg",
    });
    form.append("model", "whisper-1");
    form.append("language", "ja");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        ...form.getHeaders(),
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
