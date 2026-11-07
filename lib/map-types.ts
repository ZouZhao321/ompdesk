/** One user turn on the conversation map. */
export interface MapTurnNode {
  /** Entry id of the user message; stable across forks because copies keep ids. */
  id: string;
  /** Parent turn id, null for a trunk root. */
  parentId: string | null;
  /** Session file this turn's text was first projected from. */
  sessionId: string;
  sessionTitle?: string;
  /** Turn index inside its own file. */
  turnIndex: number;
  preview: string;
  answerPreview: string;
  toolCount: number;
  timestamp?: string;
  /** Leaf to navigate to when the user switches to this line. */
  answerEntryId?: string;
  /** Cut point used when forking from this turn (last safe entry of the turn). */
  forkEntryId: string;
}

export interface SessionMapPayload {
  nodes: MapTurnNode[];
  truncated: boolean;
}

export interface MapTurnDetail {
  userText: string;
  answerText: string;
  tools: string[];
  truncated: boolean;
}
