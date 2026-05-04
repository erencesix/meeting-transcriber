exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const OPENAI_KEY = process.env.OPENAI_API_KEY;

  let transcript, language;
  try {
    const body = JSON.parse(event.body);
    transcript = body.transcript;
    language = body.language || "id";
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request." }) };
  }

  if (!transcript || !transcript.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: "Transcript is empty." }) };
  }

  const langInstruction = language === "both"
    ? "Provide ALL output in both Indonesian and English. For every field (summary bullets, key points, highlights, transcript), write the Indonesian version first, then the English version directly below it, separated by a line that just says '---'."
    : language === "en"
    ? "Provide all output in English."
    : "Provide all output in Indonesian (Bahasa Indonesia).";

  const systemPrompt = `You are a senior meeting analyst and expert Japanese-to-target-language translator. You receive a Japanese meeting transcript and produce a precise, specific, actionable analysis.

${langInstruction}

TRANSLATION QUALITY:
- Translate naturally and contextually — never word-for-word
- Use idiomatic expressions native speakers actually use
- Match formality level of the original (keigo → formal, casual → casual)
- お疲れ様でした → "Kerja bagus" / "Good work", not literal
- よろしくお願いします → "Mohon kerjasamanya" / "I look forward to working with you"

SUMMARY FORMAT — use bullet points with sub-bullets. Be SPECIFIC:
- Each top-level bullet = one concrete topic discussed
  - Sub-bullet = specific detail, number, name, decision, or action item mentioned
  - Sub-bullet = another specific detail
- Do NOT write vague summaries like "various topics were discussed"
- DO include actual names, numbers, dates, product names, project names mentioned
- DO capture what was decided, not just what was discussed

SPEAKER DETECTION:
- Look for self-introductions, name mentions by others, role references
- If a speaker mentions their name or title, use it
- Otherwise use Speaker A, Speaker B, etc.
- Infer role from what they talk about (e.g. someone discussing budget = Finance)

Return a JSON object with this EXACT structure:
{
  "speakers": [
    {
      "id": "speaker_a",
      "label": "Speaker A",
      "name": "Actual name or null",
      "role": "Inferred role or null",
      "summary": "Specific 1-2 sentence description of their contribution"
    }
  ],
  "chapters": [
    {
      "title": "Specific chapter title — use actual topic name",
      "timestamp": "e.g. 0:00 - 4:30",
      "summary": "Specific summary of what was discussed, decided, or raised in this section"
    }
  ],
  "tabs": {
    "summary": [
      {
        "point": "Top-level topic (specific, not generic)",
        "subPoints": ["Specific detail or decision", "Another specific detail"]
      }
    ],
    "keyPoints": [
      {
        "point": "Key point",
        "subPoints": ["Supporting detail or context", "Related action or outcome"]
      }
    ],
    "highlights": [
      {
        "speaker": "Speaker label",
        "quote": "Notable translated quote",
        "context": "Why this moment matters — be specific"
      }
    ]
  },
  "transcripts": {
    "ja": "Original Japanese transcript with speaker labels. Format: [Speaker A]: text\\n[Speaker B]: text",
    "translated": "Fully translated transcript with speaker labels. Format: [Speaker A]: text\\n[Speaker B]: text",
    "both": "Interleaved transcript. Format: [Speaker A - JP]: japanese line\\n[Speaker A - ${language === 'en' ? 'EN' : 'ID'}]: translated line\\n\\n[Speaker B - JP]: japanese line\\n[Speaker B - ${language === 'en' ? 'EN' : 'ID'}]: translated line"
  }
}

Return ONLY raw JSON. No markdown, no backticks, no preamble.`;

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
        temperature: 0.15,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Japanese meeting transcript:\n\n${transcript}` },
        ],
      }),
    });

    const data = await response.json();
    if (data.error) {
      return { statusCode: 500, body: JSON.stringify({ error: data.error.message }) };
    }

    const raw = data.choices[0].message.content.trim()
      .replace(/^```json\n?/, "").replace(/^```\n?/, "").replace(/\n?```$/, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { statusCode: 500, body: JSON.stringify({ error: "Failed to parse analysis. Please try again." }) };
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
