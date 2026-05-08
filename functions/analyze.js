exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const OPENAI_KEY = process.env.OPENAI_API_KEY;

  let transcript, segments, language;
  try {
    const body = JSON.parse(event.body);
    transcript = body.transcript;
    segments = body.segments || [];
    language = body.language || "id";
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request." }) };
  }

  if (!transcript || !transcript.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: "Transcript is empty." }) };
  }

  const langInstruction = language === "both"
    ? "Write all output in BOTH Indonesian and English. For each text field, write Indonesian first, then '— EN —', then English."
    : language === "en"
    ? "Write all output in English."
    : "Write all output in Indonesian (Bahasa Indonesia).";

  // Build a timestamped segment list for the prompt
  const segmentBlock = segments.length > 0
    ? segments.map((s, i) => `[${s.startFormatted}] Segment ${i + 1}: ${s.text}`).join("\n")
    : transcript;

  const systemPrompt = `You are an expert meeting analyst and Japanese-to-target-language translator. You receive a Japanese meeting transcript with timestamped segments and produce a structured JSON analysis.

${langInstruction}

━━━ TRANSLATION QUALITY ━━━
Translate naturally and contextually — never word-for-word literal.
- お疲れ様でした → "Kerja bagus" / "Good work"
- よろしくお願いします → "Mohon kerjasamanya" / "Looking forward to working with you"  
- なるほど / そうですね → "Begitu ya" / "I see"
- うん / ああ → "Iya" / "Yeah" / "Mm-hmm"
Match formality level: keigo → formal, casual speech → casual.

━━━ SPEAKER DETECTION ━━━
- Scan every segment for name mentions, self-introductions, being addressed by name, role references
- Use actual names if found. Otherwise: Speaker A, Speaker B, etc.
- Be consistent — same speaker always gets the same label across ALL sections

━━━ WHAT EACH SECTION MUST CONTAIN — NO OVERLAP ━━━

【TRANSCRIPT — verbatim, timestamped】
- Translate EVERY segment. Every word anyone said. No skipping, no summarizing.
- Include fillers: うん→"Mm-hmm", そう→"Yeah", なるほど→"I see", あ→"Ah", etc.
- Include incomplete sentences, interruptions, single-word responses — everything
- Use the timestamps from the input segments
- Format each line: [M:SS] [Speaker Label]: translated text
- Also produce japaneseTranscript using the original Japanese text with same timestamps and speaker labels
- Also produce bothTranscript interleaved line by line:
    [M:SS] [Speaker A - JP]: japanese text
    [M:SS] [Speaker A - ID/EN]: translated text
    (blank line between speaker turns)

【CHAPTERS — timeline structure】
- These are TIME BLOCKS, not topic summaries
- Divide the meeting by when the topic actually shifted
- Title = the actual subject discussed (e.g. "Project Deadline Discussion" not "Topic 2")
- Timestamp = the real time range from the segment data
- Summary = 2-3 sentences: what was said, who was involved, how it ended
- DO NOT include decisions or action items here — those go in Key Points

【KEY POINTS — decisions and commitments ONLY】
- Only include things that were explicitly agreed on, assigned, or confirmed
- Every point must answer: WHO committed to WHAT by WHEN (if stated)
- Sub-points = conditions, deadlines, or dependencies attached to that commitment
- If two people agreed on something, name both
- DO NOT include observations, background info, or things that were merely discussed
- If nothing concrete was decided, write one point: "No formal decisions or commitments were made in this meeting"

【HIGHLIGHTS — single memorable moments】
- One specific thing one person said that stands out
- Must be a real verbatim translated quote — not paraphrased, not invented
- Pick moments that are: surprising, decisive, emotionally significant, or reveal something important
- Context = WHY this moment matters — be specific about what it reveals or changes
- DO NOT pick generic statements like "the meeting was productive"
- Aim for 2-4 highlights max — quality over quantity

【SUMMARY — narrative overview, written last】
- Written like a post-meeting brief, past tense
- Each bullet = one major theme with SPECIFIC detail (names, numbers, dates mentioned)
- Sub-bullets = supporting detail — who said what, what was the outcome, what was left unresolved
- DO NOT repeat Key Points verbatim — Summary tells the story, Key Points list the actions
- DO NOT repeat Highlights verbatim — reference the theme, not the exact quote
- Focus on: what the meeting was about, what was achieved, what remains open

━━━ OUTPUT ━━━
Return ONLY this raw JSON, no markdown, no backticks, no preamble:

{
  "speakers": [
    {
      "id": "speaker_a",
      "label": "Speaker A",
      "name": "actual name or null",
      "role": "inferred role or null",
      "summary": "One specific sentence about their contribution in this meeting"
    }
  ],
  "chapters": [
    {
      "title": "Actual topic name",
      "timestamp": "0:00 - 4:30",
      "summary": "2-3 sentences on what happened in this segment"
    }
  ],
  "tabs": {
    "summary": [
      {
        "point": "Major meeting theme with specific named detail",
        "subPoints": ["Specific supporting detail", "Another concrete detail or unresolved item"]
      }
    ],
    "keyPoints": [
      {
        "point": "WHO committed to WHAT",
        "subPoints": ["Condition or deadline", "Follow-up or dependency if stated"]
      }
    ],
    "highlights": [
      {
        "speaker": "Speaker label",
        "quote": "Exact translated quote from the transcript",
        "context": "Why this specific moment matters"
      }
    ]
  },
  "transcripts": {
    "translated": "[M:SS] [Speaker A]: translated line\\n[M:SS] [Speaker B]: translated line",
    "ja": "[M:SS] [Speaker A]: original japanese line\\n[M:SS] [Speaker B]: original japanese line",
    "both": "[M:SS] [Speaker A - JP]: japanese\\n[M:SS] [Speaker A - ID]: translated\\n\\n[M:SS] [Speaker B - JP]: japanese\\n[M:SS] [Speaker B - ID]: translated"
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
          {
            role: "user",
            content: `Japanese meeting transcript with timestamps:\n\n${segmentBlock}\n\nFull raw transcript:\n${transcript}`
          },
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
