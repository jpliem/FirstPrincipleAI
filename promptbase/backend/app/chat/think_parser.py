class ThinkTagParser:
    """Stateful parser that separates <think>...</think> blocks from text in a token stream.

    Call feed(token) for each streaming token. It returns a list of (type, content) tuples
    where type is "thinking" or "text". Call flush() at the end to emit any buffered content.

    After processing, thinking_content and text_content hold the accumulated strings for DB storage.
    """

    OPEN_TAG = "<think>"
    CLOSE_TAG = "</think>"

    def __init__(self):
        self._in_thinking = False
        self._tag_buffer = ""
        self.thinking_content = ""
        self.text_content = ""

    def feed(self, token: str) -> list[tuple[str, str]]:
        events: list[tuple[str, str]] = []
        i = 0
        while i < len(token):
            ch = token[i]
            # If no partial tag is buffered and this char can't start a tag,
            # consume a run of safe characters in one shot to preserve token granularity.
            if not self._tag_buffer and ch != "<":
                tag_start = token.find("<", i)
                if tag_start == -1:
                    # No '<' in the remainder — emit the whole suffix at once
                    safe = token[i:]
                    event_type = "thinking" if self._in_thinking else "text"
                    if event_type == "thinking":
                        self.thinking_content += safe
                    else:
                        self.text_content += safe
                    events.append((event_type, safe))
                    break
                else:
                    # Emit up to (but not including) the '<'
                    safe = token[i:tag_start]
                    if safe:
                        event_type = "thinking" if self._in_thinking else "text"
                        if event_type == "thinking":
                            self.thinking_content += safe
                        else:
                            self.text_content += safe
                        events.append((event_type, safe))
                    i = tag_start
                    continue
            events.extend(self._feed_char(ch))
            i += 1
        return events

    def _feed_char(self, ch: str) -> list[tuple[str, str]]:
        events: list[tuple[str, str]] = []
        self._tag_buffer += ch

        if self._in_thinking:
            # Check if buffer could be the start of </think>
            if self._tag_buffer == self.CLOSE_TAG:
                # Complete close tag found
                self._in_thinking = False
                self._tag_buffer = ""
                return events
            if self.CLOSE_TAG.startswith(self._tag_buffer):
                # Partial match for close tag, keep buffering
                return events
            # Not a close tag — flush buffer as thinking content
            content = self._tag_buffer
            self._tag_buffer = ""
            self.thinking_content += content
            events.append(("thinking", content))
            return events
        else:
            # Not in thinking mode
            if self._tag_buffer == self.OPEN_TAG:
                # Complete open tag found
                self._in_thinking = True
                self._tag_buffer = ""
                return events
            if self.OPEN_TAG.startswith(self._tag_buffer):
                # Partial match for open tag, keep buffering
                return events
            # Not an open tag — flush buffer as text content
            content = self._tag_buffer
            self._tag_buffer = ""
            self.text_content += content
            events.append(("text", content))
            return events

    def flush(self) -> list[tuple[str, str]]:
        events: list[tuple[str, str]] = []
        if self._tag_buffer:
            event_type = "thinking" if self._in_thinking else "text"
            if event_type == "thinking":
                self.thinking_content += self._tag_buffer
            else:
                self.text_content += self._tag_buffer
            events.append((event_type, self._tag_buffer))
            self._tag_buffer = ""
        return events
