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
    ? "Write all output in BOTH Indonesian and English. For each text field, write the Indonesian version first, then a line break, then '— EN —', then the English version."
    : language === "en"
    ? "Write all output in English."
    : "Write all output in Indonesian (Bahasa Indonesia).";

  const systemPrompt = `You are an expert meeting analyst and Japanese translator. You receive a raw Japanese meeting transcript and produce a structured JSON analysis.

${langInstruction}

━━━ TRANSLATION QUALITY ━━━
Translate naturally and contextually. Never word-for-word. Use expressions native speakers actually use.
- お疲れ様でした → "Kerja bagus" / "Good work"
- よろしくお願いします → "Mohon kerjasamanya" / "Looking forward to working with you"
- なるほど → "Begitu ya" / "I see"
Match formality: keigo → formal Indonesian/English, casual → casual.

━━━ SPEAKER DETECTION ━━━
- Scan for name mentions, self-introductions, role references, being addressed by name
- Use actual names if found. Otherwise: Speaker A, Speaker B, etc.
- Be consistent — same speaker always gets the same label throughout

━━━ SECTION RULES — READ CAREFULLY ━━━

TRANSCRIPT (translatedTranscript):
- This is a VERBATIM translation. Every single utterance gets included — full sentences, half-sentences, single words, filler words, interruptions, everything.
- Include things like "Hmm", "Ah", "Sou desu ne", "Un", "Wakatta" — translate them naturally ("Hmm", "Ah", "I see", "Yeah", "Got it")
- Format: [Speaker A]: line\n[Speaker B]: line
- Also produce japaneseTranscript with the ORIGINAL Japanese text, labeled the same way
- Also produce bothTranscript interleaved: [Speaker A - JP]: japanese\n[Speaker A - ID/EN]: translated\n\n[Speaker B - JP]: japanese\n[Speaker B - ID/EN]: translated

CHAPTERS:
- Divide the meeting into distinct time-based segments by topic shift
- Each chapter = a concrete topic that was discussed, not a vague label
- Title should name the actual topic (e.g. "Q3 Budget Review" not "Discussion")
- Summary: 2-3 sentences on what specifically happened in this segment — what was said, decided, or raised

KEY POINTS:
- These are DECISIONS, ACTION ITEMS, and COMMITMENTS made in the meeting
- Not observations, not summaries — only things that were agreed on, assigned, or confirmed
- Each point must name WHO decided/committed and WHAT specifically
- Sub-points = the conditions, deadline, or follow-up attached to that commitment
- If nothing was decided, say so explicitly

HIGHLIGHTS:
- Memorable, surprising, or significant individual moments — one specific thing one person said
- The quote must be a real translated utterance from the transcript, not paraphrased
- Context must explain WHY this moment matters, not just repeat what was said
- Pick moments that would make someone say "oh interesting" — not generic statements

SUMMARY:
- This comes LAST and synthesizes everything
- Written in past tense, like a brief written after the meeting
- Each bullet = one major theme of the meeting with specific details (names, numbers, decisions mentioned)
- Sub-bullets = granular supporting detail — who said what, what was the outcome
- DO NOT repeat the same content as Key Points verbatim — Summary is the narrative, Key Points are the action items

━━━ OUTPUT FORMAT ━━━
Return ONLY this raw JSON, no markdown, no backticks:

{
  "speakers": [
    {
      "id": "speaker_a",
      "label": "Speaker A",
      "name": "actual name or null",
      "role": "inferred role or null",
      "summary": "One specific sentence about their role in this meeting — what they contributed, decided, or raised"
    }
  ],
  "chapters": [
    {
      "title": "Specific topic name",
      "timestamp": "0:00 - 4:30",
      "summary": "2-3 sentences on what specifically happened in this segment"
    }
  ],
  "tabs": {
    "summary": [
      {
        "point": "Major meeting theme with specific detail",
        "subPoints": ["Who said/decided what specifically", "Another concrete detail"]
      }
    ],
    "keyPoints": [
      {
        "point": "Decision or action item — WHO and WHAT",
        "subPoints": ["Condition, deadline, or follow-up", "Another attached detail"]
      }
    ],
    "highlights": [
      {
        "speaker": "Speaker label",
        "quote": "Exact translated quote from the transcript",
        "context": "Why this moment is significant — specific, not generic"
      }
    ]
  },
  "transcripts": {
    "translated": "[Speaker A]: translated line\\n[Speaker B]: translated line",
    "ja": "[Speaker A]: original japanese\\n[Speaker B]: original japanese",
    "both": "[Speaker A - JP]: japanese\\n[Speaker A - ID]: translated\\n\\n[Speaker B - JP]: japanese\\n[Speaker B - ID]: translated"
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
