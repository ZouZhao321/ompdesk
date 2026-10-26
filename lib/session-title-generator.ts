import { generateSessionTitle as generateOmpSessionTitle } from "@oh-my-pi/pi-coding-agent/utils/title-generator";
import type { AgentSessionLike } from "./omp-types";
import {
  findFirstTitleSource,
  truncateTitle,
  type GeneratedSessionTitle,
} from "./session-title";

/**
 * Name a session using omp's own title generator.
 *
 * omp titles sessions with the `tiny` → `commit` → `smol` role chain (or the
 * configured local tiny model), so a title generated from the browser costs the
 * same as one generated in the TUI and never burns the session's primary model.
 * Returns `null` when omp declines to title — greetings and other low-signal
 * first messages are deliberately left unnamed until the next real turn.
 *
 * Server-only: importing the SDK from a client component breaks the browser
 * bundle, so the pure helpers live in `session-title.ts` and this module is
 * imported only by API routes.
 */
export async function generateSessionTitle(
  session: AgentSessionLike,
): Promise<GeneratedSessionTitle | null> {
  const context = session.sessionManager.buildSessionContext();
  const firstMessage = findFirstTitleSource(context.messages);
  if (!firstMessage) {
    throw new Error("The session has no user messages to name");
  }

  const title = await generateOmpSessionTitle(
    firstMessage,
    session.modelRegistry as never,
    session.settings,
    session.sessionId,
    session.model as never,
  );
  if (!title) return null;

  const cleaned = truncateTitle(title);
  if (!/[\p{L}\p{N}]/u.test(cleaned)) {
    throw new Error("The model did not return a usable session title");
  }
  return { title: cleaned };
}
