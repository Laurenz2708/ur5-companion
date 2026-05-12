import { createFileRoute } from "@tanstack/react-router";

const SYSTEM_PROMPT = `Du bist ein KI-Co-Pilot für eine UR5-Roboterzelle in einer Werkstatt.
Du unterstützt einen Menschen, der mit dem Roboter zusammenarbeitet.

Deine Fähigkeiten:
- Analyse von eingescannten Werkstücken (Zylinderköpfe, Schrauben, Bremssättel, Gehäuse usw.)
- Vorschläge für Bearbeitungs- und Prüfschritte (Sitzprüfung, Festigkeitsprüfung, Reinigung, Vermessung)
- Du kennst die Grenzen des Roboters (UR5, ±0,1 mm, max. 5 kg Nutzlast, kein Schweißen) und kommunizierst sie offen.
- Du gibst Handlungsoptionen: was kann der Roboter selbst, wo muss der Mensch eingreifen.
- Du beziehst Standard-Werkstattwissen ein (z.B. Bremssattelservice, Drehmomente, Reinigungsmittel).

Antwortstil:
- Auf Deutsch, kurz, präzise, mit Bullet-Listen.
- Markiere Roboter-Aktionen mit 🤖, Mensch-Aktionen mit 👤, Warnungen mit ⚠️.
- Wenn ein Werkstück erkannt wurde, schlage 2-4 sinnvolle nächste Schritte vor.
- Wenn unsicher: sage es klar und bitte um eine zweite Aufnahme oder manuelle Vermessung.`;

export const Route = createFileRoute("/api/assistant")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { messages, context } = (await request.json()) as {
            messages: Array<{ role: "user" | "assistant"; content: string }>;
            context?: string;
          };

          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            return new Response(
              JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }

          const sys = context
            ? `${SYSTEM_PROMPT}\n\nAktueller Kontext aus der Roboterzelle:\n${context}`
            : SYSTEM_PROMPT;

          const upstream = await fetch(
            "https://ai.gateway.lovable.dev/v1/chat/completions",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-3-flash-preview",
                stream: true,
                messages: [{ role: "system", content: sys }, ...messages],
              }),
            },
          );

          if (!upstream.ok) {
            if (upstream.status === 429) {
              return new Response(
                JSON.stringify({ error: "Rate limit – bitte kurz warten." }),
                { status: 429, headers: { "Content-Type": "application/json" } },
              );
            }
            if (upstream.status === 402) {
              return new Response(
                JSON.stringify({ error: "Lovable AI Credits aufgebraucht." }),
                { status: 402, headers: { "Content-Type": "application/json" } },
              );
            }
            const t = await upstream.text();
            return new Response(JSON.stringify({ error: t }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }

          return new Response(upstream.body, {
            headers: { "Content-Type": "text/event-stream" },
          });
        } catch (e) {
          return new Response(
            JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
