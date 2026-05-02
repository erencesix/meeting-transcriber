exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const OPENAI_KEY = process.env.OPENAI_API_KEY;

  let transcript, language;
  try {
    const body = JSON.parse(event.body);
    transcript = body.transcript;
    language = body.language || "id"; // "id", "en", or "both"
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request." }) };
  }

  if (!transcript || !transcript.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: "Transcript is empty." }) };
  }

  const langInstruction =
    language === "both"
      ? "Provide all output in BOTH Indonesian and English. For each section, show Indonesian first, then English below it labeled clearly."
      : language === "en"
      ? "Provide all output in English."
      : "Provide all output in Indonesian (Bahasa Indonesia).";

  const systemPrompt = `You are an expert meeting analyst and Japanese-to-${language === "en" ? "English" : "Indonesian"} translator. You will receive a Japanese meeting transcript and produce a structured analysis.

${langInstruction}

Your task:
1. Identify all speakers. Look for name mentions, self-introductions, or conversational cues. Label them as "Speaker A", "Speaker B" etc if names are unknown, or use actual names if mentioned. For each speaker, note their role if inferable.
2. Produce a clean translated version of the meeting in the target language.
3. Analyze the meeting and return a JSON object with this exact structure:

{
  "speakers": [
    {
      "id": "speaker_a",
      "label": "Speaker A",
      "name": "Actual name if known, else null",
      "role": "Their role if inferable, else null",
      "summary": "Brief summary of what this person contributed to the meeting"
    }
  ],
  "chapters": [
    {
      "title": "Chapter title",
      "timestamp": "Approximate time range e.g. 0:00 - 5:00",
      "summary": "What was discussed in this section"
    }
  ],
  "tabs": {
    "summary": "A concise paragraph summarizing the entire meeting — what it was about, what was decided, and what comes next.",
    "keyPoints": [
      "Key point 1",
      "Key point 2"
    ],
    "highlights": [
      {
        "speaker": "Speaker label",
        "quote": "Notable thing they said (translated)",
        "context": "Why this is significant"
      }
    ]
  },
  "translatedTranscript": "Full translated transcript with speaker labels. Format as: [Speaker A]: text\\n[Speaker B]: text"
}

Return ONLY the raw JSON. No markdown, no backticks, no preamble.`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 4000,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Here is the Japanese meeting transcript:\n\n${transcript}` },
        ],
      }),
    });

    const data = await response.json();

    if (data.error) {
      return { statusCode: 500, body: JSON.stringify({ error: data.error.message }) };
    }

    const raw = data.choices[0].message.content.trim();

    // Clean JSON if model added backticks
    const clean = raw.replace(/^```json\n?/, "").replace(/^```\n?/, "").replace(/\n?```$/, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      return { statusCode: 500, body: JSON.stringify({ error: "Failed to parse analysis. Try again." }) };
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
