import { createLogger } from '@archon/paths';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('message-splitting');
  return cachedLog;
}

/**
 * Split a long message into chunks at paragraph boundaries.
 * Two-pass: first splits on paragraph breaks (\n\n), then falls back
 * to line breaks (\n) for any chunk still exceeding maxLength.
 */
export function splitIntoParagraphChunks(message: string, maxLength: number): string[] {
  if (!message) return [];

  const paragraphs = message.split(/\n\n+/);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    const newLength = currentChunk.length + para.length + 2; // +2 for \n\n

    if (newLength > maxLength && currentChunk) {
      chunks.push(currentChunk);
      currentChunk = para;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  // Fallback: split by lines if any chunk is still too long
  const finalChunks: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= maxLength) {
      finalChunks.push(chunk);
    } else {
      const lines = chunk.split('\n');
      let subChunk = '';
      for (const line of lines) {
        if (subChunk.length + line.length + 1 > maxLength) {
          if (subChunk) finalChunks.push(subChunk);
          subChunk = line;
        } else {
          subChunk += (subChunk ? '\n' : '') + line;
        }
      }
      if (subChunk) finalChunks.push(subChunk);
    }
  }

  getLog().debug({ chunkCount: finalChunks.length }, 'message.split_completed');
  return finalChunks;
}

interface MessageSegment {
  text: string;
  /** True for a ```-fenced code block that must never be split mid-fence. */
  atomic: boolean;
}

/**
 * Tokenize a message into prose and ```-fenced code-block segments.
 * Fence state is tracked by counting lines whose trimmed start is ```.
 * An unterminated fence at EOF is treated as a code block running to end-of-message.
 */
function tokenizeSegments(message: string): MessageSegment[] {
  const lines = message.split('\n');
  const segments: MessageSegment[] = [];
  let proseLines: string[] = [];
  let codeLines: string[] = [];
  let inCode = false;

  const flushProse = (): void => {
    if (proseLines.length > 0) {
      segments.push({ text: proseLines.join('\n'), atomic: false });
      proseLines = [];
    }
  };
  const flushCode = (): void => {
    if (codeLines.length > 0) {
      segments.push({ text: codeLines.join('\n'), atomic: true });
      codeLines = [];
    }
  };

  for (const line of lines) {
    const isFence = line.trim().startsWith('```');
    if (!inCode) {
      if (isFence) {
        flushProse();
        inCode = true;
        codeLines.push(line);
      } else {
        proseLines.push(line);
      }
    } else {
      codeLines.push(line);
      if (isFence) {
        inCode = false;
        flushCode();
      }
    }
  }

  // EOF: flush any trailing prose, then any unterminated code block (still atomic).
  flushProse();
  flushCode();
  return segments;
}

/**
 * Split a long message into chunks ≤ maxLength while keeping ```-fenced code
 * blocks atomic. Prose segments split via {@link splitIntoParagraphChunks};
 * a code block that alone exceeds maxLength is emitted intact as its own
 * oversized chunk rather than cut mid-fence. Chunk boundaries never fall inside
 * a fenced block.
 */
export function splitIntoAtomicChunks(message: string, maxLength: number): string[] {
  if (!message) return [];

  const segments = tokenizeSegments(message);
  const chunks: string[] = [];
  let current = '';

  const pushCurrent = (): void => {
    if (current) {
      chunks.push(current);
      current = '';
    }
  };

  const appendToCurrent = (text: string): void => {
    if (current && current.length + text.length + 1 > maxLength) {
      pushCurrent();
      current = text;
    } else {
      current += (current ? '\n' : '') + text;
    }
  };

  for (const seg of segments) {
    if (seg.atomic) {
      if (seg.text.length > maxLength) {
        // Oversized code block: emit intact as its own chunk (never cut a fence).
        pushCurrent();
        chunks.push(seg.text);
      } else {
        appendToCurrent(seg.text);
      }
    } else if (seg.text.length <= maxLength) {
      appendToCurrent(seg.text);
    } else {
      // Prose too large on its own: split it, keeping code boundaries intact.
      pushCurrent();
      for (const proseChunk of splitIntoParagraphChunks(seg.text, maxLength)) {
        chunks.push(proseChunk);
      }
    }
  }
  pushCurrent();

  getLog().debug({ chunkCount: chunks.length }, 'message.atomic_split_completed');
  return chunks;
}
