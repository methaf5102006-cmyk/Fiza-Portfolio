const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Simple in-memory rate limiter (per IP). Note: on serverless this resets
// whenever the function "cold starts" — it's a basic safety net, not a hard limit.
const rateLimitMap = new Map();
const RATE_LIMIT = 20; // max messages
const RATE_WINDOW_MS = 10 * 60 * 1000; // per 10 minutes

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW_MS) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count += 1;
  rateLimitMap.set(ip, entry);
  return entry.count > RATE_LIMIT;
}

// Everything the assistant is allowed to know about Fiza.
// Edit this freely — the model will only answer using what's written here.
const SYSTEM_PROMPT = `You are the AI Assistant embedded in Fiza Liaqat's developer portfolio website.
You answer visitor questions ONLY about Fiza, using the facts below. Keep answers short (2-4 sentences),
friendly, and professional. If asked something outside these facts (unrelated topics, other people, etc.),
politely say you can only answer questions about Fiza's portfolio and steer back to her work.

FACTS ABOUT FIZA:
- Name: Fiza Liaqat
- Role: MERN Stack Developer (React.js, Node.js, Express.js, MongoDB), BS Information Technology student
- Education: BS Information Technology, Elite College (affiliated with GCUF), 2024–2028
- Core skills: HTML5, CSS3, JavaScript, React.js, Tailwind CSS, Node.js, Express.js, MongoDB, REST APIs,
  AI integration, WordPress/WooCommerce, Git & GitHub
- Documentation skills: SRS, Synopsis, UML Diagrams, ERD, DFD, Thesis Setup, PowerPoint Presentations,
  Word document formatting (CVs, question papers)
- Projects:
  1. SkillLink — a hyperlocal skill marketplace connecting people who need a service with nearby providers.
     Built with React, Node.js, Express, MongoDB, JWT authentication.
  2. LMS with AI Integration — a learning management system with AI-driven features for learners.
     Built with React, Node.js, MongoDB, AI integration.
  3. College Website — an institutional website (departments, admissions, announcements), currently in
     final stages of development.
  Static / other work: AI Tool Hub, Luxury Cars website, Gaming website (static builds), Skyline Watches
  (WordPress/WooCommerce e-commerce store), Click On Web (client portfolio project).
- Services offered: MERN Stack Development, Frontend Development, AI Integration, Technical Documentation.
- Availability: Open to freelance projects, junior developer roles, and documentation work.
- Contact: Email liaqatfiza9@gmail.com | WhatsApp/Phone +92 321 1963000 | LinkedIn linkedin.com/in/fiza-liaqat-6259563a3
  | GitHub github.com/methaf5102006-cmyk | Location: Pakistan

Never invent projects, employers, numbers, or facts not listed above. If unsure, say you don't have that
detail and suggest the visitor email Fiza directly.`;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed.' }) };
  }

  try {
    if (!GROQ_API_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Server is missing GROQ_API_KEY. Check Netlify environment variables.' })
      };
    }

    const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
    if (isRateLimited(ip)) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ error: 'Too many messages — please try again in a few minutes.' })
      };
    }

    const { message, history } = JSON.parse(event.body || '{}');
    if (!message || typeof message !== 'string' || message.length > 800) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid message.' }) };
    }

    // Groq uses the OpenAI-style "messages" array, with system as its own message
    const history_msgs = Array.isArray(history) ? history.slice(-8) : [];
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history_msgs,
      { role: 'user', content: message }
    ];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 300,
        messages
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Groq API error:', response.status, errText);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'AI service error. Please try again shortly.' }) };
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply: reply || "Sorry, I couldn't generate a response — please try again." })
    };
  } catch (err) {
    console.error('Chat function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Something went wrong on the server.' }) };
  }
};