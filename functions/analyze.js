exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  const OPENAI_KEY = process.env.OPENAI_API_KEY;

  if (!OPENAI_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "API key not configured." }) };
  }

  let transcript, segments, language;
  try {
    const body = JSON.parse(event.body);
    transcript = body.transcript;
    segments = body.segments || [];
    language = body.language || "id";
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request: " + e.message }) };
  }

  if (!transcript || !transcript.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: "Transcript is empty." }) };
  }

  const langLabel = language === "en" ? "English" : language === "both" ? "Indonesian and English" : "Indonesian (Bahasa Indonesia)";

  // Build compact timestamped transcript for GPT
  const segmentBlock = segments.length > 0
    ? segments.map(s => `[${s.startFormatted}] ${s.text}`).join("\n")
    : transcript;

  // Cap input to avoid token overflow
  const cappedSegments = segmentBlock.length > 8000 ? segmentBlock.substring(0, 8000) + "\n[... truncated ...]" : segmentBlock;

  const systemPrompt = `You are a meeting analyst and translator. Analyze this meeting transcript and return a JSON object. Output language: ${langLabel}.

RULES PER SECTION — these must be DISTINCT, no overlap:
- TRANSCRIPT: Verbatim translation of every utterance, timestamped. Format: "[M:SS] [Speaker A]: text". Include fillers, short responses, everything. Also produce "ja" version with original text, and "both" interleaved.
- CHAPTERS: Time blocks by topic. Title = actual topic name. No decisions here.
- KEY POINTS: Only explicit decisions, commitments, action items. WHO + WHAT. Nothing observational.
- HIGHLIGHTS: 2-4 real verbatim quotes that are surprising or decisive. Explain why each matters.
- SUMMARY: Past-tense narrative. Specific names/numbers. Do NOT repeat key points or highlights verbatim.

Speaker detection: use real names if mentioned, else Speaker A/B/C. Be consistent.
Translation: natural and contextual, never literal. Match formality level.

Return ONLY this JSON, no markdown:
{
  "speakers": [{"id":"speaker_a","label":"Speaker A","name":null,"role":null,"summary":"their specific contribution"}],
  "chapters": [{"title":"Actual Topic","timestamp":"0:00 - 2:30","summary":"what happened"}],
  "tabs": {
    "summary": [{"point":"theme with specific detail","subPoints":["detail","detail"]}],
    "keyPoints": [{"point":"WHO committed to WHAT","subPoints":["condition or deadline"]}],
    "highlights": [{"speaker":"Speaker A","quote":"exact translated quote","context":"why this matters"}]
  },
  "transcripts": {
    "translated": "[0:00] [Speaker A]: text\\n[0:05] [Speaker B]: text",
    "ja": "[0:00] [Speaker A]: japanese\\n[0:05] [Speaker B]: japanese",
    "both": "[0:00] [Speaker A - JP]: japanese\\n[0:00] [Speaker A - ID]: translated\\n\\n[0:05] [Speaker B - JP]: japanese\\n[0:05] [Speaker B - ID]: translated"
  }
}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 4096,
        temperature: 0.1,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Timestamped transcript:\n${cappedSegments}\n\nFull text:\n${transcript.substring(0, 3000)}` },
        ],
      }),
    });

    const rawText = await response.text();

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return { statusCode: 500, body: JSON.stringify({ error: "OpenAI returned unexpected response: " + rawText.substring(0, 300) }) };
    }

    if (data.error) {
      return { statusCode: 500, body: JSON.stringify({ error: "OpenAI error: " + data.error.message }) };
    }

    const content = data.choices?.[0]?.message?.content?.trim() || "";
    const clean = content.replace(/^```json\n?/, "").replace(/^```\n?/, "").replace(/\n?```$/, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: "Failed to parse analysis response. Raw: " + clean.substring(0, 300) }) };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    };

  } catch (err) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: "Analysis failed: " + err.message }),
    };
  }
};
