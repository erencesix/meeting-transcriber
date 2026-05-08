exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  const OPENAI_KEY = process.env.OPENAI_API_KEY;

  if (!OPENAI_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "API key not configured. Add OPENAI_API_KEY to Netlify environment variables." }) };
  }

  let audio, filename, mimeType;
  try {
    const body = JSON.parse(event.body);
    audio = body.audio;
    filename = body.filename;
    mimeType = body.mimeType;
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body: " + e.message }) };
  }

  if (!audio) {
    return { statusCode: 400, body: JSON.stringify({ error: "No audio data received." }) };
  }

  try {
    const audioBuffer = Buffer.from(audio, "base64");

    const form = new FormData();
    const blob = new Blob([audioBuffer], { type: mimeType || "audio/mpeg" });
    form.append("file", blob, filename || "audio.mp3");
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      body: form,
    });

    const rawText = await response.text();

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return { statusCode: 500, body: JSON.stringify({ error: "OpenAI returned unexpected response: " + rawText.substring(0, 200) }) };
    }

    if (data.error) {
      return { statusCode: 500, body: JSON.stringify({ error: "OpenAI error: " + data.error.message }) };
    }

    const segments = (data.segments || []).map(seg => ({
      start: seg.start,
      end: seg.end,
      text: seg.text.trim(),
      startFormatted: formatTime(seg.start),
    }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript: data.text,
        segments,
      }),
    };
  } catch (err) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: "Transcription failed: " + err.message }),
    };
  }
};

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
